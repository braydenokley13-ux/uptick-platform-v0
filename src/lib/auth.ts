import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  accountAuthClient,
  verifyAccountIdentity,
  revokeAccountSession,
  validatedAccountClaims,
} from "./account-security";
import { localMode } from "./config";
import { cloudDemoMode } from "./cloud-demo-guard";
import { sign, equal, encrypt, decrypt } from "./security";
import { getDb } from "./db";
import { pilotPersona, pilotPrincipal } from "./pilot-access";
import { audit, type Actor } from "./domain";
import { RequestError } from "./http";
const COOKIE = "uptick-session";
type Session = {
  userId: string;
  accessToken?: string;
  refreshToken?: string;
  recoveryOnly?: boolean;
  requiresElevation?: boolean;
  expires: number;
  pilotOrganizationId?: string;
};
async function writeSession(session: Session) {
  const value = Buffer.from(JSON.stringify(session)).toString("base64url");
  (await cookies()).set(COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true,
    secure: !localMode(),
    sameSite: "lax",
    maxAge: Math.max(0, Math.floor((session.expires - Date.now()) / 1000)),
    path: "/",
  });
}
export async function setSession(
  userId: string,
  accessToken?: string,
  refreshToken?: string,
  recoveryOnly = false,
) {
  if (cloudDemoMode()) {
    if (
      !["demo-operator", "demo-merchant"].includes(userId) ||
      accessToken ||
      refreshToken
    )
      throw new RequestError(
        "Only sample personas are available in Cloud Demo Studio.",
        403,
      );
    await getDb(); // Require the current isolated rehearsal lease before issuing a persona.
  }
  await writeSession({
    userId,
    accessToken: accessToken ? encrypt(accessToken) : undefined,
    refreshToken: refreshToken ? encrypt(refreshToken) : undefined,
    recoveryOnly,
    expires: Date.now() + 55 * 60 * 1000,
  });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
async function signedSession(allowExpired = false): Promise<Session | null> {
  try {
    const raw = (await cookies()).get(COOKIE)?.value;
    if (!raw) return null;
    const parts = raw.split(".");
    if (parts.length !== 2) return null;
    const [value, sig] = parts;
    if (!value || !sig || !equal(sign(value), sig)) return null;
    const session = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      typeof session.userId !== "string" ||
      !Number.isFinite(session.expires) ||
      (!allowExpired && session.expires <= Date.now()) ||
      (session.pilotOrganizationId !== undefined &&
        (typeof session.pilotOrganizationId !== "string" ||
          session.pilotOrganizationId.length > 80))
    )
      return null;
    return session;
  } catch {
    return null;
  }
}
async function verifiedSession(): Promise<Session | null> {
  try {
    const session = await signedSession();
    if (!session) return null;
    if (cloudDemoMode()) {
      if (
        !["demo-operator", "demo-merchant"].includes(session.userId) ||
        session.accessToken ||
        session.pilotOrganizationId
      )
        return null;
      await getDb();
      return session;
    }
    if (!localMode()) {
      if (
        typeof session.accessToken !== "string" ||
        !process.env.SUPABASE_URL ||
        !process.env.SUPABASE_ANON_KEY
      )
        return null;
      const identity = await verifyAccountIdentity(
        await getDb(),
        decrypt(session.accessToken),
      );
      if (identity.userId !== session.userId) return null;
      const [operator] = await (
        await getDb()
      ).query(
        "select user_id from memberships where user_id=$1 and role='operator' limit 1",
        [session.userId],
      );
      session.requiresElevation =
        identity.claims.aal !== "aal2" &&
        (identity.hasVerifiedFactor ||
          (!!operator && process.env.OPERATOR_MFA_REQUIRED === "true"));
    }
    return session;
  } catch {
    return null;
  }
}

