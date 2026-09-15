import { z } from "zod";
import type { DB } from "./db";
import { audit, rateLimit, type Actor } from "./domain";
import { id, token, hash, encrypt, decrypt, normalizePhone } from "./security";
import { RequestError } from "./http";
import { assertMemberAccountAccess } from "./member-service";
import { uptickEnvironment } from "./environment";

type PhoneChange = {
  id: string;
  request_id: string;
  member_id: string;
  new_phone_encrypted: string;
  token_encrypted: string;
  expires_at: string;
  confirmed_at: string | null;
  applied_at: string | null;
};
export async function preparePhoneCorrection(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  const input = z
    .object({
      requestId: z.string().min(1),
      newPhone: z.string().min(10).max(30),
      requestedByMember: z.literal(true),
    })
    .parse(raw);
  const newPhone = normalizePhone(input.newPhone),
    environment = uptickEnvironment();
  if (!environment) throw new RequestError("A valid environment is required.");
  return db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const [request] = await tx.query<{ member_id: string }>(
      "select member_id from privacy_requests where id=$1 and kind='correction' and state='verified' for update",
      [input.requestId],
    );
    if (!request)
      throw new RequestError(
        "Verify the original member’s correction request first.",
      );
    await assertMemberAccountAccess(tx, request.member_id);
    const [owner] = await tx.query<{ phone: string }>(
      "select c.phone from uptick_members m join customers c on c.id=m.customer_id where m.id=$1 for update of m,c",
      [request.member_id],
    );
    if (owner.phone === newPhone)
      throw new RequestError("That number is already on this account.");
    if (
      (await tx.query("select id from customers where phone=$1", [newPhone]))
        .length
    )
      throw new RequestError(
        "That number is associated with another account. Contact support for identity review; accounts cannot be merged by this action.",
      );
    const [existing] = await tx.query<PhoneChange>(
      "select * from member_phone_changes where request_id=$1",
      [input.requestId],
    );
    if (existing) {
      if (existing.confirmed_at || existing.applied_at)
        throw new RequestError(
          "This verification was already recorded or completed. Support can apply the verified correction; another number requires a new verified request.",
          409,
        );
      if (decrypt(existing.new_phone_encrypted) !== newPhone)
        throw new RequestError(
          "This verified request already has a different proposed number. Record and verify a new correction request.",
        );
      if (new Date(existing.expires_at) <= new Date() && !existing.confirmed_at)
        throw new RequestError(
          "This verification expired. Record and verify a new correction request to send another link.",
        );
      const [message] = await tx.query<{ id: string }>(
        "select id from member_messages where phone_change_id=$1",
        [existing.id],
      );
      return {
        changeId: existing.id,
        messageId: message.id,
        credential: decrypt(existing.token_encrypted),
      };
    }
    const changeId = id(),
      credential = token(),
      messageId = id(),
      expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
    await tx.query(
      "insert into member_phone_changes(id,request_id,member_id,new_phone_encrypted,token_hash,token_encrypted,expires_at,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        changeId,
        input.requestId,
        request.member_id,
        encrypt(newPhone),
        hash(credential),
        encrypt(credential),
        expiresAt,
        actor.id,
      ],
    );
    await tx.query(
      "insert into member_messages(id,member_id,purpose,phone_change_id,sender_id,expires_at,environment,recipient_encrypted,recipient_hint) values($1,$2,'phone_change',$3,(select id from member_senders where active),$4,$5,$6,$7)",
      [
        messageId,
        request.member_id,
        changeId,
        expiresAt,
        environment,
        encrypt(newPhone),
        newPhone.slice(-4),
      ],
    );
    await audit(
      tx,
      actor.id,
      null,
      "phone_correction_verification_requested",
      changeId,
      { memberId: request.member_id, requestId: input.requestId },
    );
    return { changeId, messageId, credential };
  });
}
export async function phoneCorrectionPreview(db: DB, credential: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential))
    throw new RequestError("This verification link is unavailable.", 404);
  const [change] = await db.query<PhoneChange>(
    "select * from member_phone_changes where token_hash=$1",
    [hash(credential)],
  );
  if (!change || change.applied_at || new Date(change.expires_at) <= new Date())
    throw new RequestError(
      "This verification link expired or was already completed. Contact Uptick support.",
      410,
    );
  return {
    phoneHint: decrypt(change.new_phone_encrypted).slice(-4),
    confirmed: !!change.confirmed_at,
  };
}
export async function confirmPhoneCorrection(db: DB, credential: string) {
  await rateLimit(db, `phone-correction:${hash(credential)}`, 10, 3600);
  return db.transaction(async (tx) => {
    await phoneCorrectionPreview(tx, credential);
    const [change] = await tx.query<PhoneChange>(
      "select * from member_phone_changes where token_hash=$1 for update",
      [hash(credential)],
    );
    if (
      !change ||
      change.applied_at ||
      new Date(change.expires_at) <= new Date()
    )
      throw new RequestError(
        "This verification link expired or was already completed. Contact Uptick support.",
        410,
      );
    if (change.confirmed_at)
      throw new RequestError(
        "This verification was already recorded. Support will complete the correction.",
        409,
      );
    await assertMemberAccountAccess(tx, change.member_id);
    await tx.query(
      "update member_phone_changes set confirmed_at=now() where id=$1",
      [change.id],
    );
    await audit(
      tx,
      change.member_id,
      null,
      "phone_correction_number_verified",
      change.id,
      { memberId: change.member_id },
    );
    return change.id;
  });
}
// Caller owns the verified privacy-request transaction and coordination lock.
export async function applyPhoneCorrection(
  tx: DB,
  actor: Actor,
  requestId: string,
  memberId: string,
) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  if (
    !(
      await tx.query(
        "select id from privacy_requests where id=$1 and member_id=$2 and kind='correction' and state='verified'",
        [requestId, memberId],
      )
    ).length
  )
    throw new RequestError(
      "A verified correction request for this member is required.",
    );
  const [change] = await tx.query<PhoneChange>(
    "select * from member_phone_changes where request_id=$1 and member_id=$2 for update",
    [requestId, memberId],
  );
  if (
    !change?.confirmed_at ||
    change.applied_at ||
    Date.now() - new Date(change.confirmed_at).getTime() > 86400000
  )
    throw new RequestError(
      "The new number must be verified within the last 24 hours before support applies the correction.",
    );
  const newPhone = decrypt(change.new_phone_encrypted);
  if (
    (await tx.query("select id from customers where phone=$1", [newPhone]))
      .length
  )
    throw new RequestError(
      "That number now belongs to another account. This correction cannot merge or replace it.",
    );
  await tx.query(
    "update member_phone_changes set applied_at=now() where id=$1",
    [change.id],
  );
  await tx.query("select set_config('uptick.phone_correction_id',$1,true)", [
    change.id,
  ]);
  await tx.query(
    "update customers set phone=$2 where id=(select customer_id from uptick_members where id=$1)",
    [memberId, newPhone],
  );
  const claims = await tx.query<{ id: string }>(
    "select id from claims where customer_id=(select customer_id from uptick_members where id=$1)",
    [memberId],
  );
  for (const claim of claims) {
    const credential = token();
    await tx.query(
      "update claims set token_hash=$2,token_encrypted=$3 where id=$1",
      [claim.id, hash(credential), encrypt(credential)],
    );
  }
  await tx.query("select set_config('uptick.phone_correction_id','',true)");
  await tx.query(
    "update member_sessions set revoked_at=now() where member_id=$1 and revoked_at is null",
    [memberId],
  );
  await tx.query(
    "update member_recovery_codes set revoked_at=now() where member_id=$1 and revoked_at is null and used_at is null",
    [memberId],
  );
  await tx.query(
    "update member_access set token_hash='revoked:'||id,token_encrypted='erased' where member_id=$1",
    [memberId],
  );
  await tx.query(
    "update member_messages set state=case when state='submitting' then 'unknown' else 'suppressed' end,suppression_reason='Verified phone correction; prior recipient must not be retargeted.',updated_at=now() where member_id=$1 and state in ('queued','submitting')",
    [memberId],
  );
  const { recordMemberConsent } = await import("./membership-identity");
  await recordMemberConsent(
    tx,
    memberId,
    false,
    "verified-phone-correction",
    "Promotional consent is off after a verified phone change. Fresh web opt-in is required.",
    "opt_out",
  );
  await audit(tx, actor.id, null, "phone_correction_applied", change.id, {
    memberId,
    requestId,
    rotatedPasses: claims.length,
  });
  return change.id;
}
