import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import {
  completePrivacyRequest,
  createPrivacyRequest,
  exportMemberData,
  privacyOperations,
  privacyPhoneFingerprint,
  savePrivacyPolicy,
  verifyPrivacyRequest,
} from "../src/lib/privacy-admin";
import { redactMemberRetentionNotes } from "../src/lib/privacy-retention";
import { claimMemberDrop } from "../src/lib/network";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import { decrypt, encrypt, hash, token } from "../src/lib/security";
import { redeemAtPoint } from "../src/lib/tap";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "../scripts/verify-postgres-pilot";

process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
process.env.PRIVACY_SUPPRESSION_KEY =
  "privacy-test-suppression-key-with-at-least-32-characters";

const merchant: Actor = {
  id: "privacy-merchant-user",
  role: "merchant",
  organizationId: "privacy-merchant",
};

function requestInput(
  fixture: SyntheticPilotFixture,
  kind: "access" | "correction" | "deletion" | "revoke_sessions",
  requestKey: string,
  note = "Please process this verified privacy request for my account.",
) {
  return {
    memberId: fixture.members[0].id,
    kind,
    note,
    requestKey,
  };
}

async function approvePolicy(db: DB, actor: Actor) {
  return savePrivacyPolicy(db, actor, {
    scope:
      "Member identifiers, consent evidence, operational promises, support, and financial records.",
    approvalEvidence:
      "Approved synthetic retention schedule reviewed by the accountable privacy operator.",
    reviewDueAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    retentionDays: {
      identifiers: 0,
      support: 0,
      consent: 365,
      operational: 730,
      financial: 2555,
    },
  });
}

async function addAccessAndCredentials(
  db: DB,
  fixture: SyntheticPilotFixture,
  prefix: string,
) {
  const accessId = `${prefix}-access`;
  const accessToken = token();
  const sessionHash = `${prefix}-session-secret-hash`;
  const recoveryHash = `${prefix}-recovery-secret-hash`;
  await db.query(
    `insert into member_access(
      id,member_id,token_hash,token_encrypted,purpose,expires_at,confirmed_at,
      disclosure,home_zip,work_zip,age_attested
     ) values($1,$2,$3,$4,'access',now()+interval '30 days',now(),
      'Synthetic private access disclosure','10001','10002',true)`,
    [accessId, fixture.members[0].id, hash(accessToken), encrypt(accessToken)],
  );
  await db.query(
    `insert into member_sessions(
      id,member_id,source_access_id,token_hash,expires_at
     ) values($1,$2,$3,$4,now()+interval '30 days')`,
    [`${prefix}-session`, fixture.members[0].id, accessId, sessionHash],
  );
  await db.query(
    `insert into member_recovery_codes(id,member_id,code_hash,expires_at)
     values($1,$2,$3,now()+interval '30 days')`,
    [`${prefix}-recovery-code`, fixture.members[0].id, recoveryHash],
  );
  return { accessId, accessToken, sessionHash, recoveryHash };
}

