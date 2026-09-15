import {
  createClient,
  type SupportedStorage,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { z } from "zod";
import type { DB } from "./db";
import { demoMode } from "./demo-guard";
import { audit, type Actor } from "./domain";
import { RequestError } from "./http";

export function accountAuthClient() {
  if (demoMode() || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)
    throw new RequestError(
      "Hosted account security is unavailable in this environment.",
      503,
    );
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// Call only after getUser validation, or when reading a server-sealed session
// that was issued after provider authentication (for logout revocation only).
export function validatedAccountClaims(accessToken: string) {
  try {
    return z
      .object({
        session_id: z.uuid(),
        sub: z.uuid(),
        aal: z.enum(["aal1", "aal2"]),
        exp: z.number(),
      })
      .parse(
        JSON.parse(
          Buffer.from(accessToken.split(".")[1], "base64url").toString(),
        ),
      );
  } catch {
    throw new RequestError(
      "Your account session has expired. Sign in again.",
      401,
    );
  }
}

export async function verifyAccountIdentity(
  db: DB,
  accessToken: string,
  client = accountAuthClient(),
) {
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user)
    throw new RequestError(
      "Your account session has expired. Sign in again.",
      401,
    );
  const claims = validatedAccountClaims(accessToken);
  if (claims.sub !== data.user.id || claims.exp * 1000 <= Date.now())
    throw new RequestError(
      "Your account session has expired. Sign in again.",
      401,
    );
  const [active] = await db.query(
    `select s.id from auth.sessions s where s.id=$1::uuid and s.user_id=$2::uuid
     and not exists(select 1 from account_session_revocations r where r.session_id=s.id::text)`,
    [claims.session_id, data.user.id],
  );
  if (!active)
    throw new RequestError(
      "This account session was revoked. Sign in again.",
      401,
    );
  return {
    userId: data.user.id,
    email: data.user.email || "",
    hasVerifiedFactor:
      data.user.factors?.some((f) => f.status === "verified") === true,
    claims,
  };
}

export async function businessMembership(db: DB, userId: string) {
  const [member] = await db.query<{
    role: "operator" | "merchant";
    organization_id: string;
  }>(
    "select role,organization_id from memberships where user_id=$1 order by role desc,organization_id limit 1",
    [userId],
  );
  if (!member)
    throw new RequestError(
      "Your account has not been assigned business access.",
      403,
    );
  return member;
}

export async function accountFactors(client: SupabaseClient) {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error || !data)
    throw new RequestError(
      "Authenticators could not be loaded. Try again.",
      503,
    );
  return data.all.map((f) => ({
    id: f.id,
    name: f.friendly_name || "Authenticator",
    status: f.status,
    type: f.factor_type,
  }));
}

export function assertFactorAction(
  action: "enroll" | "verify" | "remove",
  aal: string,
  factors: Awaited<ReturnType<typeof accountFactors>>,
  factorId?: string,
) {
  const verified = factors.filter((f) => f.status === "verified");
  const selected = factors.find((f) => f.id === factorId);
  if (action !== "enroll" && !selected)
    throw new RequestError("Choose one of this account's authenticators.", 403);
  if (selected && selected.type !== "totp")
    throw new RequestError(
      "This account has a different factor type. Use verified provider recovery with your operator to commission a TOTP authenticator.",
      403,
    );
  if (
    (action === "enroll" || selected?.status !== "verified") &&
    verified.length &&
    aal !== "aal2"
  )
    throw new RequestError(
      "Verify an existing authenticator before changing account security.",
      403,
    );
  if (
    action === "remove" &&
    selected?.status === "verified" &&
    (aal !== "aal2" || verified.filter((f) => f.type === "totp").length < 2)
  )
    throw new RequestError(
      "Verify your session and keep another working authenticator before removing this one.",
      403,
    );
}

export async function revokeAccountSession(
  db: DB,
  identity: Awaited<ReturnType<typeof verifyAccountIdentity>>,
  reason: string,
) {
  await db.transaction(async (tx) => {
    await tx.query(
      "insert into account_session_revocations(session_id,user_id,reason) values($1,$2,$3) on conflict do nothing",
      [identity.claims.session_id, identity.userId, reason],
    );
    await audit(
      tx,
      identity.userId,
      null,
      "account.session_revoked",
      identity.claims.session_id,
      { reason },
    );
  });
}

export async function revokeBusinessAccess(db: DB, actor: Actor, raw: unknown) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  const input = z
    .object({ userId: z.uuid(), reason: z.string().trim().min(10).max(1000) })
    .parse(raw);
  if (actor.id === input.userId)
    throw new RequestError("Ask the backup operator to remove your access.");
  await db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const removed = await tx.query(
      "delete from memberships where user_id=$1 returning organization_id",
      [input.userId],
    );
    if (!removed.length)
      throw new RequestError("This account has no business access to remove.");
    await tx.query(
      `insert into account_session_revocations(session_id,user_id,reason)
      select id::text,user_id::text,'Operator removed account access' from auth.sessions where user_id=$1::uuid on conflict do nothing`,
      [input.userId],
    );
    await audit(tx, actor.id, null, "account.access_removed", input.userId, {
      reason: input.reason,
      organizationCount: removed.length,
    });
  });
}

export async function assignBusinessAccess(db: DB, actor: Actor, raw: unknown) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  const input = z
    .object({
      email: z.email(),
      organizationId: z.string().min(1).max(80),
      role: z.enum(["operator", "merchant"]),
      canExport: z.boolean().default(false),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const users = await tx.query<{ id: string }>(
      "select id::text from auth.users where lower(email)=lower($1) and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<=now())",
      [input.email.trim()],
    );
    if (users.length !== 1)
      throw new RequestError(
        "Create and verify this account in the connected authentication provider first, then enter its exact email.",
      );
    if (users[0].id === actor.id)
      throw new RequestError("Ask another operator to change your own access.");
    const [organization] = await tx.query(
      "select id from organizations where id=$1",
      [input.organizationId],
    );
    if (!organization) throw new RequestError("Choose an existing business.");
    await tx.query(
      "insert into memberships(user_id,organization_id,role,can_export) values($1,$2,$3,$4) on conflict(user_id,organization_id) do update set role=excluded.role,can_export=excluded.can_export",
      [users[0].id, input.organizationId, input.role, input.canExport],
    );
    await audit(
      tx,
      actor.id,
      input.organizationId,
      "membership.assigned",
      users[0].id,
      { role: input.role, canExport: input.canExport },
    );
  });
}

// Explicit flow IDs bind each recovery callback to its own PKCE verifier.
// The pinned SDK exposes this option as experimental; the two-flow regression
// exercises its actual request/response behavior before a release can rely on it.
export function accountRecoveryOptions(storage: SupportedStorage) {
  return {
    auth: {
      storageKey: "uptick-recovery",
      storage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce" as const,
      experimental: { appendPkceFlowIdToRedirects: true },
    },
  };
}
