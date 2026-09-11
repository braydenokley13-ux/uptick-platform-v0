import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { memoryDb, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import {
  createInternalTest,
  getInternalTestPass,
  recordInternalTestPassAction,
  internalTestStatus,
  recentInternalTests,
  type InternalTestInput,
} from "../src/lib/internal-testing";
import {
  handleInternalTestRequest,
  handleInternalTestWebhook,
  verifyInternalTestWebhook,
} from "../src/lib/internal-testing-http";
import { overview } from "../src/lib/read-model";
import { apiError } from "../src/lib/http";
let db: DB;
const operator: Actor = {
  id: "operator",
  role: "operator",
  organizationId: "merchant",
};
const merchant: Actor = {
  id: "owner",
  role: "merchant",
  organizationId: "merchant",
};
const input: InternalTestInput = {
  organizationId: "merchant",
  offerId: "offer",
  phone: "+12015550123",
  kind: "anchor",
  requestKey: "internal-test-request-0001",
  confirmed: true,
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
  process.env.SMS_TRANSPORT = "development";
  process.env.INTERNAL_TEST_NUMBERS = "+12015550123,+12015550124";
  delete process.env.VERCEL;
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  await db.query("truncate organizations cascade");
  await db.query("truncate rate_limits");
  await db.query(
    "insert into organizations(id,name) values('merchant','Test merchant'),('other','Another merchant')",
  );
  await db.query(
    "insert into locations(id,organization_id,name,address) values('location','merchant','Main','123 Internal Test Street')",
  );
  await db.query(
    "insert into senders(id,organization_id,service_sid,phone,approved) values('sender','merchant',$1,'+12015550199',true)",
    [`MG${"b".repeat(32)}`],
  );
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values('offer','merchant','location','anchor','review','Fuel + coffee')",
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values('offer',1,'Buy $25 gas','Get a free coffee','One per customer',now()-interval '1 day',now()+interval '10 days')",
  );
});
function production() {
  process.env.UPTICK_ENV = "production";
  process.env.PRODUCTION_DELIVERY_ENABLED = "true";
  process.env.UPTICK_LOCAL_MODE = "false";
  process.env.APP_URL = "https://uptick.example";
  process.env.SMS_TRANSPORT = "twilio";
  process.env.DATABASE_URL = "postgresql://test@unused.invalid/test";
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-only";
  process.env.CRON_SECRET = "c".repeat(64);
  process.env.MESSAGING_APPROVED = "true";
  process.env.LEGAL_APPROVED = "true";
  process.env.SUPPORT_EMAIL = "support@uptick.example";
  process.env.BUSINESS_LEGAL_NAME = "Test Uptick";
  process.env.TWILIO_ACCOUNT_SID = `AC${"a".repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = "test-only-token";
}
const credential = (url: string) => url.split("/").pop()!;
test("internal test is isolated from all merchant production metrics and its snapshot stays frozen", async () => {
  const before = await overview(db, merchant);
  let called = false;
  const run = await createInternalTest(db, operator, input, async () => {
    called = true;
    throw Error("must not send");
  });
  assert.equal(called, false);
  assert.equal(run.state, "development");
  assert.equal(run.phoneSuffix, "0123");
  assert.match(run.passUrl, /^\/t\/[A-Za-z0-9_-]{43}$/);
  const pass = await getInternalTestPass(db, credential(run.passUrl));
  assert.equal(pass.opened_at, null);
  assert.equal(pass.snapshot.reward, "Get a free coffee");
  assert.equal(typeof pass.snapshot, "object");
  await recordInternalTestPassAction(db, credential(run.passUrl), "redeem");
  const after = await overview(db, merchant);
  assert.deepEqual(after.counts, before.counts);
  assert.deepEqual(after.audience, before.audience);
  for (const table of [
    "customers",
    "claims",
    "redemptions",
    "consent_events",
    "subscriptions",
    "broadcasts",
    "messages",
  ])
    assert.equal(
      (await db.query<{ n: number }>(`select count(*)::int n from ${table}`))[0]
        .n,
      0,
      table,
    );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values('offer',2,'Buy $30 gas','Get a free tea','New terms',now(),now()+interval '10 days')",
  );
  await db.query("update offers set current_version=2 where id='offer'");
  assert.equal(
    (await getInternalTestPass(db, credential(run.passUrl))).snapshot.reward,
    "Get a free coffee",
  );
  await assert.rejects(
    db.query("update internal_test_runs set snapshot=$2 where id=$1", [
      run.id,
      { reward: "changed" },
    ]),
    /immutable/,
  );
});
test("operator role, exact allowlist, selected merchant, kind, and explicit tester request are required", async () => {
  await assert.rejects(createInternalTest(db, merchant, input), /access/);
  await assert.rejects(
    createInternalTest(db, operator, { ...input, phone: "+12015550125" }),
    /not approved/,
  );
  await assert.rejects(
    createInternalTest(db, operator, { ...input, organizationId: "other" }),
    /selected merchant/,
  );
  await assert.rejects(
    createInternalTest(db, operator, { ...input, kind: "drop" }),
    /type matches/,
  );
  await assert.rejects(
    createInternalTest(db, operator, { ...input, confirmed: false as never }),
    /Confirm/,
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from internal_test_runs",
      )
    )[0].n,
    0,
  );
});
test("private test pass loading has no side effects and concurrent redemption records exactly once", async () => {
  const run = await createInternalTest(db, operator, input);
  const token = credential(run.passUrl);
  await Promise.all([
    getInternalTestPass(db, token),
    getInternalTestPass(db, token),
  ]);
  assert.equal((await getInternalTestPass(db, token)).opened_at, null);
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      recordInternalTestPassAction(db, token, "redeem"),
    ),
  );
  assert.ok(results.every((x) => x.redeemedAt));
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from internal_test_events where test_id=$1 and kind='redeemed'",
        [run.id],
      )
    )[0].n,
    1,
  );
  await assert.rejects(getInternalTestPass(db, "x".repeat(43)), /not valid/);
  await assert.rejects(getInternalTestPass(db, run.id), /not valid/);
});
test("saved request keys deduplicate sends and reject changed details even under a race", async () => {
  const runs = await Promise.all([
    createInternalTest(db, operator, input),
    createInternalTest(db, operator, input),
  ]);
  assert.equal(runs[0].id, runs[1].id);
  await assert.rejects(
    createInternalTest(db, operator, { ...input, phone: "+12015550124" }),
    /different details/,
  );
  const raced = await Promise.allSettled([
    createInternalTest(db, operator, {
      ...input,
      requestKey: "internal-test-request-race",
    }),
    createInternalTest(db, operator, {
      ...input,
      requestKey: "internal-test-request-race",
      phone: "+12015550124",
    }),
  ]);
  assert.equal(raced.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(raced.filter((x) => x.status === "rejected").length, 1);
});
test("live internal SMS preserves readiness gates, suppression, real sender identity, and no-retry behavior", async () => {
  production();
  let sends = 0;
  const send = async (details: {
    to: string;
    body: string;
    statusCallback: string;
    messagingServiceSid: string;
  }) => {
    sends++;
    assert.equal(details.to, input.phone);
    assert.match(details.body, /^INTERNAL TEST/);
    assert.match(details.body, /https:\/\/uptick.example\/t\//);
    assert.match(details.statusCallback, /api\/twilio-test\?test=/);
    return { sid: `SM${"c".repeat(32)}` };
  };
  process.env.LEGAL_APPROVED = "false";
  await assert.rejects(
    createInternalTest(db, operator, input, send),
    /readiness/,
  );
  assert.equal(sends, 0);
  process.env.LEGAL_APPROVED = "true";
  await db.query("update organizations set is_demo=true where id='merchant'");
  await assert.rejects(
    createInternalTest(db, operator, input, send),
    /readiness/,
  );
  assert.equal(sends, 0);
  await db.query("update organizations set is_demo=false where id='merchant'");
  await db.query(
    "insert into suppressions(phone,sender_id,suppressed) values($1,'sender',true)",
    [input.phone],
  );
  await assert.rejects(
    createInternalTest(db, operator, input, send),
    /stopped texts/,
  );
  assert.equal(sends, 0);
  await db.query("update suppressions set suppressed=false");
  const run = await createInternalTest(db, operator, input, send);
  assert.equal(run.state, "provider_accepted");
  await createInternalTest(db, operator, input, send);
  assert.equal(sends, 1);
  let uncertain = 0;
  const retry = { ...input, requestKey: "internal-test-request-unknown" };
  const failed = await createInternalTest(db, operator, retry, async () => {
    uncertain++;
    throw Error("provider timeout secret payload");
  });
  assert.equal(failed.state, "unknown");
  assert.equal(failed.errorCode, "provider_outcome_uncertain");
  await createInternalTest(db, operator, retry, async () => {
    uncertain++;
    throw Error("must not retry");
  });
  assert.equal(uncertain, 1);
});
test("internal callbacks are monotonic and duplicate-safe with immutable provider identity", async () => {
  production();
  const sid = `SM${"d".repeat(32)}`;
  const run = await createInternalTest(db, operator, input, async () => ({
    sid,
  }));
  await internalTestStatus(db, run.id, sid, "delivered");
  await internalTestStatus(db, run.id, sid, "sent");
  await internalTestStatus(db, run.id, sid, "delivered");
  const saved = (await recentInternalTests(db, operator))[0];
  assert.equal(saved.state, "delivered");
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from internal_test_events where test_id=$1 and kind='callback'",
        [run.id],
      )
    )[0].n,
    2,
  );
  await assert.rejects(
    internalTestStatus(db, run.id, `SM${"e".repeat(32)}`, "failed"),
    /Unknown/,
  );
});
test("testing HTTP boundaries require origin, login/role for creation, and only valid private capabilities for pass actions", async () => {
  const request = (body: unknown, origin = "http://localhost:3000") =>
    new Request("http://localhost:3000/api/testing", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await handleInternalTestRequest(
        request({ action: "create", ...input }, "https://other.example"),
        operator,
        db,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleInternalTestRequest(
        request({ action: "create", ...input }),
        null,
        db,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handleInternalTestRequest(
        request({ action: "create", ...input }),
        merchant,
        db,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleInternalTestRequest(
        request({ action: "redeem", token: "x".repeat(43) }),
        null,
        db,
      )
    ).status,
    404,
  );
  const run = await createInternalTest(db, operator, input);
  assert.equal(
    (
      await handleInternalTestRequest(
        request({ action: "redeem", token: credential(run.passUrl) }),
        null,
        db,
      )
    ).status,
    200,
  );
  const masked = await apiError(
    Error("database secret phone +12015550123"),
  ).text();
  assert.equal(masked.includes("12015550123"), false);
  assert.equal(masked.includes("database"), false);
});
test("test webhook authenticates the canonical URL, account, signature and status callback", async () => {
  production();
  const sid = `SM${"f".repeat(32)}`;
  const run = await createInternalTest(db, operator, input, async () => ({
    sid,
  }));
  const url = `https://uptick.example/api/twilio-test?test=${run.id}`;
  const fields = {
    AccountSid: process.env.TWILIO_ACCOUNT_SID!,
    MessageSid: sid,
    MessageStatus: "delivered",
  };
  const request = (values: Record<string, string>, signature: string) =>
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      body: new URLSearchParams(values),
    });
  await assert.rejects(
    verifyInternalTestWebhook(request(fields, "bad")),
    /signature/,
  );
  const wrong = { ...fields, AccountSid: `AC${"9".repeat(32)}` };
  await assert.rejects(
    verifyInternalTestWebhook(
      request(
        wrong,
        twilio.getExpectedTwilioSignature(
          process.env.TWILIO_AUTH_TOKEN!,
          url,
          wrong,
        ),
      ),
    ),
    /account/,
  );
  const signed = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN!,
    url,
    fields,
  );
  assert.equal(
    (await handleInternalTestWebhook(request(fields, signed), db)).status,
    200,
  );
  assert.equal((await recentInternalTests(db, operator))[0].state, "delivered");
});