async function richPrivacyFixture(db: DB) {
  const fixture = await seedSyntheticPilot(db, 1, "privacy-erasure");
  const originalPhone = "+12125560000";
  await db.query("update customers set phone=$2 where id=$1", [
    fixture.members[0].customerId,
    originalPhone,
  ]);
  const credentials = await addAccessAndCredentials(db, fixture, "privacy");
  const recommendation = await import("../src/lib/pilot-assignment").then(
    ({ recommendPilotAssignments }) =>
      recommendPilotAssignments(db, fixture.runId, fixture.weekKey),
  );
  const published = await releaseWeeklyBenefits(db, fixture.actor, {
    runId: fixture.runId,
    marketId: fixture.marketId,
    weekKey: fixture.weekKey,
    dataKind: "synthetic",
    requestKey: "privacy-erasure-week-release",
    recommendationFingerprint: recommendation.fingerprint,
    assignments: recommendation.assignments.map(({ memberId, supplyId }) => ({
      memberId,
      supplyId,
    })),
  });
  const claim = await claimMemberDrop(
    db,
    credentials.accessToken,
    fixture.supplyId,
  );
  await redeemAtPoint(db, decrypt(claim.token_encrypted), {
    pointToken: fixture.pointToken,
  });
  await db.query(
    `insert into member_consents(
      id,member_id,accepted,disclosure_version,disclosure,source_ui,
      consent_purpose,consent_action
     ) values('privacy-stop-consent',$1,false,'privacy-v1',
      'Promotional membership SMS preference','sms',
      'promotional_membership_sms','stop')`,
    [fixture.members[0].id],
  );
  await db.query(
    `insert into consent_events(
      id,customer_id,organization_id,purpose,accepted,disclosure_version,
      disclosure,source_ui,phone
     ) values('privacy-legacy-consent',$1,null,'network',false,'legacy-v1',
      'Legacy network consent record','legacy',$2)`,
    [fixture.members[0].customerId, originalPhone],
  );
  await db.query(
    `insert into member_support_requests(
      id,member_id,origin,phone_encrypted,body_encrypted,context,state,
      resolution_encrypted
     ) values('privacy-support',$1,'member_web',$2,$3,$4,'resolved',$5)`,
    [
      fixture.members[0].id,
      encrypt(originalPhone),
      encrypt("My private support question includes personal details."),
      { phone: originalPhone, privateDetail: "personal support context" },
      encrypt("Resolved with private account details."),
    ],
  );
  await db.query(
    `insert into member_messages(
      id,member_id,access_id,purpose,timezone,scheduled_at,expires_at,
      environment,state,rendered_body_encrypted
     ) values('privacy-message',$1,$2,'access','America/New_York',now(),
      now()+interval '1 day','development','queued',$3)`,
    [
      fixture.members[0].id,
      credentials.accessId,
      encrypt(`Private access message for ${originalPhone}`),
    ],
  );
  await db.query(
    `insert into member_senders(id,service_sid,phone,approved,active)
     values('privacy-member-sender','MG11111111111111111111111111111111',
      '+12125550999',true,true)`,
  );
  await db.query(
    "insert into member_suppressions(phone,sender_id,suppressed) values($1,'privacy-member-sender',true)",
    [originalPhone],
  );
  await db.query(
    "insert into member_global_suppressions(phone,suppressed,source_sender_id) values($1,true,'privacy-member-sender')",
    [originalPhone],
  );
  await db.query(
    `insert into senders(id,organization_id,service_sid,phone,approved)
     values('privacy-legacy-sender',$1,'MG22222222222222222222222222222222',
      '+12125550888',true)`,
    [fixture.actor.organizationId],
  );
  await db.query(
    "insert into suppressions(phone,sender_id,suppressed) values($1,'privacy-legacy-sender',true)",
    [originalPhone],
  );
  const [grantBefore] = await db.query<{
    id: string;
    member_snapshot: Record<string, unknown>;
    state: string;
    redeemed_at: string;
  }>(
    "select id,member_snapshot,state,redeemed_at from fulfillment_grants where id=$1",
    [published.grants[0].id],
  );
  const [claimBefore] = await db.query<{
    id: string;
    snapshot: Record<string, unknown>;
    state: string;
    redeemed_at: string;
  }>("select id,snapshot,state,redeemed_at from claims where id=$1", [
    claim.id,
  ]);
  const [evidenceBefore] = await db.query<Record<string, unknown>>(
    "select * from redemption_evidence where claim_id=$1",
    [claim.id],
  );
  return {
    fixture,
    credentials,
    originalPhone,
    claim,
    grantBefore,
    claimBefore,
    evidenceBefore,
  };
}

test("privacy administration enforces operator roles and encrypts request details", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "privacy-role");
    await assert.rejects(
      savePrivacyPolicy(db, merchant, {
        scope: "Attempted merchant privacy policy change.",
        approvalEvidence:
          "A merchant cannot approve the platform retention policy.",
        reviewDueAt: new Date(Date.now() + 86400000).toISOString(),
        retentionDays: {
          identifiers: 0,
          support: 0,
          consent: 1,
          operational: 1,
          financial: 1,
        },
      }),
      /operator/i,
    );
    await assert.rejects(
      createPrivacyRequest(
        db,
        merchant,
        requestInput(fixture, "access", "privacy-role-merchant-request"),
      ),
      /not authorized/i,
    );

    const privateNote =
      "My private phone is +12125551234 and my corrected ZIP is 10002.";
    const requestId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      requestInput(fixture, "access", "privacy-encrypted-request", privateNote),
    );
    const [stored] = await db.query<{ note_encrypted: string }>(
      "select note_encrypted from privacy_requests where id=$1",
      [requestId],
    );
    assert.notEqual(stored.note_encrypted, privateNote);
    assert.equal(stored.note_encrypted.includes("+12125551234"), false);
    assert.equal(stored.note_encrypted.includes("10002"), false);
    const operations = await privacyOperations(db, fixture.actor);
    assert.equal(operations.requests[0].note, privateNote);
    assert.equal(operations.requests[0].note_encrypted, undefined);
    await assert.rejects(
      verifyPrivacyRequest(db, merchant, {
        requestId,
        evidence: "Merchant attempted identity verification.",
      }),
      /operator/i,
    );
    await assert.rejects(
      exportMemberData(db, merchant, requestId),
      /operator/i,
    );
    await assert.rejects(privacyOperations(db, merchant), /operator/i);
    await assert.rejects(
      completePrivacyRequest(db, merchant, {
        requestId,
        resolution: "Merchant attempted to complete a privacy request.",
      }),
      /operator/i,
    );
  } finally {
    await db.close?.();
  }
});

