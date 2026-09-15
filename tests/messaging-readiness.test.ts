import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb } from "../src/lib/db";
import { memberInbound } from "../src/lib/member-messaging";

const memberPhone = "+12015550123";
const serviceSid = `MG${"a".repeat(32)}`;
const senderPhone = "+12015550199";

async function messagingDb() {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  process.env.SUPPORT_EMAIL = "help@uptick.example";
  delete process.env.VERCEL;

  const db = await memoryDb();
  await db.query(
    "insert into member_senders(id,service_sid,phone,approved) values('membership-sender',$1,$2,true)",
    [serviceSid, senderPhone],
  );
  await db.query("insert into customers(id,phone) values('customer',$1)", [
    memberPhone,
  ]);
  await db.query(
    "insert into uptick_members(id,customer_id,home_zip,state,verified_at,age_confirmed_at) values('member','customer','10583','active',now(),now())",
  );
  return db;
}

test("provider-managed HELP and STOP are recorded once without a second application reply", async () => {
  const db = await messagingDb();
  try {
    const helpFields = {
      MessageSid: `SM${"b".repeat(32)}`,
      From: memberPhone,
      MessagingServiceSid: serviceSid,
      OptOutType: "HELP",
      Body: "HELP",
    };
    const help = await memberInbound(db, helpFields);
    const duplicateHelp = await memberInbound(db, helpFields);
    assert.equal(help.action, "HELP");
    assert.equal(help.shouldReply, false);
    assert.equal(duplicateHelp.shouldReply, false);
    assert.equal(
      (
        await db.query(
          "select id from member_support_requests where provider_sid=$1",
          [helpFields.MessageSid],
        )
      ).length,
      1,
    );

    const stopFields = {
      MessageSid: `SM${"c".repeat(32)}`,
      From: memberPhone,
      MessagingServiceSid: serviceSid,
      OptOutType: "STOP",
      Body: "STOP",
    };
    const stop = await memberInbound(db, stopFields);
    const duplicateStop = await memberInbound(db, stopFields);
    assert.equal(stop.action, "STOP");
    assert.equal(stop.shouldReply, false);
    assert.equal(duplicateStop.shouldReply, false);
    assert.equal(
      (
        await db.query(
          "select id from member_consents where member_id='member' and consent_action='stop'",
        )
      ).length,
      1,
    );
  } finally {
    await db.close?.();
  }
});

test("the application HELP fallback sends people to the public SMS help page", async () => {
  const db = await messagingDb();
  try {
    const help = await memberInbound(db, {
      MessageSid: `SM${"d".repeat(32)}`,
      From: memberPhone,
      MessagingServiceSid: serviceSid,
      Body: "HELP",
    });
    assert.equal(help.shouldReply, true);
    assert.match(help.reply, /http:\/\/localhost:3000\/sms(?:\s|$)/);
    assert.match(help.reply, /help@uptick\.example/);
  } finally {
    await db.close?.();
  }
});

test("an ordinary support acknowledgement includes the STOP instruction", async () => {
  const db = await messagingDb();
  try {
    const support = await memberInbound(db, {
      MessageSid: `SM${"e".repeat(32)}`,
      From: memberPhone,
      MessagingServiceSid: serviceSid,
      Body: "The cashier could not find my Uptick",
    });
    assert.equal(support.action, "OTHER");
    assert.equal(support.shouldReply, true);
    assert.match(support.reply, /Reply STOP to stop texts\./);
  } finally {
    await db.close?.();
  }
});
