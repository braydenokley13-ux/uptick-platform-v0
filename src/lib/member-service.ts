import { z } from "zod";
import type { DB } from "./db";
import { audit, type Actor } from "./domain";
import { RequestError } from "./http";
import { id } from "./security";

export const serviceKinds = [
  "withdrawn",
  "suspended",
  "deletion_pending",
  "inaccessible",
  "geography_changed",
  "resumed",
] as const;
export type ServiceStatus = {
  member_id: string;
  event_id: string;
  kind: (typeof serviceKinds)[number];
  reason: string;
  created_at: string;
  blocks_future_release: boolean;
  blocks_account_access: boolean;
};
export async function memberServiceStatus(db: DB, memberId: string) {
  const [status] = await db.query<ServiceStatus>(
    "select * from member_service_status where member_id=$1",
    [memberId],
  );
  return status || null;
}
export async function assertMemberAccountAccess(db: DB, memberId: string) {
  const [erased] = await db.query(
    "select member_id from member_erasure_records where member_id=$1",
    [memberId],
  );
  if (erased)
    throw new RequestError(
      "This account was erased. Contact Uptick support about any retained obligation.",
      403,
    );
  if ((await memberServiceStatus(db, memberId))?.blocks_account_access)
    throw new RequestError(
      "This account needs Uptick support before access can be restored.",
      403,
    );
}
export async function operationalPilotAudience(db: DB, runId: string) {
  const rows = await db.query<{
    member_id: string;
    data_kind: string;
    service_event_id: string | null;
    service_kind: string | null;
    excluded: boolean;
  }>(
    `select a.member_id,a.data_kind,s.event_id service_event_id,s.kind service_kind,
      coalesce(s.blocks_future_release,false) excluded
     from pilot_admissions a left join member_service_status s on s.member_id=a.member_id
     where a.run_id=$1 order by a.member_id`,
    [runId],
  );
  return {
    admitted: rows.length,
    included: rows.filter((row) => !row.excluded),
    excluded: rows.filter((row) => row.excluded),
  };
}

export async function recordMemberServiceEvent(
  db: DB,
  principal: Actor | { memberId: string },
  raw: unknown,
) {
  const input = z
    .object({
      memberId: z.string().min(1).max(100),
      kind: z.enum(serviceKinds),
      reason: z.string().trim().min(10).max(1500),
      requestKey: z.string().min(8).max(200),
    })
    .parse(raw);
  const self = "memberId" in principal;
  if (
    self
      ? principal.memberId !== input.memberId ||
        !["withdrawn", "geography_changed"].includes(input.kind)
      : principal.role !== "operator"
  )
    throw new RequestError("You cannot change this account status.", 403);
  const actorId = self ? principal.memberId : principal.id;
  return db.transaction(async (tx) => {
    // Same coordination lock as publication: a release sees the entire event or none of it.
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const [member] = await tx.query<{ id: string }>(
      "select id from uptick_members where id=$1 for update",
      [input.memberId],
    );
    if (!member) throw new RequestError("Choose an existing member.", 404);
    const [existing] = await tx.query<{
      id: string;
      member_id: string;
      kind: string;
      reason: string;
      actor_id: string;
    }>("select * from member_service_events where request_key=$1", [
      input.requestKey,
    ]);
    if (existing) {
      if (
        existing.member_id !== input.memberId ||
        existing.kind !== input.kind ||
        existing.reason !== input.reason ||
        existing.actor_id !== actorId
      )
        throw new RequestError(
          "This account-status request was already used for different details.",
        );
      return existing.id;
    }
    const previous = await memberServiceStatus(tx, input.memberId);
    if (
      input.kind === "resumed" &&
      (
        await tx.query(
          "select member_id from member_erasure_records where member_id=$1",
          [input.memberId],
        )
      ).length
    )
      throw new RequestError(
        "An erased account cannot be reactivated. Its historical cohort remains intact.",
      );
    if (self && previous?.blocks_account_access)
      throw new RequestError("Contact Uptick support about this account.", 403);
    const eventId = id();
    await tx.query(
      "insert into member_service_events(id,member_id,kind,reason,actor_id,actor_kind,request_key) values($1,$2,$3,$4,$5,$6,$7)",
      [
        eventId,
        input.memberId,
        input.kind,
        input.reason,
        actorId,
        self ? "member" : "operator",
        input.requestKey,
      ],
    );
    if (["suspended", "deletion_pending"].includes(input.kind)) {
      await tx.query(
        "update member_sessions set revoked_at=now() where member_id=$1 and revoked_at is null",
        [input.memberId],
      );
      await tx.query(
        "update member_recovery_codes set revoked_at=now() where member_id=$1 and revoked_at is null and used_at is null",
        [input.memberId],
      );
    }
    await audit(
      tx,
      actorId,
      self ? null : principal.organizationId,
      "member_service_disposition",
      eventId,
      {
        memberId: input.memberId,
        kind: input.kind,
        previousEventId: previous?.event_id || null,
        reason: input.reason,
      },
    );
    return eventId;
  });
}