test("verification and an approved retention policy are required before erasure", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "privacy-gates");
    const requestId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      requestInput(fixture, "deletion", "privacy-gates-deletion"),
    );
    await assert.rejects(
      completePrivacyRequest(db, fixture.actor, {
        requestId,
        resolution: "Attempt completion before identity verification.",
        retainedEvidenceReviewed: true,
      }),
      /verify/i,
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId,
      evidence:
        "Operator verified the member through the approved account route.",
    });
    await assert.rejects(
      completePrivacyRequest(db, fixture.actor, {
        requestId,
        resolution: "Attempt completion before policy approval.",
        retainedEvidenceReviewed: true,
      }),
      /retention policy/i,
    );
    const [request] = await db.query<{ state: string }>(
      "select state from privacy_requests where id=$1",
      [requestId],
    );
    assert.equal(request.state, "verified");
    assert.equal(
      (await db.query("select member_id from member_erasure_records")).length,
      0,
    );
  } finally {
    await db.close?.();
  }
});

test("verified export excludes credentials while correction and revocation use their narrow scopes", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "privacy-actions");
    const credentials = await addAccessAndCredentials(db, fixture, "actions");
    const accessId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      requestInput(fixture, "access", "privacy-actions-access"),
    );
    await assert.rejects(
      exportMemberData(db, fixture.actor, accessId),
      /verify/i,
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId: accessId,
      evidence:
        "Operator verified the access request through the account route.",
    });
    const exported = await exportMemberData(db, fixture.actor, accessId);
    const serialized = JSON.stringify(exported);
    for (const credential of [
      credentials.accessToken,
      credentials.sessionHash,
      credentials.recoveryHash,
    ])
      assert.equal(
        serialized.includes(credential),
        false,
        "private access, session, and recovery credentials must stay out of exports",
      );
    for (const credentialField of [
      "token_hash",
      "token_encrypted",
      "code_hash",
      "verification_encrypted",
    ])
      assert.equal(serialized.includes(credentialField), false);
    assert.equal("sessions" in exported, false);
    assert.equal("access" in exported, false);

    const correctionId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      requestInput(fixture, "correction", "privacy-actions-correction"),
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId: correctionId,
      evidence: "Operator verified the correction through the account route.",
    });
    await completePrivacyRequest(db, fixture.actor, {
      requestId: correctionId,
      resolution: "Corrected the member geography after identity verification.",
      homeZip: "10003",
      workZip: "10004",
    });
    const [corrected] = await db.query<{
      home_zip: string;
      work_zip: string;
    }>("select home_zip,work_zip from uptick_members where id=$1", [
      fixture.members[0].id,
    ]);
    assert.deepEqual(corrected, { home_zip: "10003", work_zip: "10004" });

    const revokeId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      requestInput(fixture, "revoke_sessions", "privacy-actions-revoke"),
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId: revokeId,
      evidence: "Operator verified the credential revocation request.",
    });
    await completePrivacyRequest(db, fixture.actor, {
      requestId: revokeId,
      resolution: "Revoked existing private access credentials as requested.",
    });
    const [session] = await db.query<{ revoked_at: string | null }>(
      "select revoked_at from member_sessions where member_id=$1",
      [fixture.members[0].id],
    );
    const [recovery] = await db.query<{ revoked_at: string | null }>(
      "select revoked_at from member_recovery_codes where member_id=$1",
      [fixture.members[0].id],
    );
    const [access] = await db.query<{
      token_hash: string;
      token_encrypted: string;
    }>("select token_hash,token_encrypted from member_access where id=$1", [
      credentials.accessId,
    ]);
    assert.ok(session.revoked_at);
    assert.ok(recovery.revoked_at);
    assert.deepEqual(access, {
      token_hash: `revoked:${credentials.accessId}`,
      token_encrypted: "erased",
    });
    const [member] = await db.query<{ home_zip: string }>(
      "select home_zip from uptick_members where id=$1",
      [fixture.members[0].id],
    );
    assert.equal(member.home_zip, "10003");
  } finally {
    await db.close?.();
  }
});

