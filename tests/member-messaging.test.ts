import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { memoryDb, type DB } from "../src/lib/db";
import { id, token, hash, encrypt, decrypt } from "../src/lib/security";
import { isQuietHours, weekKey, type Actor } from "../src/lib/domain";
import { localMode } from "../src/lib/config";
import {
  smsEnvironmentBlock,
  simulatedTransport,
  uptickEnvironment,
} from "../src/lib/environment";
import {
  configureMemberSender,
  queueMemberAccess,
  queueMemberDrop,
  dispatchMemberMessages,
  memberMessageEligibility,
  memberMessageStatus,
  memberInbound,
  verifyMemberWebhook,
  type MemberMessage,
} from "../src/lib/member-messaging";
import { pilotPrincipal, pilotPersona } from "../src/lib/pilot-access";
import {
  requestMemberAccess,
  confirmMemberAccess,
  allocateMember,
  claimMemberDrop,
} from "../src/lib/network";
import { createRedemptionPoint, redeemAtPoint } from "../src/lib/tap";
let db: DB;
const phone = "+12015550123",
  serviceSid = `MG${"b".repeat(32)}`,
  providerSid = `SM${"c".repeat(32)}`;
const actor: Actor = {
  id: "approved-pilot-user",
  role: "operator",
  organizationId: "operator-org",
};
const daytimeZone = () =>
  Array.from({ length: 25 }, (_, i) => i - 12)
    .map((offset) => `Etc/GMT${offset >= 0 ? "+" : ""}${offset}`)
    .find((zone) => !isQuietHours(new Date(), zone))!;
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
  process.env.INTERNAL_TEST_NUMBERS = phone;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.STAGING_TEST_USER_IDS;
  delete process.env.PRODUCTION_DELIVERY_ENABLED;
  await db.query(
    "truncate organizations,customers,market_cells,member_senders cascade",
  );
  await db.query(
    "insert into organizations(id,name,capabilities,is_demo) values('operator-org','Uptick','{operator}',false),('merchant','Sample store','{merchant}',true),('other','Second sample store','{merchant}',true),('real','Real store','{merchant}',false)",
  );
  await db.query(
    "insert into memberships(user_id,organization_id,role) values($1,'operator-org','operator'),('merchant-user','merchant','merchant')",
    [actor.id],
  );
  await db.query(
    "insert into market_cells(id,name,slug,state) values('market','Pilot','pilot','pilot')",
  );
  await db.query(
    "insert into market_zips(market_id,zip) values('market','10583')",
  );
  await db.query("insert into customers(id,phone) values('customer',$1)", [
    phone,
  ]);
  await db.query(
    "insert into uptick_members(id,customer_id,home_zip,market_id) values('member','customer','10583','market')",
  );
});
function staging() {
  process.env.UPTICK_ENV = "staging";
  process.env.UPTICK_LOCAL_MODE = "false";
  process.env.APP_URL = "https://pilot.uptick.example";
  process.env.SMS_TRANSPORT = "twilio";
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
  process.env.TWILIO_AUTH_TOKEN = "test-token";
}
async function access(purpose: "access" | "drop" = "access") {
  const accessId = id(),
    credential = token();
  await db.query(
    "insert into member_access(id,member_id,token_hash,token_encrypted,purpose,expires_at,disclosure,home_zip) values($1,'member',$2,$3,$4,now()+interval '2 days','Test disclosure','10583')",
    [accessId, hash(credential), encrypt(credential), purpose],
  );
  return accessId;
}
async function active() {
  await db.query(
    "update uptick_members set state='active',verified_at=now() where id='member'",
  );
  await db.query(
    "insert into member_consents(id,member_id,accepted,disclosure_version,disclosure,source_ui) values($1,'member',true,'test','Test membership consent','test')",
    [id()],
  );
}
async function drop(quantity: number | null = null) {
  const zone = daytimeZone(),
    week = weekKey(new Date(), zone);
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
    "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,approved_by) values('supply','market','merchant','location','offer',1,'approved',now()-interval '1 day',now()+interval '7 days',$1,$2,'operator')",
    [quantity === null ? "unlimited" : "redemption", quantity],
  );
  await db.query(
    "insert into member_allocations(id,member_id,market_id,week_key) values('allocation','member','market',$1)",
    [week],
  );
  await db.query(
    "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values('allocation','supply','market',1,'{}')",
  );
  return {
    memberId: "member",
    accessId: await access("drop"),
    allocationId: "allocation",
    weekKey: week,
    timezone: zone,
  };
}
async function saved(messageId: string) {
  return (
    await db.query<MemberMessage>("select * from member_messages where id=$1", [
      messageId,
    ])
  )[0];
}

