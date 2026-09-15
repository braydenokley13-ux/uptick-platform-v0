import type { DB } from "./db";
import { localMode } from "./config";
import { hash, id, normalizePhone, token } from "./security";
import { RequestError } from "./http";
import { assertMemberAccountAccess } from "./member-service";

export const MEMBER_SESSION_COOKIE = "uptick-member-access";
export const MEMBER_SESSION_SECONDS = 30 * 24 * 60 * 60;

export type MemberSession = {
  id: string;
  member_id: string;
  source_access_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export function memberSessionCookie(value: string) {
  return {
    name: MEMBER_SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      secure: !localMode(),
      sameSite: "lax" as const,
      path: "/",
      maxAge: MEMBER_SESSION_SECONDS,
    },
  };
}

export async function createMemberSession(
  db: DB,
  memberId: string,
  sourceAccessId: string | null = null,
) {
  await assertMemberAccountAccess(db, memberId);
  const credential = token();
  const [session] = await db.query<MemberSession>(
    `insert into member_sessions(id,member_id,source_access_id,token_hash,expires_at)
     values($1,$2,$3,$4,now()+interval '30 days') returning *`,
    [id(), memberId, sourceAccessId, hash(credential)],
  );
  return { session, credential };
}

export async function memberSession(db: DB, credential: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) return null;
  const [session] = await db.query<MemberSession>(
    `select id,member_id,source_access_id,expires_at,revoked_at,created_at
       from member_sessions
      where token_hash=$1 and revoked_at is null and expires_at>now()`,
    [hash(credential)],
  );
  if (session)
    await db.query(
      "update member_sessions set last_seen_at=now() where id=$1 and last_seen_at<now()-interval '15 minutes'",
      [session.id],
    );
  return session || null;
}

export async function revokeMemberSession(db: DB, credential: string) {
  const session = await memberSession(db, credential);
  if (!session) return false;
  await db.query("update member_sessions set revoked_at=now() where id=$1", [
    session.id,
  ]);
  return true;
}

function printableRecoveryCode() {
  const raw = token()
    .replaceAll("-", "A")
    .replaceAll("_", "B")
    .slice(0, 20)
    .toUpperCase();
  return raw.match(/.{1,5}/g)!.join("-");
}

export async function replaceMemberRecoveryCodes(db: DB, memberId: string) {
  return db.transaction(async (tx) => {
    await tx.query("select id from uptick_members where id=$1 for update", [
      memberId,
    ]);
    await tx.query(
      "update member_recovery_codes set revoked_at=now() where member_id=$1 and used_at is null and revoked_at is null",
      [memberId],
    );
    const codes = Array.from({ length: 8 }, printableRecoveryCode);
    for (const code of codes)
      await tx.query(
        `insert into member_recovery_codes(id,member_id,code_hash,expires_at)
         values($1,$2,$3,now()+interval '1 year')`,
        [id(), memberId, hash(code.replaceAll("-", ""))],
      );
    return codes;
  });
}

export async function recoverMemberSession(
  db: DB,
  input: { phone: string; code: string },
) {
  const phone = normalizePhone(input.phone);
  const code = input.code.trim().toUpperCase().replaceAll("-", "");
  if (!/^[A-Z0-9]{20}$/.test(code))
    throw new RequestError("Check the recovery code and try again.", 401);
  return db.transaction(async (tx) => {
    const [recovery] = await tx.query<{ id: string; member_id: string }>(
      `select r.id,r.member_id from member_recovery_codes r
       join uptick_members m on m.id=r.member_id
       join customers c on c.id=m.customer_id
       where r.code_hash=$1 and c.phone=$2 and r.used_at is null
         and r.revoked_at is null and r.expires_at>now()
       for update of r`,
      [hash(code), phone],
    );
    if (!recovery)
      throw new RequestError("Check the recovery code and try again.", 401);
    const [member] = await tx.query<{ verified_at: string | null }>(
      "select verified_at from uptick_members where id=$1 for update",
      [recovery.member_id],
    );
    if (!member?.verified_at)
      throw new RequestError("This membership is not verified.", 403);
    await tx.query(
      "update member_recovery_codes set used_at=now() where id=$1",
      [recovery.id],
    );
    const session = await createMemberSession(tx, recovery.member_id);
    return { ...session, memberId: recovery.member_id };
  });
}
