import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import { assertMemberAccountAccess } from "../src/lib/member-service";
import {
  createMemberSession,
  revokeMemberSession,
} from "../src/lib/member-session";
import { memberAccess } from "../src/lib/membership-identity";
import {
  createPrivacyRequest,
  exportMemberData,
  memberPrivacyRequests,
  verifyPrivacyRequest,
} from "../src/lib/privacy-admin";
import { encrypt, hash, token } from "../src/lib/security";

let db: DB;
const operator: Actor = {
  id: "privacy-operator",
  role: "operator",
  organizationId: "uptick",
};

before(async () => {
  db = await memoryDb();
});

after(async () => {
  await db.close?.();
});

beforeEach(async () => {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  delete process.env.VERCEL;
  await db.query("truncate organizations,customers cascade");
  await db.query(
    "insert into organizations(id,name,capabilities) values('uptick','Uptick Local','{operator}')",
  );
});

async function memberFixture(suffix: string) {
  const customerId = `customer-${suffix}`;
  const memberId = `member-${suffix}`;
  const accessId = `access-${suffix}`;
  const accessCredential = token();
  await db.query("insert into customers(id,phone) values($1,$2)", [
    customerId,
    `+1201555${suffix.padStart(4, "0")}`,
  ]);
  await db.query(
    "insert into uptick_members(id,customer_id,home_zip,state,verified_at,age_confirmed_at) values($1,$2,'10583','active',now(),now())",
    [memberId, customerId],
  );
  await db.query(
    `insert into member_access(
      id,member_id,token_hash,token_encrypted,purpose,expires_at,confirmed_at,
      disclosure,home_zip,age_attested
    ) values($1,$2,$3,$4,'access',now()+interval '1 day',now(),
      'Verified member access',$5,true)`,
    [
      accessId,
      memberId,
      hash(accessCredential),
      encrypt(accessCredential),
      "10583",
    ],
  );
  const session = await createMemberSession(db, memberId, accessId);
  return {
    customerId,
    memberId,
    accessId,
    accessCredential,
    sessionCredential: session.credential,
  };
}

async function accessRequest(memberId: string, suffix: string, verify = true) {
  const requestId = await createPrivacyRequest(
    db,
    { memberId },
    {
      memberId,
      kind: "access",
      note: "Please provide my verified Uptick account data export.",
      requestKey: `privacy-access-${suffix}`,
    },
  );
  if (verify)
    await verifyPrivacyRequest(db, operator, {
      requestId,
      evidence: "Operator verified control through the approved account path.",
    });
  return requestId;
}

async function selfDownload(credential: string, requestId: string) {
  const { member } = await memberAccess(db, credential, true);
  return exportMemberData(db, { memberId: member.id }, requestId);
}

test("a signed-in member can list and download only their own verified access request", async () => {
  const own = await memberFixture("1");
  const other = await memberFixture("2");
  const ownRequest = await accessRequest(own.memberId, "own");
  const otherRequest = await accessRequest(other.memberId, "other");

  const listed = await memberPrivacyRequests(db, own.memberId);
  assert.deepEqual(
    listed.map((request) => request.id),
    [ownRequest],
  );
  const downloaded = await selfDownload(own.sessionCredential, ownRequest);
  assert.equal(
    (downloaded.member as { id: string; phone: string }).id,
    own.memberId,
  );
  assert.equal(
    (downloaded.member as { id: string; phone: string }).phone,
    "+12015550001",
  );
  await assert.rejects(
    selfDownload(own.sessionCredential, otherRequest),
    /this member's data-access request/i,
  );
});

test("an unverified privacy request cannot be downloaded", async () => {
  const own = await memberFixture("3");
  const requestId = await accessRequest(own.memberId, "unverified", false);

  await assert.rejects(
    selfDownload(own.sessionCredential, requestId),
    /verify this member's data-access request/i,
  );
  assert.equal(
    (
      await db.query(
        "select id from audit_events where action='privacy_access_export'",
      )
    ).length,
    0,
  );
});

test("a revoked member session cannot reach a previously verified download", async () => {
  const own = await memberFixture("4");
  const requestId = await accessRequest(own.memberId, "revoked");
  assert.equal(await revokeMemberSession(db, own.sessionCredential), true);

  await assert.rejects(
    selfDownload(own.sessionCredential, requestId),
    /open your private uptick link/i,
  );
});

test("a suspended account is stopped by the account service gate before export", async () => {
  const own = await memberFixture("5");
  const requestId = await accessRequest(own.memberId, "suspended");
  await db.query(
    `insert into member_service_events(
      id,member_id,kind,reason,actor_id,actor_kind,request_key
    ) values('suspension',$1,'suspended',
      'Operator suspended access pending account review.',$2,'operator',
      'privacy-access-suspension')`,
    [own.memberId, operator.id],
  );

  await assert.rejects(
    assertMemberAccountAccess(db, own.memberId),
    /needs Uptick support/i,
  );
  await assert.rejects(
    selfDownload(own.accessCredential, requestId),
    /needs Uptick support/i,
  );
});

test("an erased account is stopped before retained privacy data can be exported", async () => {
  const own = await memberFixture("6");
  const accessRequestId = await accessRequest(own.memberId, "before-erasure");
  const deletionRequestId = await createPrivacyRequest(
    db,
    { memberId: own.memberId },
    {
      memberId: own.memberId,
      kind: "deletion",
      note: "Please erase my identifiers after the required verification.",
      requestKey: "privacy-access-erasure",
    },
  );
  await verifyPrivacyRequest(db, operator, {
    requestId: deletionRequestId,
    evidence:
      "Operator verified the erasure request through the approved path.",
  });
  await db.query(
    `insert into privacy_policy_versions(
      id,scope,retention_days,approval_evidence,approved_by,review_due_at
    ) values('privacy-policy','Approved member privacy retention policy.',
      '{"identifiers":0,"support":0,"consent":365,"operational":730,"financial":2555}',
      'Approved by the accountable privacy operator.',$1,
      now()+interval '30 days')`,
    [operator.id],
  );
  await db.query(
    `insert into member_erasure_records(
      member_id,customer_id,request_id,policy_id,actor_id,
      retained_categories,review_due_at
    ) values($1,$2,$3,'privacy-policy',$4,'{}',now()+interval '30 days')`,
    [own.memberId, own.customerId, deletionRequestId, operator.id],
  );

  await assert.rejects(
    assertMemberAccountAccess(db, own.memberId),
    /account was erased/i,
  );
  await assert.rejects(
    selfDownload(own.sessionCredential, accessRequestId),
    /account was erased/i,
  );
});