test("environment configuration fails closed and preview deployments cannot become production through one flag", () => {
  assert.equal(uptickEnvironment(), "development");
  assert.equal(simulatedTransport(), true);
  process.env.SMS_TRANSPORT = "twilio";
  assert.match(smsEnvironmentBlock(phone)!, /Development never/);
  process.env.UPTICK_ENV = "prodution";
  assert.equal(uptickEnvironment(), null);
  assert.ok(smsEnvironmentBlock(phone));
  process.env.UPTICK_ENV = "production";
  assert.match(smsEnvironmentBlock(phone)!, /not explicitly enabled/);
  process.env.PRODUCTION_DELIVERY_ENABLED = "true";
  assert.equal(smsEnvironmentBlock(phone), null);
  process.env.VERCEL_ENV = "preview";
  assert.equal(uptickEnvironment(), null);
  process.env.UPTICK_ENV = "staging";
  assert.equal(localMode(), false);
  assert.equal(smsEnvironmentBlock(phone), null);
  assert.match(smsEnvironmentBlock("+12015550124")!, /allowlisted/);
  process.env.INTERNAL_TEST_NUMBERS = `${phone},malformed`;
  assert.match(smsEnvironmentBlock(phone)!, /allowlisted/);
});
test("a requested access message needs no recurring consent and stays visibly simulated in development", async () => {
  const accessId = await access();
  const message = await queueMemberAccess(db, accessId);
  assert.equal((await queueMemberAccess(db, accessId)).id, message.id);
  let called = false;
  assert.equal(
    await dispatchMemberMessages(db, 20, async () => {
      called = true;
      return { sid: providerSid };
    }),
    1,
  );
  assert.equal(called, false);
  assert.equal((await saved(message.id)).state, "development");
  assert.equal((await db.query("select * from member_consents")).length, 0);
  assert.equal((await db.query("select * from subscriptions")).length, 0);
});
test("pending membership cannot receive recurring Drops and access credentials cannot be reused as unsolicited login messages", async () => {
  const input = await drop();
  await assert.rejects(
    queueMemberDrop(db, input),
    /verified membership consent/,
  );
  await assert.rejects(
    queueMemberAccess(db, input.accessId),
    /matching member access/,
  );
  await active();
  const message = await queueMemberDrop(db, input);
  assert.equal(message.purpose, "drop");
  await assert.rejects(
    queueMemberDrop(db, {
      ...input,
      memberId: "someone-else",
      accessId: await access("drop"),
    }),
    /verified membership consent/,
  );
});
test("one recurring message per member and week survives concurrent queue requests", async () => {
  await active();
  const input = await drop();
  const second = { ...input, accessId: await access("drop") };
  const messages = await Promise.all([
    queueMemberDrop(db, input),
    queueMemberDrop(db, input),
    queueMemberDrop(db, second),
  ]);
  assert.ok(messages.every((message) => message.id === messages[0].id));
  assert.equal((await db.query("select * from member_messages")).length, 1);
});
test("dispatch rechecks latest explicit consent in deterministic event order", async () => {
  await active();
  const message = await queueMemberDrop(db, await drop());
  await db.transaction(async (tx) => {
    await tx.query(
      "insert into member_consents(id,member_id,accepted,disclosure_version,disclosure,source_ui) values('zz-later-sorting','member',true,'test','Accepted','test')",
    );
    await tx.query(
      "insert into member_consents(id,member_id,accepted,disclosure_version,disclosure,source_ui) values('aa-earlier-sorting','member',false,'test','Declined','test')",
    );
  });
  assert.match(
    (await memberMessageEligibility(db, message))!,
    /No current verified/,
  );
  await dispatchMemberMessages(db);
  assert.equal((await saved(message.id)).state, "suppressed");
});
test("a queued backed weekly promise survives a later market pause", async () => {
  await active();
  const message = await queueMemberDrop(db, await drop());
  assert.equal(await memberMessageEligibility(db, message), null);
  await db.query("update market_cells set state='paused' where id='market'");
  assert.equal(await memberMessageEligibility(db, message), null);
});
test("queued backed weekly messages are not hidden by later eligibility changes", async () => {
  await active();
  const message = await queueMemberDrop(db, await drop());
  assert.equal(await memberMessageEligibility(db, message), null);
  await db.query("update market_locations set active=false");
  assert.equal(await memberMessageEligibility(db, message), null);
  await db.query("update market_locations set active=true");
  await db.query(
    "update uptick_members set home_zip='99999' where id='member'",
  );
  assert.equal(await memberMessageEligibility(db, message), null);
  await db.query(
    "update uptick_members set home_zip='10583' where id='member'",
  );
  assert.equal(await memberMessageEligibility(db, message), null);
  await db.query(
    "insert into claims(id,customer_id,organization_id,offer_id,offer_version,token_hash,token_encrypted,snapshot) values('prior-offer','customer','merchant','offer',1,'prior-fixture-hash','prior-fixture-credential','{}')",
  );
  assert.equal(await memberMessageEligibility(db, message), null);
  await dispatchMemberMessages(db);
  assert.equal((await saved(message.id)).state, "development");
});
test("a queued backed weekly message stays visible after unreserved supply is exhausted", async () => {
  await active();
  const message = await queueMemberDrop(db, await drop(1));
  assert.equal(await memberMessageEligibility(db, message), null);
  const other = await requestMemberAccess(db, {
    phone: "+12015550124",
    homeZip: "10583",
    consentRequested: true,
  });
  await confirmMemberAccess(db, other.credential, true);
  await allocateMember(db, other.member.id);
  const pass = await claimMemberDrop(db, other.credential, "supply");
  const point = await createRedemptionPoint(db, actor, {
    organizationId: "merchant",
    locationId: "location",
    name: "Counter",
    exposure: "staff",
  });
  await redeemAtPoint(db, decrypt(pass.token_encrypted), {
    pointToken: point.credential.public_token,
  });
  assert.equal(await memberMessageEligibility(db, message), null);
  await dispatchMemberMessages(db);
  assert.equal((await saved(message.id)).state, "development");
});
test("staging cannot send to a number removed from its allowlist after queueing", async () => {
  staging();
  await configureMemberSender(db, actor, {
    serviceSid,
    phone: "+12015550199",
    approved: true,
  });
  const message = await queueMemberAccess(db, await access());
  process.env.INTERNAL_TEST_NUMBERS = "+12015550124";
  let called = false;
  await dispatchMemberMessages(db, 20, async () => {
    called = true;
    return { sid: providerSid };
  });
  assert.equal(called, false);
  assert.equal((await saved(message.id)).state, "suppressed");
  assert.match((await saved(message.id)).suppression_reason!, /allowlisted/);
});
test("provider work commits before delivery, uncertain outcomes are never retried, and callbacks only move forward", async () => {
  staging();
  await configureMemberSender(db, actor, {
    serviceSid,
    phone: "+12015550199",
    approved: true,
  });
  const message = await queueMemberAccess(db, await access());
  let calls = 0;
  await dispatchMemberMessages(db, 20, async (payload) => {
    calls++;
    assert.equal((await saved(message.id)).state, "submitting");
    assert.equal(payload.to, phone);
    assert.match(payload.body, /Uptick Local: Your requested secure access/);
    throw Error("network lost");
  });
  assert.equal((await saved(message.id)).state, "unknown");
  await dispatchMemberMessages(db, 20, async () => {
    calls++;
    return { sid: providerSid };
  });
  assert.equal(calls, 1);
  await memberMessageStatus(db, message.id, providerSid, "delivered");
  await memberMessageStatus(db, message.id, providerSid, "sent");
  await memberMessageStatus(db, message.id, providerSid, "delivered");
  assert.equal((await saved(message.id)).state, "delivered");
  assert.equal(
    (await db.query("select * from member_message_events")).length,
    2,
  );
  await assert.rejects(
    memberMessageStatus(db, message.id, `SM${"d".repeat(32)}`, "delivered"),
    /Unknown/,
  );
});
test("STOP suppresses queued promotion program-wide without pausing membership; START does not restore consent", async () => {
  staging();
  const sender = await configureMemberSender(db, actor, {
    serviceSid,
    phone: "+12015550199",
    approved: true,
  });
  await active();
  await db.query(
    "insert into subscriptions(customer_id,scope,organization_id,state) values('customer','merchant','merchant','subscribed')",
  );
  const message = await queueMemberDrop(db, await drop());
  const fields = {
    MessageSid: providerSid,
    From: phone,
    MessagingServiceSid: serviceSid,
    OptOutType: "STOP",
  };
  await memberInbound(db, fields);
  await memberInbound(db, fields);
  assert.equal(
    (await db.query<{ state: string }>("select state from uptick_members"))[0]
      .state,
    "active",
  );
  assert.equal((await saved(message.id)).state, "suppressed");
  assert.equal(
    (await db.query<{ state: string }>("select state from subscriptions"))[0]
      .state,
    "subscribed",
  );
  assert.equal(
    (await db.query("select * from member_consents where accepted=false"))
      .length,
    1,
  );
  await memberInbound(db, {
    ...fields,
    MessageSid: `SM${"e".repeat(32)}`,
    OptOutType: "START",
  });
  assert.equal(
    (
      await db.query<{ suppressed: boolean }>(
        "select suppressed from member_suppressions where sender_id=$1",
        [sender.id],
      )
    )[0].suppressed,
    false,
  );
  assert.equal(
    (
      await db.query<{ suppressed: boolean }>(
        "select suppressed from member_global_suppressions where phone=$1",
        [phone],
      )
    )[0].suppressed,
    false,
  );
  assert.equal(
    (await db.query<{ state: string }>("select state from uptick_members"))[0]
      .state,
    "active",
  );
});

