import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import { isQuietHours, weekKey } from "../src/lib/domain";
import { smsEnvironmentBlock } from "../src/lib/environment";
import {
  memberInbound,
  memberMessageEligibility,
  queueMemberDrop,
  type MemberMessage,
} from "../src/lib/member-messaging";
import {
  exchangeMemberAccess,
  memberPreferences,
  requestMemberAccess,
} from "../src/lib/network";

let db: DB;
const memberPhone = "+12015550123";
const serviceSid = `MG${"a".repeat(32)}`;

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
  process.env.SMS_TRANSPORT = "development";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.PRODUCTION_DELIVERY_ENABLED;
  delete process.env.MEMBER_ACCESS_SMS_ENABLED;
  delete process.env.MEMBER_PROMOTIONAL_SMS_ENABLED;
  await db.query(
    "truncate organizations,market_cells,customers,member_senders,rate_limits cascade",
  );
  await db.query(
    "insert into organizations(id,name,capabilities) values('merchant','Sample store','{merchant}')",
  );
  await db.query(
    "insert into market_cells(id,name,slug,state) values('market','Pilot','pilot','pilot')",
  );
  await db.query(
    "insert into market_zips(market_id,zip) values('market','10583')",
  );
  await db.query(
    "insert into member_senders(id,service_sid,phone,approved) values('member-sender',$1,'+12015550199',true)",
    [serviceSid],
  );
});

async function join(consentRequested: boolean, acceptMarketing: boolean) {
  const requested = await requestMemberAccess(db, {
    phone: memberPhone,
    homeZip: "10583",
    ageAttested: true,
    consentRequested,
  });
  const exchanged = await exchangeMemberAccess(
    db,
    requested.credential,
    acceptMarketing,
  );
  return { ...requested, sessionCredential: exchanged.credential };
}

async function confirmations() {
  return db.query<MemberMessage>(
    "select * from member_messages where purpose='opt_in_confirmation' order by created_at,id",
  );
}

async function queueCurrentWeekly(memberId: string) {
  const week = weekKey(new Date(), "America/New_York");
  await db.query(
    "insert into locations(id,organization_id,name,address) values('location','merchant','Main','123 Test Street')",
  );
  await db.query(
    "insert into market_locations(market_id,location_id,organization_id) values('market','location','merchant')",
  );
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values('offer','merchant','location','drop','live','Free coffee')",
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values('offer',1,'Visit','Free coffee','One per member',now()-interval '1 day',now()+interval '7 days')",
  );
  await db.query(
    "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,approved_by) values('supply','market','merchant','location','offer',1,'approved',now()-interval '1 day',now()+interval '7 days','unlimited','operator')",
  );
  await db.query(
    "insert into member_allocations(id,member_id,market_id,week_key) values('allocation',$1,'market',$2)",
    [memberId, week],
  );
  await db.query(
    "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values('allocation','supply','market',1,'{}')",
  );
  const accessId = "drop-access";
  await db.query(
    "insert into member_access(id,member_id,token_hash,token_encrypted,purpose,expires_at,disclosure,home_zip) values($1,$2,'drop-hash','drop-token','drop',now()+interval '2 days','Drop access','10583')",
    [accessId, memberId],
  );
  return queueMemberDrop(db, {
    memberId,
    accessId,
    allocationId: "allocation",
    weekKey: week,
  });
}

test("declining promotional SMS activates membership without a confirmation message", async () => {
  await join(false, false);
  const [consent] = await db.query<{
    accepted: boolean;
    consent_action: string;
  }>("select accepted,consent_action from member_consents");
  assert.deepEqual(consent, { accepted: false, consent_action: "declined" });
  assert.equal((await confirmations()).length, 0);
});

test("a confirmed initial opt-in queues one confirmation bound to its consent and replay cannot duplicate it", async () => {
  const requested = await requestMemberAccess(db, {
    phone: memberPhone,
    homeZip: "10583",
    ageAttested: true,
    consentRequested: true,
  });
  await exchangeMemberAccess(db, requested.credential, true);
  await assert.rejects(
    exchangeMemberAccess(db, requested.credential, true),
    /already used/,
  );

  const [consent] = await db.query<{ id: string }>(
    "select id from member_consents where accepted and consent_action='opt_in'",
  );
  const [message] = await confirmations();
  assert.equal(message.consent_id, consent.id);
  assert.equal(message.access_id, null);
  assert.equal(message.allocation_id, null);
  assert.equal(message.week_key, null);
  assert.equal((await confirmations()).length, 1);
});

test("a returning member can opt in only through a fresh explicit two-screen choice", async () => {
  await join(false, false);
  const returning = await requestMemberAccess(db, {
    phone: memberPhone,
    homeZip: "10001",
    ageAttested: true,
    consentRequested: true,
  });
  const exchanged = await exchangeMemberAccess(db, returning.credential, true);

  assert.equal(exchanged.member.home_zip, "10583");
  const consents = await db.query<{
    id: string;
    accepted: boolean;
    consent_action: string;
  }>(
    "select id,accepted,consent_action from member_consents order by sequence",
  );
  assert.deepEqual(
    consents.map(({ accepted, consent_action }) => ({
      accepted,
      consent_action,
    })),
    [
      { accepted: false, consent_action: "declined" },
      { accepted: true, consent_action: "opt_in" },
    ],
  );
  assert.equal((await confirmations())[0].consent_id, consents[1].id);
});