// This route-level identity permits MFA setup without permitting business data.
export async function accountSession() {
  const session = await verifiedSession();
  if (!session?.accessToken || localMode())
    throw new RequestError("Sign in to your hosted account first.", 401);
  return {
    userId: session.userId,
    accessToken: decrypt(session.accessToken),
    refreshToken: session.refreshToken ? decrypt(session.refreshToken) : null,
    recoveryOnly: session.recoveryOnly === true,
  };
}
export async function connectedAccountSession() {
  const session = await accountSession();
  if (!session.refreshToken)
    throw new RequestError("Sign in again to manage account security.", 401);
  const client = accountAuthClient();
  const { error } = await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (error)
    throw new RequestError("Your session expired. Sign in again.", 401);
  return { session, client };
}
export async function logoutAccount() {
  // The sealed cookie was issued only after provider authentication. Reading it
  // here permits revocation even when the provider is temporarily unreachable.
  const session = await signedSession(true);
  let providerRevoked = true;
  if (session?.accessToken && !localMode()) {
    const accessToken = decrypt(session.accessToken);
    const claims = validatedAccountClaims(accessToken);
    if (claims.sub !== session.userId)
      throw new RequestError("Invalid account session.", 401);
    await revokeAccountSession(
      await getDb(),
      { userId: session.userId, email: "", hasVerifiedFactor: false, claims },
      "Account logout",
    );
    try {
      const { error } = await accountAuthClient().auth.admin.signOut(
        accessToken,
        "local",
      );
      providerRevoked = !error;
    } catch {
      providerRevoked = false;
    }
  }
  await clearSession();
  return providerRevoked;
}

export async function getActor(): Promise<Actor | null> {
  try {
    const session = await verifiedSession();
    if (!session || session.recoveryOnly || session.requiresElevation)
      return null;
    const db = await getDb();
    // Staging personas preserve the authenticated principal. Revocation takes effect on every request.
    if (session.pilotOrganizationId)
      return pilotPersona(db, session.userId, session.pilotOrganizationId);
    const [member] = await db.query<{
      user_id: string;
      role: "merchant" | "operator";
      organization_id: string;
      can_export: boolean;
    }>(
      /* A user can hold memberships in several organizations. The tiebreak is
         explicit so the same person does not land in a different store between
         two requests; choosing between them deliberately is a separate feature. */
      "select * from memberships where user_id=$1 order by role desc,organization_id limit 1",
      [session.userId],
    );
    if (
      member?.role === "operator" &&
      !localMode() &&
      process.env.OPERATOR_MFA_REQUIRED === "true"
    ) {
      if (!session.accessToken) return null;
      const claims = JSON.parse(
        Buffer.from(
          decrypt(session.accessToken).split(".")[1],
          "base64url",
        ).toString(),
      );
      if (claims.aal !== "aal2") return null;
    }
    return member
      ? {
          id: member.user_id,
          role: member.role,
          organizationId: member.organization_id,
          canExport: member.can_export,
        }
      : null;
  } catch {
    return null;
  }
}
export async function getPilotPrincipal() {
  const session = await verifiedSession();
  // Hosted pilot access always needs an actual provider session, even if a local flag is mistakenly present.
  if (
    !session?.accessToken ||
    session.recoveryOnly ||
    session.requiresElevation
  )
    return null;
  return pilotPrincipal(await getDb(), session.userId);
}
export async function switchPilotWorkspace(organizationId: string | null) {
  const session = await verifiedSession();
  const db = await getDb();
  const principal =
    session?.accessToken && !session.recoveryOnly && !session.requiresElevation
      ? await pilotPrincipal(db, session.userId)
      : null;
  if (!session || !principal)
    throw new RequestError(
      "This account does not have protected pilot access.",
      403,
    );
  if (
    organizationId &&
    !(await pilotPersona(db, session.userId, organizationId))
  )
    throw new RequestError(
      "Choose an available sample merchant workspace.",
      403,
    );
  await audit(
    db,
    principal.id,
    organizationId,
    "pilot.workspace_selected",
    organizationId || principal.organizationId,
    {
      persona: organizationId ? "merchant" : "operator",
      environment: "staging",
    },
  );
  await writeSession({
    ...session,
    pilotOrganizationId: organizationId || undefined,
  });
  return organizationId ? "/merchant" : "/operator/network";
}
export async function requireActor(operator = false) {
  const actor = await getActor();
  if (!actor) {
    const session = await verifiedSession();
    if (session?.recoveryOnly || session?.requiresElevation)
      redirect("/account/security");
    redirect("/login");
  }
  if (operator && actor.role !== "operator") redirect("/merchant");
  return actor;
}
