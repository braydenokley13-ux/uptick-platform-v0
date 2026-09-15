import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import {
  completePrivacyRequest,
  createPrivacyRequest,
  privacyOperations,
  savePrivacyPolicy,
  verifyPrivacyRequest,
} from "../src/lib/privacy-admin";
import {
  completeRetentionReview,
  memberRetentionNotes,
  redactMemberRetentionNotes,
} from "../src/lib/privacy-retention";
import { seedSyntheticPilot } from "../scripts/verify-postgres-pilot";

process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
process.env.SESSION_SECRET = "s".repeat(64);
process.env.PRIVACY_SUPPRESSION_KEY = "r".repeat(64);

const merchant: Actor = {
  id: "privacy-retention-merchant",
  role: "merchant",
  organizationId: "privacy-retention-merchant-org",
};
const removedNote =
  "Personal details removed under a verified privacy request.";

async function approvePolicy(db: DB, actor: Actor, retentionDays = 0) {
  return savePrivacyPolicy(db, actor, {
    scope:
      "Verified member identifier erasure and category-specific retained evidence review.",
    approvalEvidence:
      "The accountable privacy operator approved this isolated test schedule.",
    reviewDueAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    retentionDays: {
      identifiers: 0,
      support: 0,
      consent: retentionDays,
      operational: retentionDays,
      financial: retentionDays,
    },
  });
}

async function deletionRequest(
  db: DB,
  actor: Actor,
  memberId: string,
  key: string,
) {
  const requestId = await createPrivacyRequest(
    db,
    { memberId },
    {
      memberId,
      kind: "deletion",
      note: "Remove my personal identifiers after verifying this request.",
      requestKey: key,
    },
  );
  await verifyPrivacyRequest(db, actor, {
    requestId,
    evidence:
      "The privacy operator verified the member through the approved account route.",
  });
  return requestId;
}

test("privacy note and retention actions reject unauthorized roles and ineligible requests", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "privacy-retention-role");
    const memberId = fixture.members[0].id;
    const queuedDeletion = await createPrivacyRequest(
      db,
      { memberId },
      {
        memberId,
        kind: "deletion",
        note: "Remove identifiers only after the operator verifies my request.",
        requestKey: "privacy-retention-queued-deletion",
      },
    );

    await assert.rejects(
      memberRetentionNotes(db, merchant, memberId),
      /operator access/i,
    );
    await assert.rejects(
      redactMemberRetentionNotes(db, merchant, queuedDeletion),
      /operator access/i,
    );
    await assert.rejects(
      completeRetentionReview(db, merchant, {
        memberId,
        category: "consent",
        outcome: "deidentified",
        evidence:
          "A merchant must not be able to close the platform retention review.",
        identifiersReviewed: true,
      }),
      /operator access/i,
    );
    await assert.rejects(
      redactMemberRetentionNotes(db, fixture.actor, queuedDeletion),
      /verify the member's deletion request/i,
    );

    const accessRequest = await createPrivacyRequest(
      db,
      { memberId },
      {
        memberId,
        kind: "access",
        note: "Provide the verified member data export for this account.",
        requestKey: "privacy-retention-access-request",
      },
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId: accessRequest,
      evidence:
        "The operator verified this data-access request through the approved route.",
    });
    await assert.rejects(
      redactMemberRetentionNotes(db, fixture.actor, accessRequest),
      /verify the member's deletion request/i,
    );
    await assert.rejects(
      completeRetentionReview(db, fixture.actor, {
        memberId,
        category: "operational",
        outcome: "deidentified",
        evidence:
          "This review cannot finish before the verified identifier erasure exists.",
        identifiersReviewed: true,
      }),
      /complete verified identifier erasure/i,
    );
  } finally {
    await db.close?.();
  }
});

