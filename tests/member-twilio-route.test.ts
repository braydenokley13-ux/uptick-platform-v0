import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import twilio from "twilio";
import { POST } from "../src/app/api/member-twilio/[kind]/route";
import { getDb, type DB } from "../src/lib/db";

let db: DB;
let storageRoot: string;
const accountSid = `AC${"a".repeat(32)}`;
const serviceSid = `MG${"b".repeat(32)}`;
const messageSid = `SM${"c".repeat(32)}`;
const url = "http://localhost:3000/api/member-twilio/inbound";

before(async () => {
  storageRoot = await mkdtemp("/tmp/uptick-member-callback-route.");
  process.env.LOCAL_DATABASE_PATH = join(storageRoot, "database");
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  process.env.TWILIO_ACCOUNT_SID = accountSid;
  process.env.TWILIO_AUTH_TOKEN = "callback-route-test-token";
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.DATABASE_URL;
  db = await getDb();
  await db.query(
    "insert into member_senders(id,service_sid,phone,approved) values('route-sender',$1,'+12015550199',true)",
    [serviceSid],
  );
  await db.query(
    `create function reject_callback_health_write() returns trigger
     language plpgsql as $$ begin raise exception 'synthetic health outage'; end $$`,
  );
  await db.query(
    `create trigger reject_callback_health_write before insert or update
     on member_callback_health for each row execute function reject_callback_health_write()`,
  );
});

after(async () => {
  await db.close?.();
  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.LOCAL_DATABASE_PATH;
});

function request(signature: string) {
  const fields = {
    AccountSid: accountSid,
    MessageSid: messageSid,
    MessagingServiceSid: serviceSid,
    From: "+12015550123",
    Body: "HELP",
  };
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body: new URLSearchParams(fields),
  });
}

test("invalid signatures do not create callback health failures", async () => {
  const response = await POST(request("invalid"), {
    params: Promise.resolve({ kind: "inbound" }),
  });
  assert.equal(response.status, 403);
  assert.equal(
    (await db.query("select * from member_callback_health")).length,
    0,
  );
  assert.equal(
    (await db.query("select * from member_inbound_events")).length,
    0,
  );
});

test("a callback health write outage does not change a successful provider acknowledgement", async () => {
  const fields = Object.fromEntries(
    new URLSearchParams(await request("placeholder").text()),
  );
  const signature = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN!,
    url,
    fields,
  );
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => logged.push(values);
  try {
    const response = await POST(request(signature), {
      params: Promise.resolve({ kind: "inbound" }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<Response>/);
  } finally {
    console.error = originalError;
  }
  assert.equal(
    (await db.query("select * from member_inbound_events")).length,
    1,
  );
  assert.equal(
    (await db.query("select * from member_callback_health")).length,
    0,
  );
  assert.deepEqual(logged, [
    ["member_callback_health_write_failed", { kind: "inbound" }],
  ]);
  assert.ok(!JSON.stringify(logged).includes("+12015550123"));
  assert.ok(!JSON.stringify(logged).includes(messageSid));
});