test("HELP and free text create an encrypted contextual support queue with useful replies", async () => {
  staging();
  await configureMemberSender(db, actor, {
    serviceSid,
    phone: "+12015550199",
    approved: true,
  });
  await active();
  await drop();
  process.env.SUPPORT_EMAIL = "help@uptick.example";
  const help = await memberInbound(db, {
    MessageSid: providerSid,
    From: phone,
    MessagingServiceSid: serviceSid,
    Body: "HELP",
  });
  assert.equal(help.action, "HELP");
  assert.match(help.reply, /help@uptick\.example/);
  const note = "The cashier could not find my free coffee";
  const other = await memberInbound(db, {
    MessageSid: `SM${"d".repeat(32)}`,
    From: phone,
    MessagingServiceSid: serviceSid,
    Body: note,
  });
  assert.equal(other.action, "OTHER");
  assert.match(other.reply, /support person/);
  const requests = await db.query<{
    phone_encrypted: string;
    body_encrypted: string;
    context: { allocationId: string | null };
  }>(
    "select phone_encrypted,body_encrypted,context from member_support_requests order by created_at",
  );
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.phone_encrypted !== phone));
  assert.ok(requests.every((request) => request.body_encrypted !== note));
  assert.ok(requests.every((request) => request.context.allocationId));
});
test("membership sender cannot borrow a merchant program and queue context is immutable", async () => {
  await db.query(
    "insert into senders(id,organization_id,service_sid,phone,approved) values('merchant-sender','merchant',$1,'+12015550199',true)",
    [serviceSid],
  );
  await assert.rejects(
    configureMemberSender(db, actor, {
      serviceSid,
      phone: "+12015550199",
      approved: true,
    }),
    /dedicated/,
  );
  await assert.rejects(
    configureMemberSender(
      db,
      { ...actor, role: "merchant" },
      { serviceSid, phone: "+12015550199", approved: true },
    ),
    /access/,
  );
  const message = await queueMemberAccess(db, await access());
  await assert.rejects(
    db.query(
      "update member_messages set environment='production' where id=$1",
      [message.id],
    ),
    /immutable/,
  );
});
test("membership webhook signature includes canonical path, query and actual account", async () => {
  staging();
  const fields = {
    AccountSid: process.env.TWILIO_ACCOUNT_SID!,
    MessageSid: providerSid,
    MessageStatus: "delivered",
  };
  const url = `${process.env.APP_URL}/api/member-twilio/status?message=example`;
  const signature = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN!,
    url,
    fields,
  );
  const request = (sig: string, account = fields.AccountSid) =>
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-twilio-signature": sig,
      },
      body: new URLSearchParams({ ...fields, AccountSid: account }),
    });
  assert.equal(
    (await verifyMemberWebhook(request(signature), "status")).messageId,
    "example",
  );
  await assert.rejects(
    verifyMemberWebhook(request("invalid"), "status"),
    /signature/,
  );
  await assert.rejects(
    verifyMemberWebhook(request(signature, `AC${"f".repeat(32)}`), "status"),
    /signature/,
  );
});
test("protected staging personas require both explicit tester access and current operator membership", async () => {
  staging();
  assert.equal(await pilotPrincipal(db, actor.id), null);
  process.env.STAGING_TEST_USER_IDS = actor.id;
  assert.equal((await pilotPrincipal(db, actor.id))?.role, "operator");
  assert.equal(
    (await pilotPersona(db, actor.id, "merchant"))?.role,
    "merchant",
  );
  assert.equal(
    (await pilotPersona(db, actor.id, "other"))?.organizationId,
    "other",
  );
  assert.equal(await pilotPersona(db, actor.id, "real"), null);
  process.env.STAGING_TEST_USER_IDS = `${actor.id},merchant-user`;
  assert.equal(await pilotPersona(db, "merchant-user", "other"), null);
  await db.query("delete from memberships where user_id=$1", [actor.id]);
  assert.equal(await pilotPersona(db, actor.id, "merchant"), null);
  process.env.UPTICK_ENV = "production";
  assert.equal(await pilotPrincipal(db, actor.id), null);
});