test("note redaction removes nested personal audit fields without changing operational truth", async () => {
  const db = await memoryDb();
  try {
    const prefix = "privacy-retention-notes";
    const fixture = await seedSyntheticPilot(db, 1, prefix);
    const member = fixture.members[0];
    const claimId = `${prefix}-claim`;
    const evidenceId = `${prefix}-evidence`;
    const serviceEventId = `${prefix}-service-event`;
    const auditId = `${prefix}-audit`;
    await db.query(
      `insert into claims(
        id,customer_id,organization_id,offer_id,offer_version,token_hash,
        token_encrypted,snapshot,state,redeemed_at
       ) values($1,$2,$3,$4,1,$5,$6,$7,'redeemed',now())`,
      [
        claimId,
        member.customerId,
        fixture.actor.organizationId,
        `${prefix}-offer`,
        `${prefix}-claim-token`,
        `${prefix}-encrypted-token`,
        {
          quantity: 1,
          price: 0,
          benefit: "Synthetic operational evidence",
        },
      ],
    );
    await db.query(
      `insert into redemption_evidence(
        id,claim_id,organization_id,point_id,credential_id,method,
        verification_level,verification_policy,staff_gated,actor,reason
       ) values($1,$2,$3,$4,$5,'qr',1,'staff_tap',true,$6,$7)`,
      [
        evidenceId,
        claimId,
        fixture.actor.organizationId,
        `${prefix}-point`,
        `${prefix}-qr`,
        fixture.actor.id,
        "Member Jane Doe called from +12125550123 about the redemption.",
      ],
    );
    await db.query(
      `insert into member_service_events(
        id,member_id,kind,reason,actor_id,actor_kind,request_key
       ) values($1,$2,'geography_changed',$3,$4,'operator',$5)`,
      [
        serviceEventId,
        member.id,
        "Jane Doe moved from 1 Private Lane and asked us to call +12125550123.",
        fixture.actor.id,
        `${prefix}-service-request`,
      ],
    );
    await db.query(
      `insert into audit_events(id,actor,action,entity_id,detail)
       values($1,$2,'privacy.synthetic_nested_personal_detail',$3,$4)`,
      [
        auditId,
        fixture.actor.id,
        member.id,
        {
          memberId: member.id,
          state: "redeemed",
          quantity: 1,
          amount: 0,
          nested: {
            email: "jane@example.test",
            phone: "+12125550123",
            operationalCode: "kept-code",
            items: [
              {
                name: "Jane Doe",
                address: "1 Private Lane",
                units: 1,
              },
            ],
          },
        },
      ],
    );

    const requestId = await deletionRequest(
      db,
      fixture.actor,
      member.id,
      "privacy-retention-notes-deletion",
    );
    const notes = await memberRetentionNotes(db, fixture.actor, member.id);
    assert.ok(
      notes.some(
        (note) =>
          note.table_name === "redemption_evidence" &&
          note.row_id === evidenceId &&
          note.field === "reason",
      ),
    );
    assert.ok(
      notes.some(
        (note) =>
          note.table_name === "member_service_events" &&
          note.row_id === serviceEventId,
      ),
    );
    assert.ok(
      notes.some(
        (note) => note.table_name === "audit_events" && note.row_id === auditId,
      ),
    );

    const [claimBefore] = await db.query<Record<string, unknown>>(
      "select * from claims where id=$1",
      [claimId],
    );
    const [supplyBefore] = await db.query<Record<string, unknown>>(
      "select * from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    const [evidenceBefore] = await db.query<Record<string, unknown>>(
      "select * from redemption_evidence where id=$1",
      [evidenceId],
    );
    assert.equal(
      await redactMemberRetentionNotes(db, fixture.actor, requestId),
      notes.length,
    );

    const [claimAfter] = await db.query<Record<string, unknown>>(
      "select * from claims where id=$1",
      [claimId],
    );
    const [supplyAfter] = await db.query<Record<string, unknown>>(
      "select * from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    const [evidenceAfter] = await db.query<Record<string, unknown>>(
      "select * from redemption_evidence where id=$1",
      [evidenceId],
    );
    assert.deepEqual(claimAfter, claimBefore);
    assert.deepEqual(supplyAfter, supplyBefore);
    assert.deepEqual(
      { ...evidenceAfter, reason: evidenceBefore.reason },
      evidenceBefore,
    );
    assert.equal(evidenceAfter.reason, removedNote);
    assert.equal(
      (
        await db.query<{ reason: string }>(
          "select reason from member_service_events where id=$1",
          [serviceEventId],
        )
      )[0].reason,
      removedNote,
    );

    const [auditAfter] = await db.query<{
      detail: Record<string, unknown> & {
        nested: {
          email: string;
          phone: string;
          operationalCode: string;
          items: { name: string; address: string; units: number }[];
        };
      };
    }>("select detail from audit_events where id=$1", [auditId]);
    assert.deepEqual(
      {
        memberId: auditAfter.detail.memberId,
        state: auditAfter.detail.state,
        quantity: auditAfter.detail.quantity,
        amount: auditAfter.detail.amount,
        operationalCode: auditAfter.detail.nested.operationalCode,
        units: auditAfter.detail.nested.items[0].units,
      },
      {
        memberId: member.id,
        state: "redeemed",
        quantity: 1,
        amount: 0,
        operationalCode: "kept-code",
        units: 1,
      },
    );
    assert.equal(auditAfter.detail.nested.email, removedNote);
    assert.equal(auditAfter.detail.nested.phone, removedNote);
    assert.equal(auditAfter.detail.nested.items[0].name, removedNote);
    assert.equal(auditAfter.detail.nested.items[0].address, removedNote);
    assert.equal(
      JSON.stringify(auditAfter.detail).includes("jane@example.test"),
      false,
    );

    const [evidenceRedaction] = await db.query<{ id: string }>(
      "select id from privacy_note_redactions where table_name='redemption_evidence' and row_id=$1",
      [evidenceId],
    );
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query(
          "select set_config('uptick.privacy_redaction_id',$1,true)",
          [evidenceRedaction.id],
        );
        await tx.query(
          "update redemption_evidence set actor='rewritten-actor' where id=$1",
          [evidenceId],
        );
      }),
      /historical records are immutable/i,
    );
    await assert.rejects(
      db.query(
        "update claims set state='active',redeemed_at=null where id=$1",
        [claimId],
      ),
      /completed pass cannot be reset/i,
    );
    await assert.rejects(
      db.query("update network_drop_supplies set quantity=2 where id=$1", [
        fixture.supplyId,
      ]),
      /commitment is immutable/i,
    );
  } finally {
    await db.close?.();
  }
});