test("verified erasure clears known PII while preserving consent and operational evidence", async () => {
  const db = await memoryDb();
  try {
    const setup = await richPrivacyFixture(db);
    const { fixture, credentials, originalPhone } = setup;
    const policyId = await approvePolicy(db, fixture.actor);
    const requestId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      requestInput(
        fixture,
        "deletion",
        "privacy-complete-erasure",
        `Erase identifiers connected to ${originalPhone} after verification.`,
      ),
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId,
      evidence: `Verified control of the account formerly using ${originalPhone}.`,
    });
    await db.query(
      `insert into member_service_events(
        id,member_id,kind,reason,actor_id,actor_kind,request_key
       ) values('privacy-personal-note',$1,'geography_changed',$2,$3,
        'operator','privacy-personal-note')`,
      [
        fixture.members[0].id,
        `Member asked support to use ${originalPhone} while reviewing the erasure.`,
        fixture.actor.id,
      ],
    );
    await assert.rejects(
      completePrivacyRequest(db, fixture.actor, {
        requestId,
        resolution:
          "Attempted identifier erasure before the explicit note review.",
        retainedEvidenceReviewed: true,
      }),
      /remove personal member notes/i,
    );
    assert.ok(
      (await redactMemberRetentionNotes(db, fixture.actor, requestId)) >= 1,
    );
    const [redactedNote] = await db.query<{ reason: string }>(
      "select reason from member_service_events where id='privacy-personal-note'",
    );
    assert.equal(
      redactedNote.reason,
      "Personal details removed under a verified privacy request.",
    );
    await completePrivacyRequest(db, fixture.actor, {
      requestId,
      resolution:
        "Completed identifier erasure and retained required evidence.",
      retainedEvidenceReviewed: true,
    });

    const [customer] = await db.query<{ phone: string }>(
      "select phone from customers where id=$1",
      [fixture.members[0].customerId],
    );
    assert.equal(customer.phone, `erased:${fixture.members[0].customerId}`);
    const [member] = await db.query<{
      home_zip: string;
      work_zip: string | null;
      market_id: string | null;
      state: string;
    }>(
      "select home_zip,work_zip,market_id,state from uptick_members where id=$1",
      [fixture.members[0].id],
    );
    assert.deepEqual(member, {
      home_zip: "00000",
      work_zip: null,
      market_id: null,
      state: "paused",
    });
    const [access] = await db.query<{
      token_hash: string;
      token_encrypted: string;
      home_zip: string;
      work_zip: string | null;
    }>(
      "select token_hash,token_encrypted,home_zip,work_zip from member_access",
      [],
    );
    assert.deepEqual(access, {
      token_hash: `revoked:${credentials.accessId}`,
      token_encrypted: "erased",
      home_zip: "00000",
      work_zip: null,
    });
    const [claim] = await db.query<{
      token_hash: string;
      token_encrypted: string;
      snapshot: Record<string, unknown>;
      state: string;
      redeemed_at: string;
    }>(
      "select token_hash,token_encrypted,snapshot,state,redeemed_at from claims",
    );
    assert.equal(claim.token_hash, `erased:${setup.claim.id}`);
    assert.equal(claim.token_encrypted, "erased");
    assert.deepEqual(claim.snapshot, setup.claimBefore.snapshot);
    assert.equal(claim.state, setup.claimBefore.state);
    assert.equal(
      new Date(claim.redeemed_at).getTime(),
      new Date(setup.claimBefore.redeemed_at).getTime(),
    );
    const [support] = await db.query<{
      phone_encrypted: string | null;
      body_encrypted: string | null;
      resolution_encrypted: string | null;
      context: Record<string, unknown>;
    }>(
      "select phone_encrypted,body_encrypted,resolution_encrypted,context from member_support_requests",
    );
    assert.deepEqual(support, {
      phone_encrypted: null,
      body_encrypted: null,
      resolution_encrypted: null,
      context: {},
    });
    const [message] = await db.query<{
      rendered_body_encrypted: string | null;
      state: string;
      suppression_reason: string;
    }>(
      "select rendered_body_encrypted,state,suppression_reason from member_messages",
    );
    assert.deepEqual(message, {
      rendered_body_encrypted: null,
      state: "suppressed",
      suppression_reason: "Verified privacy erasure",
    });
    const [legacyConsent] = await db.query<{ phone: string }>(
      "select phone from consent_events where id='privacy-legacy-consent'",
    );
    assert.equal(legacyConsent.phone, "erased");

    const [grant] = await db.query<{
      member_snapshot: Record<string, unknown>;
      state: string;
      redeemed_at: string;
    }>("select member_snapshot,state,redeemed_at from fulfillment_grants");
    assert.deepEqual(grant.member_snapshot, setup.grantBefore.member_snapshot);
    assert.equal(grant.state, setup.grantBefore.state);
    assert.equal(
      new Date(grant.redeemed_at).getTime(),
      new Date(setup.grantBefore.redeemed_at).getTime(),
    );
    const [evidence] = await db.query<Record<string, unknown>>(
      "select * from redemption_evidence where claim_id=$1",
      [setup.claim.id],
    );
    assert.deepEqual(evidence, setup.evidenceBefore);
    assert.equal(
      (
        await db.query(
          "select member_id from pilot_admissions where run_id=$1 and member_id=$2",
          [fixture.runId, fixture.members[0].id],
        )
      ).length,
      1,
      "the fixed cohort remains as operational evidence",
    );
    assert.equal(
      (
        await db.query(
          "select id from member_consents where member_id=$1 and consent_action='stop'",
          [fixture.members[0].id],
        )
      ).length,
      1,
      "append-only STOP consent evidence remains",
    );
    const [erasure] = await db.query<{
      policy_id: string;
      retained_categories: Record<string, { days: number; reviewAt: string }>;
    }>("select policy_id,retained_categories from member_erasure_records");
    assert.equal(erasure.policy_id, policyId);
    assert.deepEqual(Object.keys(erasure.retained_categories).sort(), [
      "consent",
      "financial",
      "operational",
    ]);
    assert.equal(erasure.retained_categories.consent.days, 365);
    assert.equal(erasure.retained_categories.operational.days, 730);
    assert.ok(
      new Date(erasure.retained_categories.consent.reviewAt).getTime() >
        Date.now(),
    );
    assert.ok(
      new Date(erasure.retained_categories.operational.reviewAt).getTime() >
        Date.now(),
    );
    const [service] = await db.query<{ kind: string }>(
      "select kind from member_service_status where member_id=$1",
      [fixture.members[0].id],
    );
    assert.equal(service.kind, "deletion_pending");

    const fingerprint = privacyPhoneFingerprint(originalPhone);
    const [stop] = await db.query<{
      phone_fingerprint: string;
      suppressed: boolean;
    }>("select phone_fingerprint,suppressed from privacy_phone_suppressions");
    assert.deepEqual(stop, {
      phone_fingerprint: fingerprint,
      suppressed: true,
    });
    for (const table of [
      "member_suppressions",
      "member_global_suppressions",
      "suppressions",
    ])
      assert.equal(
        (
          await db.query(`select phone from ${table} where phone=$1`, [
            originalPhone,
          ])
        ).length,
        0,
      );

    const [request] = await db.query<{
      state: string;
      note_encrypted: string;
      verification_encrypted: string | null;
    }>(
      "select state,note_encrypted,verification_encrypted from privacy_requests where id=$1",
      [requestId],
    );
    assert.equal(request.state, "completed");
    assert.equal(request.verification_encrypted, null);
    assert.equal(
      decrypt(request.note_encrypted),
      "Personal request details erased after verified completion.",
    );
  } finally {
    await db.close?.();
  }
});

