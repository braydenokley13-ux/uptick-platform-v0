import { createHmac } from "node:crypto";
import { z } from "zod";
import type { DB } from "./db";
import { localMode, key } from "./config";
import { audit, type Actor } from "./domain";
import { RequestError } from "./http";
import { id, encrypt, decrypt } from "./security";
import { memberRetentionNotes } from "./privacy-retention";

export const privacyKinds = [
  "access",
  "correction",
  "deletion",
  "revoke_sessions",
] as const;
const categories = [
  "identifiers",
  "support",
  "consent",
  "operational",
  "financial",
] as const;
type Policy = {
  id: string;
  scope: string;
  retention_days: Record<(typeof categories)[number], number>;
  review_due_at: string;
};
type PrivacyRequest = {
  id: string;
  member_id: string;
  kind: (typeof privacyKinds)[number];
  state: string;
  note_encrypted: string;
  created_at: string;
  request_key: string;
  request_fingerprint: string;
  verified_by: string | null;
};
function operator(actor: Actor) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
}
export function privacyPhoneFingerprint(phone: string) {
  const secret =
    process.env.PRIVACY_SUPPRESSION_KEY ||
    (localMode() ? key("PASS_ENCRYPTION_KEY") : "");
  if (secret.length < 32)
    throw new RequestError(
      "Configure the private suppression key before privacy administration.",
      503,
    );
  return createHmac("sha256", secret).update(phone).digest("hex");
}
export async function privacyPolicy(db: DB) {
  const [policy] = await db.query<Policy>(
    "select * from privacy_policy_versions order by sequence desc limit 1",
  );
  return policy || null;
}
export async function assertPrivacyEnrollmentReady(db: DB) {
  const policy = await privacyPolicy(db);
  if (
    !policy ||
    new Date(policy.review_due_at) <= new Date() ||
    (process.env.PRIVACY_SUPPRESSION_KEY?.length || 0) < 32
  )
    throw new RequestError(
      "Real enrollment is waiting for approved privacy and retention settings.",
      503,
    );
}
export async function savePrivacyPolicy(db: DB, actor: Actor, raw: unknown) {
  operator(actor);
  const input = z
    .object({
      scope: z.string().trim().min(10).max(1500),
      approvalEvidence: z.string().trim().min(20).max(2000),
      reviewDueAt: z.iso.datetime(),
      retentionDays: z.object({
        identifiers: z.coerce.number().int().min(0).max(36500),
        support: z.coerce.number().int().min(0).max(36500),
        consent: z.coerce.number().int().min(0).max(36500),
        operational: z.coerce.number().int().min(0).max(36500),
        financial: z.coerce.number().int().min(0).max(36500),
      }),
    })
    .parse(raw);
  if (new Date(input.reviewDueAt) <= new Date())
    throw new RequestError("Choose a future policy review date.");
  return db.transaction(async (tx) => {
    const policyId = id();
    await tx.query(
      "insert into privacy_policy_versions(id,scope,retention_days,approval_evidence,approved_by,review_due_at) values($1,$2,$3,$4,$5,$6)",
      [
        policyId,
        input.scope,
        input.retentionDays,
        input.approvalEvidence,
        actor.id,
        input.reviewDueAt,
      ],
    );
    await audit(tx, actor.id, null, "privacy_policy_approved", policyId, {
      scope: input.scope,
      retentionDays: input.retentionDays,
      reviewDueAt: input.reviewDueAt,
    });
    return policyId;
  });
}
export async function createPrivacyRequest(
  db: DB,
  principal: Actor | { memberId: string },
  raw: unknown,
) {
  const input = z
    .object({
      memberId: z.string().min(1).max(100),
      kind: z.enum(privacyKinds),
      note: z.string().trim().min(10).max(2000),
      requestKey: z.string().min(8).max(200),
    })
    .parse(raw);
  const fingerprint = createHmac("sha256", key("PASS_ENCRYPTION_KEY"))
    .update(JSON.stringify([input.memberId, input.kind, input.note]))
    .digest("hex");
  const self = "memberId" in principal;
  if (
    self ? principal.memberId !== input.memberId : principal.role !== "operator"
  )
    throw new RequestError("This privacy request is not authorized.", 403);
  return db.transaction(async (tx) => {
    const [existing] = await tx.query<PrivacyRequest>(
      "select * from privacy_requests where request_key=$1",
      [input.requestKey],
    );
    if (existing) {
      if (
        existing.member_id !== input.memberId ||
        existing.kind !== input.kind ||
        existing.request_fingerprint !== fingerprint
      )
        throw new RequestError(
          "This request key was already used for different privacy details.",
        );
      return existing.id;
    }
    const requestId = id(),
      actorId = self ? principal.memberId : principal.id;
    await tx.query(
      "insert into privacy_requests(id,member_id,kind,note_encrypted,request_key,requested_by,request_fingerprint) values($1,$2,$3,$4,$5,$6,$7)",
      [
        requestId,
        input.memberId,
        input.kind,
        encrypt(input.note),
        input.requestKey,
        actorId,
        fingerprint,
      ],
    );
    await tx.query(
      "insert into privacy_request_events(id,request_id,action,actor_id) values($1,$2,'requested',$3)",
      [id(), requestId, actorId],
    );
    return requestId;
  });
}
export async function verifyPrivacyRequest(db: DB, actor: Actor, raw: unknown) {
  operator(actor);
  const input = z
    .object({
      requestId: z.string().min(1),
      evidence: z.string().trim().min(10).max(1500),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const [request] = await tx.query<PrivacyRequest>(
      "select * from privacy_requests where id=$1 for update",
      [input.requestId],
    );
    if (!request || request.state !== "queued")
      throw new RequestError(
        "Choose a queued request; verification is recorded once.",
      );
    await tx.query(
      "update privacy_requests set state='verified',verified_by=$2,verified_at=now(),verification_encrypted=$3 where id=$1",
      [request.id, actor.id, encrypt(input.evidence)],
    );
    await tx.query(
      "insert into privacy_request_events(id,request_id,action,actor_id) values($1,$2,'identity_verified',$3)",
      [id(), request.id, actor.id],
    );
    return request.id;
  });
}
export async function exportMemberData(
  db: DB,
  actor: Actor | { memberId: string },
  requestId: string,
) {
  if (!("memberId" in actor)) operator(actor);
  const [request] = await db.query<PrivacyRequest>(
    "select * from privacy_requests where id=$1 and kind='access' and state in ('verified','completed')",
    [requestId],
  );
  if (!request || ("memberId" in actor && actor.memberId !== request.member_id))
    throw new RequestError(
      "Verify this member's data-access request first.",
      403,
    );
  const [member] = await db.query(
    "select m.id,m.home_zip,m.work_zip,m.market_id,m.state,m.data_kind,m.verified_at,m.created_at,c.phone from uptick_members m join customers c on c.id=m.customer_id where m.id=$1",
    [request.member_id],
  );
  const [
    consents,
    admissions,
    benefits,
    incidents,
    recoveries,
    service,
    messages,
    support,
  ] = await Promise.all([
    db.query(
      "select accepted,disclosure_version,disclosure,source_ui,consent_purpose,consent_action,created_at from member_consents where member_id=$1 order by sequence",
      [request.member_id],
    ),
    db.query(
      "select run_id,admitted_at,data_kind from pilot_admissions where member_id=$1",
      [request.member_id],
    ),
    db.query(
      "select id,week_key,member_snapshot,state,created_at,claimed_at,redeemed_at from fulfillment_grants where member_id=$1 order by created_at",
      [request.member_id],
    ),
    db.query(
      "select incident_type,severity,occurred_at,state,report_note,resolution from fulfillment_incidents where member_id=$1 order by occurred_at",
      [request.member_id],
    ),
    db.query(
      "select id,original_grant_id,member_snapshot,state,issued_at,redeemed_at,superseded_at from recovery_grants where member_id=$1 order by issued_at",
      [request.member_id],
    ),
    db.query(
      "select kind,reason,actor_kind,created_at from member_service_events where member_id=$1 order by sequence",
      [request.member_id],
    ),
    db.query(
      "select purpose,state,scheduled_at,created_at,error_code from member_messages where member_id=$1 order by created_at",
      [request.member_id],
    ),
    db.query<{
      origin: string;
      body_encrypted: string | null;
      resolution_encrypted: string | null;
      state: string;
      created_at: string;
    }>(
      "select origin,body_encrypted,resolution_encrypted,state,created_at from member_support_requests where member_id=$1 order by created_at",
      [request.member_id],
    ),
  ]);
  await audit(
    db,
    "memberId" in actor ? actor.memberId : actor.id,
    null,
    "privacy_access_export",
    requestId,
    {
      memberId: request.member_id,
    },
  );
  return {
    member,
    consents,
    admissions,
    benefits,
    incidents,
    recoveries,
    service,
    messages,
    support: support.map((s) => ({
      origin: s.origin,
      note: s.body_encrypted ? decrypt(s.body_encrypted) : null,
      resolution: s.resolution_encrypted
        ? decrypt(s.resolution_encrypted)
        : null,
      state: s.state,
      createdAt: s.created_at,
    })),
    evidenceNote:
      "Digital redemption is not purchase proof or proof of physical handoff. Private access and pass credentials are excluded.",
  };
}
export async function memberPrivacyRequests(db: DB, memberId: string) {
  return db.query<{
    id: string;
    kind: string;
    state: string;
    created_at: string;
    resolution: string;
  }>(
    "select id,kind,state,created_at,resolution from privacy_requests where member_id=$1 order by created_at desc limit 30",
    [memberId],
  );
}
export async function completePrivacyRequest(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  operator(actor);
  const input = z
    .object({
      requestId: z.string().min(1),
      resolution: z.string().trim().min(10).max(1500),
      homeZip: z
        .string()
        .regex(/^\d{5}$/)
        .optional(),
      workZip: z
        .string()
        .regex(/^(\d{5})?$/)
        .optional(),
      retainedEvidenceReviewed: z.boolean().optional(),
      correctPhone: z.boolean().optional(),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const [request] = await tx.query<PrivacyRequest>(
      "select * from privacy_requests where id=$1 for update",
      [input.requestId],
    );
    if (!request || request.state !== "verified")
      throw new RequestError("Verify an open request before completing it.");
    const [member] = await tx.query<{
      id: string;
      customer_id: string;
      phone: string;
    }>(
      "select m.id,m.customer_id,c.phone from uptick_members m join customers c on c.id=m.customer_id where m.id=$1 for update of m,c",
      [request.member_id],
    );
    if (request.kind === "correction") {
      if (!input.homeZip && !input.correctPhone)
        throw new RequestError(
          "Supply a corrected home ZIP or choose the confirmed phone correction.",
        );
      if (input.correctPhone)
        await (
          await import("./member-phone-correction")
        ).applyPhoneCorrection(tx, actor, request.id, member.id);
      if (input.homeZip) {
        await tx.query(
          "update uptick_members set home_zip=$2,work_zip=$3,market_id=(select m.id from market_cells m join market_zips z on z.market_id=m.id where m.state in ('building','pilot','live') and z.zip in($2,$3) order by case when z.zip=$2 then 0 else 1 end,m.slug limit 1),updated_at=now() where id=$1",
          [member.id, input.homeZip, input.workZip || null],
        );
        await tx.query(
          "insert into member_service_events(id,member_id,kind,reason,actor_id,actor_kind,request_key) values($1,$2,'geography_changed','Verified privacy correction; existing obligations are preserved.',$3,'operator',$4)",
          [id(), member.id, actor.id, `privacy-correction:${request.id}`],
        );
      }
    }
    if (["deletion", "revoke_sessions"].includes(request.kind)) {
      await tx.query(
        "update member_sessions set revoked_at=now() where member_id=$1 and revoked_at is null",
        [member.id],
      );
      await tx.query(
        "update member_recovery_codes set revoked_at=now() where member_id=$1 and revoked_at is null and used_at is null",
        [member.id],
      );
      await tx.query(
        "update member_access set token_hash='revoked:'||id,token_encrypted='erased' where member_id=$1",
        [member.id],
      );
    }
    if (request.kind === "deletion") {
      const policy = await privacyPolicy(tx);
      if (
        !policy ||
        new Date(policy.review_due_at) <= new Date() ||
        !input.retainedEvidenceReviewed
      )
        throw new RequestError(
          "Approve the retention policy and review retained records for identifiers before erasure.",
        );
      const phoneFingerprint = privacyPhoneFingerprint(member.phone);
      if ((await memberRetentionNotes(tx, actor, member.id)).length)
        throw new RequestError(
          "Remove personal member notes in the privacy review before completing erasure.",
        );
      const [already] = await tx.query(
        "select member_id from member_erasure_records where member_id=$1",
        [member.id],
      );
      if (already)
        throw new RequestError(
          "This account's identifiers were already erased.",
        );
      const [suppressed] = await tx.query<{ blocked: boolean }>(
        "select exists(select 1 from member_global_suppressions where phone=$1 and suppressed) or exists(select 1 from member_suppressions where phone=$1 and suppressed) blocked",
        [member.phone],
      );
      if (suppressed.blocked)
        await tx.query(
          "insert into privacy_phone_suppressions(phone_fingerprint,suppressed) values($1,true) on conflict(phone_fingerprint) do update set suppressed=true,updated_at=now()",
          [phoneFingerprint],
        );
      const retained = Object.fromEntries(
        categories
          .filter((c) => c !== "identifiers" && c !== "support")
          .map((category) => [
            category,
            {
              days: policy.retention_days[category],
              reviewAt: new Date(
                Date.now() + policy.retention_days[category] * 86400000,
              ).toISOString(),
            },
          ]),
      );
      await tx.query(
        "insert into member_erasure_records(member_id,customer_id,request_id,policy_id,actor_id,retained_categories,review_due_at) values($1,$2,$3,$4,$5,$6,$7)",
        [
          member.id,
          member.customer_id,
          request.id,
          policy.id,
          actor.id,
          retained,
          new Date(
            Date.now() +
              Math.min(
                policy.retention_days.consent,
                policy.retention_days.operational,
                policy.retention_days.financial,
              ) *
                86400000,
          ).toISOString(),
        ],
      );
      await tx.query(
        "insert into member_service_events(id,member_id,kind,reason,actor_id,actor_kind,request_key) values($1,$2,'deletion_pending','Personal details removed under a verified privacy request.',$3,'operator',$4)",
        [id(), member.id, actor.id, `privacy-erasure:${request.id}`],
      );
      await tx.query("update customers set phone='erased:'||id where id=$1", [
        member.customer_id,
      ]);
      await tx.query(
        "update uptick_members set home_zip='00000',work_zip=null,market_id=null,state='paused',updated_at=now() where id=$1",
        [member.id],
      );
      await tx.query(
        "update member_access set home_zip='00000',work_zip=null where member_id=$1",
        [member.id],
      );
      await tx.query(
        "update claims set token_hash='erased:'||id,token_encrypted='erased' where customer_id=$1",
        [member.customer_id],
      );
      await tx.query(
        "update consent_events set phone='erased' where customer_id=$1",
        [member.customer_id],
      );
      await tx.query(
        "update member_support_requests set phone_encrypted=null,body_encrypted=null,resolution_encrypted=null,context='{}' where member_id=$1",
        [member.id],
      );
      await tx.query(
        "update member_messages set rendered_body_encrypted=null,recipient_encrypted=null,recipient_hint=null,state=case when state in ('queued','submitting') then 'suppressed' else state end,suppression_reason=case when state in ('queued','submitting') then 'Verified privacy erasure' else suppression_reason end where member_id=$1",
        [member.id],
      );
      await tx.query(
        "update member_phone_changes set new_phone_encrypted='erased',token_hash='erased:'||id,token_encrypted='erased' where member_id=$1",
        [member.id],
      );
      await tx.query("delete from member_suppressions where phone=$1", [
        member.phone,
      ]);
      await tx.query("delete from member_global_suppressions where phone=$1", [
        member.phone,
      ]);
      await tx.query("delete from suppressions where phone=$1", [member.phone]);
      await tx.query(
        "update privacy_requests set note_encrypted=$2,verification_encrypted=null,resolution='Personal request details erased after verified completion.' where member_id=$1",
        [
          member.id,
          encrypt("Personal request details erased after verified completion."),
        ],
      );
    }
    await tx.query(
      "update privacy_requests set state='completed',resolved_by=$2,resolved_at=now(),resolution=$3 where id=$1",
      [
        request.id,
        actor.id,
        request.kind === "deletion"
          ? "Verified identifier erasure completed; retained evidence follows the approved policy."
          : input.resolution,
      ],
    );
    await tx.query(
      "insert into privacy_request_events(id,request_id,action,actor_id,detail) values($1,$2,'completed',$3,$4)",
      [id(), request.id, actor.id, { kind: request.kind }],
    );
    await audit(tx, actor.id, null, "privacy_request_completed", request.id, {
      kind: request.kind,
      memberId: member.id,
    });
    return request.id;
  });
}
export async function privacyOperations(db: DB, actor: Actor) {
  operator(actor);
  const [policy, requests, retentionReviews] = await Promise.all([
    privacyPolicy(db),
    db.query<PrivacyRequest>(
      "select * from privacy_requests order by created_at desc limit 200",
    ),
    db.query(
      "select q.*,e.request_id from privacy_retention_queue q join member_erasure_records e on e.member_id=q.member_id order by q.review_due_at,q.member_id,q.category",
    ),
  ]);
  return {
    policy,
    requests: requests.map((r) => ({
      ...r,
      note: decrypt(r.note_encrypted),
      note_encrypted: undefined,
      request_fingerprint: undefined,
    })),
    retentionReviews,
  };
}
