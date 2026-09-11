import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { localMode } from "./config";
import { sign, equal, encrypt, decrypt } from "./security";
import { getDb } from "./db";
import { pilotPersona, pilotPrincipal } from "./pilot-access";
import { audit, type Actor } from "./domain";
import { RequestError } from "./http";
const COOKIE = "uptick-session";
type Session = {
  userId: string;
  accessToken?: string;
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
export async function setSession(userId: string, accessToken?: string) {
  await writeSession({
    userId,
    accessToken: accessToken ? encrypt(accessToken) : undefined,
    expires: Date.now() + 55 * 60 * 1000,
  });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
async function verifiedSession(): Promise<Session | null> {
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
      session.expires <= Date.now() ||
      (session.pilotOrganizationId !== undefined &&
        (typeof session.pilotOrganizationId !== "string" ||
          session.pilotOrganizationId.length > 80))
    )
      return null;
    if (!localMode()) {
      if (
        typeof session.accessToken !== "string" ||
        !process.env.SUPABASE_URL ||
        !process.env.SUPABASE_ANON_KEY
      )
        return null;
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        { auth: { persistSession: false } },
      );
      const { data, error } = await supabase.auth.getUser(
        decrypt(session.accessToken),
      );
      if (error || data.user?.id !== session.userId) return null;
    }
    return session;
  } catch {
    return null;
  }
}
export async function getActor(): Promise<Actor | null> {
  try {
    const session = await verifiedSession();
    if (!session) return null;
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
      "select * from memberships where user_id=$1 order by role desc limit 1",
      [session.userId],
    );
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
  if (!session?.accessToken) return null;
  return pilotPrincipal(await getDb(), session.userId);
}
export async function switchPilotWorkspace(organizationId: string | null) {
  const session = await verifiedSession();
  const db = await getDb();
  const principal = session?.accessToken
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
  if (!actor) redirect("/login");
  if (operator && actor.role !== "operator") redirect("/merchant");
  return actor;
}