test("a blocked erasure rolls back credential revocation and identifier changes", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "privacy-rollback");
    const credentials = await addAccessAndCredentials(db, fixture, "rollback");
    const [before] = await db.query<{ phone: string; home_zip: string }>(
      `select c.phone,m.home_zip from customers c join uptick_members m
       on m.customer_id=c.id where m.id=$1`,
      [fixture.members[0].id],
    );
    await db.query(
      "insert into customers(id,phone) values('privacy-blocker-customer','+12125550777')",
    );
    await db.query(
      `insert into uptick_members(
        id,customer_id,home_zip,market_id,state,verified_at,data_kind,
        age_confirmed_at
       ) values('privacy-blocker-member','privacy-blocker-customer','10001',
        $1,'active',now(),'synthetic',now())`,
      [fixture.marketId],
    );
    await db.query(
      `insert into member_access(
        id,member_id,token_hash,token_encrypted,purpose,expires_at,confirmed_at,
        disclosure,home_zip,age_attested
       ) values('privacy-blocker-access','privacy-blocker-member',$1,
        'blocker-encrypted','access',now()+interval '30 days',now(),
        'Synthetic blocker access disclosure','10001',true)`,
      [`revoked:${credentials.accessId}`],
    );
    await approvePolicy(db, fixture.actor);
    const requestId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      requestInput(fixture, "deletion", "privacy-rollback-deletion"),
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId,
      evidence: "Operator verified the rollback fixture deletion request.",
    });
    await assert.rejects(
      completePrivacyRequest(db, fixture.actor, {
        requestId,
        resolution:
          "This erasure must roll back after the credential collision.",
        retainedEvidenceReviewed: true,
      }),
      /unique|duplicate/i,
    );

    const [after] = await db.query<{ phone: string; home_zip: string }>(
      `select c.phone,m.home_zip from customers c join uptick_members m
       on m.customer_id=c.id where m.id=$1`,
      [fixture.members[0].id],
    );
    assert.deepEqual(after, before);
    const [access] = await db.query<{
      token_hash: string;
      token_encrypted: string;
    }>("select token_hash,token_encrypted from member_access where id=$1", [
      credentials.accessId,
    ]);
    assert.equal(access.token_encrypted === "erased", false);
    assert.notEqual(access.token_hash, `revoked:${credentials.accessId}`);
    const [session] = await db.query<{ revoked_at: string | null }>(
      "select revoked_at from member_sessions where member_id=$1",
      [fixture.members[0].id],
    );
    assert.equal(session.revoked_at, null);
    const [recovery] = await db.query<{ revoked_at: string | null }>(
      "select revoked_at from member_recovery_codes where member_id=$1",
      [fixture.members[0].id],
    );
    assert.equal(recovery.revoked_at, null);
    assert.equal(
      (await db.query("select member_id from member_erasure_records")).length,
      0,
    );
    const [request] = await db.query<{ state: string }>(
      "select state from privacy_requests where id=$1",
      [requestId],
    );
    assert.equal(request.state, "verified");
  } finally {
    await db.close?.();
  }
});

