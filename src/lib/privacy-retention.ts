import { z } from "zod";
import type { DB } from "./db";
import type { Actor } from "./domain";
import { audit } from "./domain";
import { RequestError } from "./http";
import { id, encrypt } from "./security";

const removedNote =
  "Personal details removed under a verified privacy request.";
type Note = {
  table_name: string;
  row_id: string;
  field: string;
  value: string;
};
const noteSources = [
  {
    table: "member_service_events",
    key: "id",
    fields: ["reason"],
    where: "member_id=$1",
  },
  {
    table: "member_destination_reviews",
    key: "id",
    fields: ["evidence"],
    where: "member_id=$1",
  },
  {
    table: "fulfillment_incidents",
    key: "id",
    fields: ["report_note", "resolution"],
    where: "member_id=$1",
  },
  {
    table: "recovery_failures",
    key: "recovery_id",
    fields: ["reason"],
    where: "recovery_id in(select id from recovery_grants where member_id=$1)",
  },
  {
    table: "redemption_evidence",
    key: "id",
    fields: ["reason"],
    where:
      "claim_id in(select id from claims where customer_id=(select customer_id from uptick_members where id=$1))",
  },
  {
    table: "recovery_redemptions",
    key: "id",
    fields: ["reason"],
    where:
      "recovery_grant_id in(select id from recovery_grants where member_id=$1)",
  },
  {
    table: "audit_events",
    key: "id",
    fields: ["detail"],
    where:
      "(detail->>'memberId'=$1 or entity_id=$1 or entity_id in(select id from member_service_events where member_id=$1 union select id from fulfillment_grants where member_id=$1 union select id from fulfillment_incidents where member_id=$1 union select id from recovery_grants where member_id=$1 union select id from privacy_requests where member_id=$1 union select id from claims where customer_id=(select customer_id from uptick_members where id=$1)))",
  },
] as const;
function operator(actor: Actor) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
}
export async function memberRetentionNotes(
  db: DB,
  actor: Actor,
  memberId: string,
) {
  operator(actor);
  const notes: Note[] = [];
  for (const source of noteSources)
    for (const field of source.fields) {
      // All identifiers and predicates are fixed server-owned constants.
      const auditDetail = source.table === "audit_events";
      const rows = await db.query<{ row_id: string; value: string }>(
        `select ${source.key} row_id,${field}::text value from ${source.table} where ${source.where} and ${auditDetail ? "detail is distinct from privacy_scrub_audit_detail(detail)" : `${field} is not null and ${field}<>'' and ${field}<>$2`}`,
        auditDetail ? [memberId] : [memberId, removedNote],
      );
      notes.push(
        ...rows.map((row) => ({ table_name: source.table, field, ...row })),
      );
    }
  return notes;
}
export async function redactMemberRetentionNotes(
  db: DB,
  actor: Actor,
  requestId: string,
) {
  operator(actor);
  return db.transaction(async (tx) => {
    const [request] = await tx.query<{ member_id: string }>(
      "select member_id from privacy_requests where id=$1 and kind='deletion' and state in ('verified','completed') for update",
      [requestId],
    );
    if (!request)
      throw new RequestError(
        "Verify the member's deletion request before removing personal notes.",
      );
    const notes = await memberRetentionNotes(tx, actor, request.member_id);
    for (const note of notes) {
      const source = noteSources.find((s) => s.table === note.table_name)!;
      const redactionId = id();
      await tx.query(
        "insert into privacy_note_redactions(id,request_id,member_id,table_name,row_id,fields,actor_id) values($1,$2,$3,$4,$5,$6,$7)",
        [
          redactionId,
          requestId,
          request.member_id,
          note.table_name,
          note.row_id,
          [note.field],
          actor.id,
        ],
      );
      await tx.query(
        "select set_config('uptick.privacy_redaction_id',$1,true)",
        [redactionId],
      );
      if (source.table === "audit_events")
        await tx.query(
          "update audit_events set detail=privacy_scrub_audit_detail(detail) where id=$1",
          [note.row_id],
        );
      else
        await tx.query(
          `update ${source.table} set ${note.field}=$2 where ${source.key}=$1`,
          [note.row_id, removedNote],
        );
    }
    await tx.query("select set_config('uptick.privacy_redaction_id','',true)");
    await audit(tx, actor.id, null, "privacy_note_redaction", requestId, {
      memberId: request.member_id,
      removedFields: notes.length,
    });
    return notes.length;
  });
}
export async function completeRetentionReview(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  operator(actor);
  const input = z
    .object({
      memberId: z.string().min(1),
      category: z.enum(["consent", "operational", "financial"]),
      outcome: z.enum(["deidentified", "hold"]),
      evidence: z.string().trim().min(20).max(2000),
      nextReviewAt: z.iso.datetime().optional(),
      identifiersReviewed: z.literal(true),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const [member] = await tx.query(
      "select member_id from member_erasure_records where member_id=$1 for update",
      [input.memberId],
    );
    if (!member)
      throw new RequestError(
        "Complete verified identifier erasure before reviewing retained evidence.",
      );
    const [policy] = await tx.query<{ id: string }>(
      "select id from privacy_policy_versions where review_due_at>now() order by sequence desc limit 1",
    );
    if (!policy)
      throw new RequestError(
        "Record a current approved retention policy first.",
      );
    if (
      input.outcome === "hold" &&
      (!input.nextReviewAt || new Date(input.nextReviewAt) <= new Date())
    )
      throw new RequestError(
        "A hold needs a future review date and documented approval.",
      );
    if (
      input.outcome === "deidentified" &&
      (await memberRetentionNotes(tx, actor, input.memberId)).length
    )
      throw new RequestError(
        "Remove remaining member notes before closing identified retention.",
      );
    const reviewId = id();
    await tx.query(
      "insert into privacy_retention_reviews(id,member_id,category,outcome,policy_id,evidence_encrypted,next_review_at,actor_id) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        reviewId,
        input.memberId,
        input.category,
        input.outcome,
        policy.id,
        encrypt(input.evidence),
        input.outcome === "hold" ? input.nextReviewAt : null,
        actor.id,
      ],
    );
    await audit(tx, actor.id, null, "privacy_retention_review", reviewId, {
      memberId: input.memberId,
      category: input.category,
      outcome: input.outcome,
      nextReviewAt: input.outcome === "hold" ? input.nextReviewAt : null,
    });
    return reviewId;
  });
}
