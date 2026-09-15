import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import {
  applyPhoneCorrection,
  confirmPhoneCorrection,
  phoneCorrectionPreview,
  preparePhoneCorrection,
} from "../src/lib/member-phone-correction";
import {
  createPrivacyRequest,
  verifyPrivacyRequest,
} from "../src/lib/privacy-admin";
import { dispatchMemberMessages } from "../src/lib/member-messaging";
import { claimMemberDrop } from "../src/lib/network";
import { recommendPilotAssignments } from "../src/lib/pilot-assignment";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import { decrypt, encrypt, hash, token } from "../src/lib/security";
import { redeemAtPoint } from "../src/lib/tap";
import { seedSyntheticPilot } from "../scripts/verify-postgres-pilot";

const oldPhone = "+12125560110";
const newPhone = "+12125560111";

function localEnvironment() {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  process.env.PRIVACY_SUPPRESSION_KEY = "privacy-phone-correction-test-key";
  for (const name of [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "CRON_SECRET",
    "MESSAGING_APPROVED",
    "LEGAL_APPROVED",
    "MEMBER_ACCESS_SMS_ENABLED",
    "MEMBER_PROMOTIONAL_SMS_ENABLED",
    "BUSINESS_LEGAL_NAME",
    "SUPPORT_EMAIL",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "INTERNAL_TEST_NUMBERS",
    "PRODUCTION_DELIVERY_ENABLED",
    "PILOT_ENROLLMENT_ENABLED",
  ])
    delete process.env[name];
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
}