test("category holds advance their due date and completed reviews leave no overdue queue", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "privacy-retention-review");
    const memberId = fixture.members[0].id;
    await approvePolicy(db, fixture.actor, 0);
    const requestId = await deletionRequest(
      db,
      fixture.actor,
      memberId,
      "privacy-retention-review-deletion",
    );
    await redactMemberRetentionNotes(db, fixture.actor, requestId);
    await completePrivacyRequest(db, fixture.actor, {
      requestId,
      resolution:
        "Verified identifiers were erased after reviewing retained evidence.",
      retainedEvidenceReviewed: true,
    });

    const initial = await db.query<{
      category: string;
      review_due_at: string;
    }>(
      "select category,review_due_at from privacy_retention_queue where member_id=$1 order by category",
      [memberId],
    );
    assert.deepEqual(initial.map((item) => item.category).sort(), [
      "consent",
      "financial",
      "operational",
    ]);
    assert.ok(
      initial.every(
        (item) => new Date(item.review_due_at).getTime() <= Date.now(),
      ),
    );
    await assert.rejects(
      completeRetentionReview(db, fixture.actor, {
        memberId,
        category: "consent",
        outcome: "hold",
        evidence: "The consent evidence still has an approved retention basis.",
        identifiersReviewed: true,
      }),
      /hold needs a future review date/i,
    );

    const nextReviewAt = new Date(Date.now() + 14 * 86400000).toISOString();
    await completeRetentionReview(db, fixture.actor, {
      memberId,
      category: "consent",
      outcome: "hold",
      evidence:
        "The privacy operator documented the active consent-evidence retention basis.",
      nextReviewAt,
      identifiersReviewed: true,
    });
    const consentQueue = (
      await db.query<{
        category: string;
        outcome: string;
        review_due_at: string;
      }>(
        "select category,outcome,review_due_at from privacy_retention_queue where member_id=$1 and category='consent'",
        [memberId],
      )
    )[0];
    assert.equal(consentQueue.outcome, "hold");
    assert.equal(
      new Date(consentQueue.review_due_at).getTime(),
      new Date(nextReviewAt).getTime(),
    );

    for (const category of ["consent", "operational", "financial"] as const)
      await completeRetentionReview(db, fixture.actor, {
        memberId,
        category,
        outcome: "deidentified",
        evidence: `The privacy operator verified that ${category} evidence no longer contains member identifiers.`,
        identifiersReviewed: true,
      });

    assert.equal(
      (
        await db.query(
          "select category from privacy_retention_queue where member_id=$1",
          [memberId],
        )
      ).length,
      0,
    );
    assert.equal(
      (await privacyOperations(db, fixture.actor)).retentionReviews.length,
      0,
    );
    const reviews = await db.query<{
      category: string;
      outcome: string;
      evidence_encrypted: string;
    }>(
      "select category,outcome,evidence_encrypted from privacy_retention_reviews where member_id=$1 order by sequence",
      [memberId],
    );
    assert.equal(reviews.length, 4);
    assert.deepEqual(
      reviews.map(({ category, outcome }) => ({ category, outcome })),
      [
        { category: "consent", outcome: "hold" },
        { category: "consent", outcome: "deidentified" },
        { category: "operational", outcome: "deidentified" },
        { category: "financial", outcome: "deidentified" },
      ],
    );
    assert.ok(
      reviews.every(
        (review) =>
          !review.evidence_encrypted.includes("privacy operator verified"),
      ),
    );
  } finally {
    await db.close?.();
  }
});