test("a completed erasure remains idempotent after its private request note is erased", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "privacy-retry");
    await approvePolicy(db, fixture.actor);
    const input = requestInput(
      fixture,
      "deletion",
      "privacy-completed-erasure-retry",
      "Erase my private account identifiers after identity verification.",
    );
    const requestId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      input,
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId,
      evidence:
        "Operator verified the member through the approved account route.",
    });
    await completePrivacyRequest(db, fixture.actor, {
      requestId,
      resolution:
        "Completed verified identifier erasure and retained evidence review.",
      retainedEvidenceReviewed: true,
    });

    const retriedRequestId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      input,
    );
    assert.equal(retriedRequestId, requestId);
    assert.equal(
      (
        await db.query("select id from privacy_requests where request_key=$1", [
          input.requestKey,
        ])
      ).length,
      1,
    );
  } finally {
    await db.close?.();
  }
});

test("erasure completion cannot re-expose an erased identifier in operator records", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "privacy-resolution");
    const originalPhone = "+12125550123";
    await db.query("update customers set phone=$2 where id=$1", [
      fixture.members[0].customerId,
      originalPhone,
    ]);
    await approvePolicy(db, fixture.actor);
    const requestId = await createPrivacyRequest(
      db,
      { memberId: fixture.members[0].id },
      requestInput(
        fixture,
        "deletion",
        "privacy-erasure-resolution-identifier",
        `Erase the account that currently uses ${originalPhone}.`,
      ),
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId,
      evidence: `Verified control of the account currently using ${originalPhone}.`,
    });
    await completePrivacyRequest(db, fixture.actor, {
      requestId,
      resolution: `Completed erasure for the member using ${originalPhone}.`,
      retainedEvidenceReviewed: true,
    });

    const operations = await privacyOperations(db, fixture.actor);
    const completed = operations.requests.find(
      (request) => request.id === requestId,
    );
    assert.ok(completed);
    assert.equal(
      JSON.stringify(completed).includes(originalPhone),
      false,
      "the operator queue must not return a phone number after identifier erasure",
    );
  } finally {
    await db.close?.();
  }
});