function stagingEnvironment(recipient = newPhone) {
  process.env.UPTICK_ENV = "staging";
  process.env.UPTICK_LOCAL_MODE = "false";
  process.env.APP_URL = "https://pilot.uptick.example";
  process.env.SMS_TRANSPORT = "twilio";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  process.env.PRIVACY_SUPPRESSION_KEY = "privacy-phone-correction-test-key";
  process.env.INTERNAL_TEST_NUMBERS = recipient;
  process.env.DATABASE_URL = "postgresql://test@unused.invalid/test";
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-only";
  process.env.CRON_SECRET = "c".repeat(64);
  process.env.MESSAGING_APPROVED = "true";
  process.env.LEGAL_APPROVED = "true";
  process.env.MEMBER_ACCESS_SMS_ENABLED = "true";
  process.env.MEMBER_PROMOTIONAL_SMS_ENABLED = "true";
  process.env.BUSINESS_LEGAL_NAME = "Test Uptick";
  process.env.SUPPORT_EMAIL = "support@uptick.example";
  process.env.TWILIO_ACCOUNT_SID = `AC${"a".repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = "test-only-token";
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
}

type BasicFixture = {
  db: DB;
  actor: Actor;
  memberId: string;
  customerId: string;
  requestId: string;
};

async function basicFixture(
  prefix: string,
  options: { staging?: boolean; verify?: boolean } = {},
): Promise<BasicFixture> {
  if (options.staging) stagingEnvironment();
  else localEnvironment();
  const db = await memoryDb();
  const actor: Actor = {
    id: `${prefix}-operator`,
    role: "operator",
    organizationId: `${prefix}-organization`,
  };
  const customerId = `${prefix}-customer`;
  const memberId = `${prefix}-member`;
  await db.query(
    "insert into organizations(id,name) values($1,'Phone correction test operator')",
    [actor.organizationId],
  );
  await db.query(
    "insert into memberships(user_id,organization_id,role) values($1,$2,'operator')",
    [actor.id, actor.organizationId],
  );
  await db.query(
    "insert into market_cells(id,name,slug,state,data_kind) values($1,'Phone correction test market',$2,'pilot','internal')",
    [`${prefix}-market`, `${prefix}-market`],
  );
  await db.query("insert into customers(id,phone) values($1,$2)", [
    customerId,
    oldPhone,
  ]);
  await db.query(
    "insert into uptick_members(id,customer_id,home_zip,market_id,state,verified_at,data_kind,age_confirmed_at) values($1,$2,'10001',$3,'active',now(),'internal',now())",
    [memberId, customerId, `${prefix}-market`],
  );
  await db.query(
    `insert into member_senders(id,service_sid,phone,approved,active)
     values($1,$2,'+12125560999',true,true)`,
    [`${prefix}-sender`, `MG${"a".repeat(32)}`],
  );
  const requestId = await createPrivacyRequest(
    db,
    { memberId },
    {
      memberId,
      kind: "correction",
      note: "Please change the phone number attached to my existing membership.",
      requestKey: `${prefix}-correction-request`,
    },
  );
  if (options.verify !== false)
    await verifyPrivacyRequest(db, actor, {
      requestId,
      evidence:
        "The operator verified the requesting member through the approved account process.",
    });
  return { db, actor, memberId, customerId, requestId };
}

async function prepare(fixture: BasicFixture, phone = newPhone) {
  return preparePhoneCorrection(fixture.db, fixture.actor, {
    requestId: fixture.requestId,
    newPhone: phone,
    requestedByMember: true,
  });
}

test("preparation requires an operator and a verified correction, and rejects same or owned numbers", async () => {
  const queued = await basicFixture("phone-gates-queued", { verify: false });
  try {
    await assert.rejects(prepare(queued), /verify.*correction request/i);
    await verifyPrivacyRequest(queued.db, queued.actor, {
      requestId: queued.requestId,
      evidence:
        "The operator verified the requesting member through the approved account process.",
    });
    await assert.rejects(
      preparePhoneCorrection(
        queued.db,
        { ...queued.actor, role: "merchant" },
        {
          requestId: queued.requestId,
          newPhone,
          requestedByMember: true,
        },
      ),
      /operator access/i,
    );
    await assert.rejects(prepare(queued, oldPhone), /already on this account/i);
    await queued.db.query(
      "insert into customers(id,phone) values('phone-gates-other-customer',$1)",
      [newPhone],
    );
    await assert.rejects(prepare(queued), /another account|cannot be merged/i);

    const accessRequest = await createPrivacyRequest(
      queued.db,
      { memberId: queued.memberId },
      {
        memberId: queued.memberId,
        kind: "access",
        note: "This access request cannot authorize a phone-number correction.",
        requestKey: "phone-gates-access-request",
      },
    );
    await verifyPrivacyRequest(queued.db, queued.actor, {
      requestId: accessRequest,
      evidence: "The operator verified this data access request independently.",
    });
    await assert.rejects(
      preparePhoneCorrection(queued.db, queued.actor, {
        requestId: accessRequest,
        newPhone: "+12125560112",
        requestedByMember: true,
      }),
      /correction request/i,
    );
  } finally {
    await queued.db.close?.();
  }
});

test("the encrypted one-use challenge is sent only to the proposed number and rejects expiry and replay", async () => {
  const fixture = await basicFixture("phone-challenge", { staging: true });
  try {
    const result = await prepare(fixture);
    const [stored] = await fixture.db.query<{
      new_phone_encrypted: string;
      token_hash: string;
      token_encrypted: string;
      expires_at: string;
    }>(
      "select new_phone_encrypted,token_hash,token_encrypted,expires_at from member_phone_changes where id=$1",
      [result.changeId],
    );
    const [message] = await fixture.db.query<{
      recipient_encrypted: string;
      recipient_hint: string;
      state: string;
    }>(
      "select recipient_encrypted,recipient_hint,state from member_messages where id=$1",
      [result.messageId],
    );
    assert.notEqual(stored.new_phone_encrypted, newPhone);
    assert.equal(stored.new_phone_encrypted.includes(newPhone), false);
    assert.equal(decrypt(stored.new_phone_encrypted), newPhone);
    assert.notEqual(stored.token_encrypted, result.credential);
    assert.equal(stored.token_hash, hash(result.credential));
    assert.equal(decrypt(message.recipient_encrypted), newPhone);
    assert.equal(message.recipient_hint, newPhone.slice(-4));
    assert.equal(message.state, "queued");
    assert.ok(
      new Date(stored.expires_at).getTime() > Date.now(),
      "the challenge must be unexpired when prepared",
    );
    assert.deepEqual(
      await phoneCorrectionPreview(fixture.db, result.credential),
      {
        phoneHint: newPhone.slice(-4),
        confirmed: false,
      },
    );

    const sends: { to: string; body: string }[] = [];
    assert.equal(
      await dispatchMemberMessages(
        fixture.db,
        1,
        async (sms) => {
          sends.push({ to: sms.to, body: sms.body });
          return { sid: `SM${"b".repeat(32)}` };
        },
        result.messageId,
      ),
      1,
    );
    assert.equal(sends.length, 1);
    assert.equal(sends[0].to, newPhone);
    assert.match(sends[0].body, /does not subscribe.*promotional/i);
    assert.ok(sends[0].body.includes(result.credential));
    assert.equal(sends[0].body.includes(oldPhone), false);

    assert.equal(
      await confirmPhoneCorrection(fixture.db, result.credential),
      result.changeId,
    );
    await assert.rejects(
      confirmPhoneCorrection(fixture.db, result.credential),
      /already recorded/i,
    );
    await assert.rejects(
      prepare(fixture),
      /already.*verified|already.*used|new.*request/i,
      "a confirmed one-use challenge must not be returned to the operator again",
    );

    const expiredRequest = await createPrivacyRequest(
      fixture.db,
      { memberId: fixture.memberId },
      {
        memberId: fixture.memberId,
        kind: "correction",
        note: "This fixture represents an expired phone verification challenge.",
        requestKey: "phone-challenge-expired-request",
      },
    );
    await verifyPrivacyRequest(fixture.db, fixture.actor, {
      requestId: expiredRequest,
      evidence:
        "The member identity was verified for the expired-link fixture.",
    });
    const expiredCredential = token();
    await fixture.db.query(
      `insert into member_phone_changes(
        id,request_id,member_id,new_phone_encrypted,token_hash,token_encrypted,
        created_by,created_at,expires_at
       ) values('phone-challenge-expired',$1,$2,$3,$4,$5,$6,
        now()-interval '30 minutes',now()-interval '15 minutes')`,
      [
        expiredRequest,
        fixture.memberId,
        encrypt("+12125560113"),
        hash(expiredCredential),
        encrypt(expiredCredential),
        fixture.actor.id,
      ],
    );
    await assert.rejects(
      phoneCorrectionPreview(fixture.db, expiredCredential),
      /expired/i,
    );
    await assert.rejects(
      confirmPhoneCorrection(fixture.db, expiredCredential),
      /expired/i,
    );
  } finally {
    await fixture.db.close?.();
  }
});

test("application requires recent confirmation and rechecks ownership after verification", async () => {
  const stale = await basicFixture("phone-stale-confirmation");
  try {
    const change = await prepare(stale);
    await assert.rejects(
      stale.db.transaction((tx) =>
        applyPhoneCorrection(tx, stale.actor, stale.requestId, stale.memberId),
      ),
      /verified within the last 24 hours/i,
    );
    await stale.db.query(
      "update member_phone_changes set confirmed_at=now()-interval '25 hours' where id=$1",
      [change.changeId],
    );
    await assert.rejects(
      stale.db.transaction((tx) =>
        applyPhoneCorrection(tx, stale.actor, stale.requestId, stale.memberId),
      ),
      /within the last 24 hours/i,
    );
  } finally {
    await stale.db.close?.();
  }

  const raced = await basicFixture("phone-collision-race");
  try {
    const change = await prepare(raced);
    await confirmPhoneCorrection(raced.db, change.credential);
    await raced.db.query(
      "insert into customers(id,phone) values('phone-collision-race-owner',$1)",
      [newPhone],
    );
    await assert.rejects(
      raced.db.transaction((tx) =>
        applyPhoneCorrection(tx, raced.actor, raced.requestId, raced.memberId),
      ),
      /now belongs to another account|cannot merge/i,
    );
    const [owner] = await raced.db.query<{ phone: string }>(
      "select phone from customers where id=$1",
      [raced.customerId],
    );
    const [stored] = await raced.db.query<{ applied_at: string | null }>(
      "select applied_at from member_phone_changes where id=$1",
      [change.changeId],
    );
    assert.equal(owner.phone, oldPhone);
    assert.equal(stored.applied_at, null);
  } finally {
    await raced.db.close?.();
  }
});

test("successful application preserves the member and redeemed promise while invalidating old credentials and consent", async () => {
  localEnvironment();
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "phone-preservation");
    const member = fixture.members[0];
    await db.query("update customers set phone=$2 where id=$1", [
      member.customerId,
      oldPhone,
    ]);
    await db.query(
      `insert into member_senders(id,service_sid,phone,approved,active)
       values('phone-preservation-sender',$1,'+12125560999',true,true)`,
      [`MG${"c".repeat(32)}`],
    );

    const accessId = "phone-preservation-access";
    const accessCredential = token();
    await db.query(
      `insert into member_access(
        id,member_id,token_hash,token_encrypted,purpose,expires_at,confirmed_at,
        disclosure,home_zip,age_attested
       ) values($1,$2,$3,$4,'access',now()+interval '30 days',now(),
        'Synthetic member access','10001',true)`,
      [accessId, member.id, hash(accessCredential), encrypt(accessCredential)],
    );
    await db.query(
      "insert into member_sessions(id,member_id,source_access_id,token_hash,expires_at) values('phone-preservation-session',$1,$2,'old-session-hash',now()+interval '30 days')",
      [member.id, accessId],
    );
    await db.query(
      "insert into member_recovery_codes(id,member_id,code_hash,expires_at) values('phone-preservation-recovery',$1,'old-recovery-hash',now()+interval '30 days')",
      [member.id],
    );
    await db.query(
      `insert into member_consents(
        id,member_id,accepted,disclosure_version,disclosure,source_ui,
        consent_purpose,consent_action
       ) values('phone-preservation-opt-in',$1,true,'test-v1',
        'Promotional membership SMS','member-preferences',
        'promotional_membership_sms','opt_in')`,
      [member.id],
    );
    await db.query(
      `insert into member_messages(
        id,member_id,access_id,sender_id,purpose,expires_at,environment,state,
        recipient_encrypted,recipient_hint
       ) values('phone-preservation-old-message',$1,$2,
        'phone-preservation-sender','access',now()+interval '1 day',
        'development','queued',$3,$4)`,
      [member.id, accessId, encrypt(oldPhone), oldPhone.slice(-4)],
    );

    const recommendation = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );
    const release = await releaseWeeklyBenefits(db, fixture.actor, {
      runId: fixture.runId,
      marketId: fixture.marketId,
      weekKey: fixture.weekKey,
      dataKind: "synthetic",
      requestKey: "phone-preservation-release",
      recommendationFingerprint: recommendation.fingerprint,
      assignments: recommendation.assignments.map(({ memberId, supplyId }) => ({
        memberId,
        supplyId,
      })),
    });
    const claim = await claimMemberDrop(db, accessCredential, fixture.supplyId);
    const oldPassCredential = decrypt(claim.token_encrypted);
    await redeemAtPoint(db, oldPassCredential, {
      pointToken: fixture.pointToken,
    });

    const [memberBefore] = await db.query<Record<string, unknown>>(
      "select id,customer_id,home_zip,work_zip,market_id,source_id,state,verified_at,data_kind,age_confirmed_at from uptick_members where id=$1",
      [member.id],
    );
    const [admissionBefore] = await db.query<Record<string, unknown>>(
      "select run_id,member_id,source_id,data_kind,admitted_at from pilot_admissions where run_id=$1 and member_id=$2",
      [fixture.runId, member.id],
    );
    const [grantBefore] = await db.query<Record<string, unknown>>(
      "select id,member_id,release_id,supply_id,week_key,member_snapshot,state,created_at,claimed_at,redeemed_at,data_kind from fulfillment_grants where id=$1",
      [release.grants[0].id],
    );
    const [claimBefore] = await db.query<Record<string, unknown>>(
      "select id,customer_id,organization_id,offer_id,offer_version,source_id,broadcast_id,snapshot,state,created_at,opened_at,redeemed_at from claims where id=$1",
      [claim.id],
    );
    const [evidenceBefore] = await db.query<Record<string, unknown>>(
      "select * from redemption_evidence where claim_id=$1",
      [claim.id],
    );
    const oldClaimHash = hash(oldPassCredential);
    const oldClaimEncrypted = claim.token_encrypted;

    const requestId = await createPrivacyRequest(
      db,
      { memberId: member.id },
      {
        memberId: member.id,
        kind: "correction",
        note: "Please change the phone number on this existing pilot membership.",
        requestKey: "phone-preservation-correction-request",
      },
    );
    await verifyPrivacyRequest(db, fixture.actor, {
      requestId,
      evidence:
        "The operator verified the member and the request before sending the new-number challenge.",
    });
    const change = await preparePhoneCorrection(db, fixture.actor, {
      requestId,
      newPhone,
      requestedByMember: true,
    });
    await confirmPhoneCorrection(db, change.credential);
    await db.transaction((tx) =>
      applyPhoneCorrection(tx, fixture.actor, requestId, member.id),
    );

    const [customerAfter] = await db.query<{ phone: string }>(
      "select phone from customers where id=$1",
      [member.customerId],
    );
    const [memberAfter] = await db.query<Record<string, unknown>>(
      "select id,customer_id,home_zip,work_zip,market_id,source_id,state,verified_at,data_kind,age_confirmed_at from uptick_members where id=$1",
      [member.id],
    );
    const [admissionAfter] = await db.query<Record<string, unknown>>(
      "select run_id,member_id,source_id,data_kind,admitted_at from pilot_admissions where run_id=$1 and member_id=$2",
      [fixture.runId, member.id],
    );
    const [grantAfter] = await db.query<Record<string, unknown>>(
      "select id,member_id,release_id,supply_id,week_key,member_snapshot,state,created_at,claimed_at,redeemed_at,data_kind from fulfillment_grants where id=$1",
      [release.grants[0].id],
    );
    const [claimAfter] = await db.query<
      Record<string, unknown> & { token_hash: string; token_encrypted: string }
    >(
      "select id,customer_id,organization_id,offer_id,offer_version,source_id,broadcast_id,snapshot,state,created_at,opened_at,redeemed_at,token_hash,token_encrypted from claims where id=$1",
      [claim.id],
    );
    const [evidenceAfter] = await db.query<Record<string, unknown>>(
      "select * from redemption_evidence where claim_id=$1",
      [claim.id],
    );
    assert.equal(customerAfter.phone, newPhone);
    assert.deepEqual(memberAfter, memberBefore);
    assert.deepEqual(admissionAfter, admissionBefore);
    assert.deepEqual(grantAfter, grantBefore);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(claimAfter).filter(
          ([key]) => !["token_hash", "token_encrypted"].includes(key),
        ),
      ),
      claimBefore,
    );
    assert.deepEqual(evidenceAfter, evidenceBefore);
    assert.notEqual(claimAfter.token_hash, oldClaimHash);
    assert.notEqual(claimAfter.token_encrypted, oldClaimEncrypted);
    assert.equal(
      (
        await db.query("select id from claims where token_hash=$1", [
          hash(oldPassCredential),
        ])
      ).length,
      0,
    );

    const [session] = await db.query<{ revoked_at: string | null }>(
      "select revoked_at from member_sessions where id='phone-preservation-session'",
    );
    const [recovery] = await db.query<{ revoked_at: string | null }>(
      "select revoked_at from member_recovery_codes where id='phone-preservation-recovery'",
    );
    const [access] = await db.query<{
      token_hash: string;
      token_encrypted: string;
    }>("select token_hash,token_encrypted from member_access where id=$1", [
      accessId,
    ]);
    assert.ok(session.revoked_at);
    assert.ok(recovery.revoked_at);
    assert.deepEqual(access, {
      token_hash: `revoked:${accessId}`,
      token_encrypted: "erased",
    });

    const [oldMessage] = await db.query<{
      state: string;
      suppression_reason: string;
      recipient_encrypted: string;
    }>(
      "select state,suppression_reason,recipient_encrypted from member_messages where id='phone-preservation-old-message'",
    );
    assert.equal(oldMessage.state, "suppressed");
    assert.match(
      oldMessage.suppression_reason,
      /prior recipient.*not.*retargeted/i,
    );
    assert.equal(decrypt(oldMessage.recipient_encrypted), oldPhone);

    const consents = await db.query<{
      accepted: boolean;
      consent_action: string;
      source_ui: string;
    }>(
      "select accepted,consent_action,source_ui from member_consents where member_id=$1 order by sequence",
      [member.id],
    );
    assert.deepEqual(consents, [
      {
        accepted: true,
        consent_action: "opt_in",
        source_ui: "member-preferences",
      },
      {
        accepted: false,
        consent_action: "opt_out",
        source_ui: "verified-phone-correction",
      },
    ]);
  } finally {
    await db.close?.();
  }
});