test("repeated on preferences preserve new consent evidence without another confirmation", async () => {
  const joined = await join(true, true);
  await memberPreferences(db, joined.sessionCredential, {
    homeZip: "10583",
    workZip: "",
    subscribed: true,
  });
  await memberPreferences(db, joined.sessionCredential, {
    homeZip: "10583",
    workZip: "",
    subscribed: true,
  });

  assert.equal(
    (
      await db.query(
        "select id from member_consents where accepted and consent_action='opt_in'",
      )
    ).length,
    3,
  );
  assert.equal((await confirmations()).length, 1);
});

test("turning preferences off suppresses every queued promotional purpose", async () => {
  const joined = await join(true, true);
  const weekly = await queueCurrentWeekly(joined.member.id);
  await memberPreferences(db, joined.sessionCredential, {
    homeZip: "10583",
    workZip: "",
    subscribed: false,
  });

  const promotional = await db.query<{ purpose: string; state: string }>(
    "select purpose,state from member_messages where purpose<>'access' order by purpose",
  );
  assert.deepEqual(promotional, [
    { purpose: "drop", state: "suppressed" },
    { purpose: "opt_in_confirmation", state: "suppressed" },
  ]);
  assert.equal(
    (
      await db.query<{ state: string }>(
        "select state from member_messages where id=$1",
        [weekly.id],
      )
    )[0].state,
    "suppressed",
  );
});

test("STOP suppresses a queued confirmation, START does not restore consent, and a new web opt-in creates a new confirmation", async () => {
  const joined = await join(true, true);
  const [firstConfirmation] = await confirmations();
  const stop = await memberInbound(db, {
    MessageSid: `SM${"b".repeat(32)}`,
    From: memberPhone,
    MessagingServiceSid: serviceSid,
    OptOutType: "STOP",
    Body: "STOP",
  });
  assert.equal(stop.shouldReply, false);
  assert.equal(
    (
      await db.query<{ state: string }>(
        "select state from member_messages where id=$1",
        [firstConfirmation.id],
      )
    )[0].state,
    "suppressed",
  );

  const start = await memberInbound(db, {
    MessageSid: `SM${"c".repeat(32)}`,
    From: memberPhone,
    MessagingServiceSid: serviceSid,
    OptOutType: "START",
    Body: "START",
  });
  assert.equal(start.shouldReply, false);
  assert.equal(
    (
      await db.query<{ accepted: boolean }>(
        "select accepted from member_consents order by sequence desc limit 1",
      )
    )[0].accepted,
    false,
  );
  assert.equal((await confirmations()).length, 1);

  await memberPreferences(db, joined.sessionCredential, {
    homeZip: "10583",
    workZip: "",
    subscribed: true,
  });
  const messages = await confirmations();
  assert.equal(messages.length, 2);
  assert.equal(messages[0].state, "suppressed");
  assert.equal(messages[1].state, "queued");
  assert.notEqual(messages[0].consent_id, messages[1].consent_id);
});

test("the confirmation observes quiet hours and does not consume the weekly Drop slot", async () => {
  const joined = await join(true, true);
  const [confirmation] = await confirmations();
  const scheduled = new Date(confirmation.scheduled_at);
  const quietTime = Array.from(
    { length: 24 },
    (_, hours) => new Date(scheduled.getTime() + hours * 60 * 60 * 1000),
  ).find((candidate) => isQuietHours(candidate, confirmation.timezone));
  assert.ok(quietTime);
  assert.equal(
    await memberMessageEligibility(db, confirmation, quietTime),
    "quiet_hours",
  );

  const week = weekKey(new Date(), "America/New_York");
  const drop = await queueCurrentWeekly(joined.member.id);
  assert.equal(drop.purpose, "drop");
  assert.equal(
    (
      await db.query(
        "select id from member_messages where member_id=$1 and purpose='drop' and week_key=$2",
        [joined.member.id, week],
      )
    ).length,
    1,
  );
});

test("production requires the global kill switch and separate access and promotional class gates", () => {
  process.env.UPTICK_ENV = "production";
  process.env.UPTICK_LOCAL_MODE = "false";
  process.env.APP_URL = "https://pilot.upticklocal.com";
  process.env.SMS_TRANSPORT = "twilio";

  assert.match(
    smsEnvironmentBlock(memberPhone, "access")!,
    /Production delivery/,
  );
  process.env.PRODUCTION_DELIVERY_ENABLED = "true";
  assert.match(smsEnvironmentBlock(memberPhone, "access")!, /access SMS/);
  process.env.MEMBER_ACCESS_SMS_ENABLED = "true";
  assert.equal(smsEnvironmentBlock(memberPhone, "access"), null);
  assert.match(
    smsEnvironmentBlock(memberPhone, "promotion")!,
    /Promotional membership SMS/,
  );
  process.env.MEMBER_PROMOTIONAL_SMS_ENABLED = "true";
  assert.equal(smsEnvironmentBlock(memberPhone, "promotion"), null);
  delete process.env.PRODUCTION_DELIVERY_ENABLED;
  assert.match(
    smsEnvironmentBlock(memberPhone, "promotion")!,
    /Production delivery/,
  );
});
