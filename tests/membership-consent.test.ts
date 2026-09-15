import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import {
  exchangeMemberAccess,
  memberAccess,
  requestMemberAccess,
} from "../src/lib/network";
import {
  memberSession,
  recoverMemberSession,
  replaceMemberRecoveryCodes,
  revokeMemberSession,
} from "../src/lib/member-session";
import {
  createMemberSupportRequest,
  memberSupportQueue,
  resolveMemberSupportRequest,
} from "../src/lib/member-experience";
import type { Actor } from "../src/lib/domain";

let db: DB;
const phone = "+12015550123";
const operator: Actor = {
  id: "operator",
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
  await db.query(
    "truncate organizations,market_cells,customers,rate_limits cascade",
  );
  await db.query(
    "insert into market_cells(id,name,slug,state) values('market','Pilot','pilot','pilot')",
  );
  await db.query(
    "insert into organizations(id,name) values('uptick','Uptick Local')",
  );
  await db.query(
    "insert into market_zips(market_id,zip) values('market','10583')",
  );
});

test("adult membership joins without optional promotional consent and preserves the exact choice", async () => {
  const requested = await requestMemberAccess(db, {
    phone,
    homeZip: "10583",
    ageAttested: true,
    consentRequested: false,
  });
  const preview = await memberAccess(db, requested.credential);
  assert.equal(preview.access.confirmed_at, null);
  assert.equal(preview.access.consumed_at, null);
  assert.equal(preview.member.state, "pending");

  const exchanged = await exchangeMemberAccess(db, requested.credential, false);
  assert.equal(exchanged.member.state, "active");
  assert.ok(exchanged.member.verified_at);
  assert.ok(exchanged.member.age_confirmed_at);
  assert.ok(await memberSession(db, exchanged.credential));
  const [choice] = await db.query<{
    accepted: boolean;
    consent_purpose: string;
    consent_action: string;
    disclosure: string;
    source_ui: string;
  }>("select * from member_consents");
  assert.equal(choice.accepted, false);
  assert.equal(choice.consent_purpose, "promotional_membership_sms");
  assert.equal(choice.consent_action, "declined");
  assert.match(choice.disclosure, /^Optional:/);
  assert.equal(choice.source_ui, "private-membership-confirmation");
});

test("one-time access exchange rejects replay while its revocable session remains usable", async () => {
  const requested = await requestMemberAccess(db, {
    phone,
    homeZip: "10583",
    ageAttested: true,
    consentRequested: true,
  });
  const exchanged = await exchangeMemberAccess(db, requested.credential, true);
  await assert.rejects(
    exchangeMemberAccess(db, requested.credential, true),
    /already used/,
  );
  assert.equal(
    (await memberAccess(db, exchanged.credential, true)).member.id,
    requested.member.id,
  );
  assert.equal(await revokeMemberSession(db, exchanged.credential), true);
  assert.equal(await memberSession(db, exchanged.credential), null);
  await assert.rejects(
    memberAccess(db, exchanged.credential, true),
    /Open your private/,
  );
});

test("a returning member keeps their geography and can explicitly opt in on the private confirmation", async () => {
  const first = await requestMemberAccess(db, {
    phone,
    homeZip: "10583",
    ageAttested: true,
    consentRequested: false,
  });
  await exchangeMemberAccess(db, first.credential, false);
  const login = await requestMemberAccess(db, {
    phone,
    homeZip: "10001",
    ageAttested: true,
    consentRequested: true,
  });
  const exchanged = await exchangeMemberAccess(db, login.credential, true);
  assert.equal(exchanged.member.home_zip, "10583");
  const consents = await db.query<{ accepted: boolean }>(
    "select accepted from member_consents order by sequence",
  );
  assert.deepEqual(
    consents.map((consent) => consent.accepted),
    [false, true],
  );
});

test("printed recovery codes are one-use and cannot reassign a phone identity", async () => {
  const requested = await requestMemberAccess(db, {
    phone,
    homeZip: "10583",
    ageAttested: true,
    consentRequested: false,
  });
  const exchanged = await exchangeMemberAccess(db, requested.credential, false);
  const codes = await replaceMemberRecoveryCodes(db, requested.member.id);
  assert.equal(codes.length, 8);
  await assert.rejects(
    recoverMemberSession(db, { phone: "+12015550124", code: codes[0] }),
    /recovery code/,
  );
  await revokeMemberSession(db, exchanged.credential);
  const recovered = await recoverMemberSession(db, {
    phone,
    code: codes[0],
  });
  assert.equal(recovered.memberId, requested.member.id);
  await assert.rejects(
    recoverMemberSession(db, { phone, code: codes[0] }),
    /recovery code/,
  );
});

test("web help carries account context into an operator-only queue without a bearer link", async () => {
  const requested = await requestMemberAccess(db, {
    phone,
    homeZip: "10583",
    ageAttested: true,
    consentRequested: false,
  });
  const exchanged = await exchangeMemberAccess(db, requested.credential, false);
  const leadingHyphenCredential = `-${"a".repeat(42)}`;
  const trailingHyphenCredential = `${"b".repeat(42)}-`;
  await createMemberSupportRequest(
    db,
    exchanged.credential,
    `The counter needs help ${exchanged.credential} ${leadingHyphenCredential} ${trailingHyphenCredential}`,
  );
  const queue = await memberSupportQueue(db, operator);
  assert.equal(queue.length, 1);
  assert.equal(
    queue[0].note,
    "The counter needs help [private credential redacted] [private credential redacted] [private credential redacted]",
  );
  assert.equal(queue[0].phoneHint, "••• ••• 0123");
  assert.ok(!JSON.stringify(queue[0]).includes(exchanged.credential));
  assert.ok(!JSON.stringify(queue[0]).includes(leadingHyphenCredential));
  assert.ok(!JSON.stringify(queue[0]).includes(trailingHyphenCredential));
  await assert.rejects(
    memberSupportQueue(db, { ...operator, role: "merchant" }),
    /access/,
  );
  await resolveMemberSupportRequest(
    db,
    operator,
    queue[0].id,
    "Confirmed the member has the correct counter instructions.",
  );
  assert.equal((await memberSupportQueue(db, operator)).length, 0);
});
