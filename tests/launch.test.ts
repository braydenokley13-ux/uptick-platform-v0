import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import { acceptClaim, approve, type Actor } from "../src/lib/domain";
import { businessReadiness, platformReadiness } from "../src/lib/launch";

let db: DB;
const operator: Actor = {
  id: "operator",
  role: "operator",
  organizationId: "merchant",
};
before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db.close?.();
});
beforeEach(async () => {
  process.env.UPTICK_ENV = "production";
  process.env.PRODUCTION_DELIVERY_ENABLED = "true";
  process.env.UPTICK_LOCAL_MODE = "false";
  process.env.APP_URL = "https://uptick.example";
  process.env.DATABASE_URL = "postgresql://test:test@unused.invalid/test";
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-only";
  process.env.SESSION_SECRET = "s".repeat(64);
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.CRON_SECRET = "c".repeat(64);
  process.env.SMS_TRANSPORT = "twilio";
  process.env.MESSAGING_APPROVED = "true";
  process.env.LEGAL_APPROVED = "true";
  process.env.TWILIO_ACCOUNT_SID = `AC${"a".repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = "test-only";
  process.env.SUPPORT_EMAIL = "support@uptick.example";
  process.env.BUSINESS_LEGAL_NAME = "Test Uptick";
  await db.query("truncate organizations cascade");
  await db.query("truncate rate_limits");
  await db.query(
    "insert into organizations(id,name) values('merchant','Test merchant')",
  );
  await db.query(
    "insert into locations(id,organization_id,name,address) values('location','merchant','Main','123 Test Street')",
  );
  await db.query(
    "insert into senders(id,organization_id,service_sid,phone,approved) values('sender','merchant',$1,'+12125550901',true)",
    [`MG${"b".repeat(32)}`],
  );
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values('offer','merchant','location','anchor','live','Coffee')",
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values('offer',1,'Buy breakfast','Get a free coffee','One per customer',now()-interval '1 day',now()+interval '10 days')",
  );
  await db.query(
    "insert into sources(id,token,offer_id,campaign,creative) values('source','public-token','offer','Test','Test')",
  );
});
const claim = () =>
  acceptClaim(db, {
    sourceToken: "public-token",
    phone: "+12125550111",
    merchantConsent: false,
    networkConsent: false,
  });

test("production platform readiness rejects missing identity and reused secrets", () => {
  assert.equal(platformReadiness().ready, true);
  delete process.env.SUPPORT_EMAIL;
  assert.equal(platformReadiness().ready, false);
  process.env.SUPPORT_EMAIL = "support@uptick.example";
  process.env.SESSION_SECRET = process.env.PASS_ENCRYPTION_KEY;
  assert.equal(platformReadiness().ready, false);
});
test("incomplete production setup rejects a claim before saving any customer or entitlement", async () => {
  process.env.LEGAL_APPROVED = "false";
  await assert.rejects(claim(), /not ready to accept/);
  const [count] = await db.query<{ n: number }>(
    "select count(*)::int n from customers",
  );
  assert.equal(count.n, 0);
  const [claims] = await db.query<{ n: number }>(
    "select count(*)::int n from claims",
  );
  assert.equal(claims.n, 0);
});
test("sample or unapproved merchant senders cannot accept production claims", async () => {
  assert.equal(
    (await businessReadiness(db, "merchant")).readyToAcceptClaims,
    true,
  );
  await db.query("update senders set approved=false where id='sender'");
  await assert.rejects(claim(), /not ready to accept/);
  await db.query("update senders set approved=true where id='sender'");
  await db.query("update organizations set is_demo=true where id='merchant'");
  await assert.rejects(claim(), /not ready to accept/);
});
test("production approval and its immutable reviewed version commit together", async () => {
  await db.query("update offers set state='review' where id='offer'");
  const scheduledAt = new Date(Date.now() + 3600000).toISOString();
  process.env.MESSAGING_APPROVED = "false";
  await assert.rejects(
    approve(db, operator, "offer", scheduledAt),
    /Complete production/,
  );
  assert.equal((await db.query("select id from offer_reviews")).length, 0);
  process.env.MESSAGING_APPROVED = "true";
  await approve(db, operator, "offer", scheduledAt);
  const [review] = await db.query<{
    decision: string;
    offer_version: number;
    actor: string;
  }>("select decision,offer_version,actor from offer_reviews");
  assert.deepEqual(review, {
    decision: "approved",
    offer_version: 1,
    actor: "operator",
  });
  await assert.rejects(
    db.query("update offer_reviews set note='rewritten'"),
    /immutable/,
  );
});
test("explicit loopback development remains available without production credentials", async () => {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
  delete process.env.SUPPORT_EMAIL;
  const accepted = await claim();
  assert.equal(accepted.organization_id, "merchant");
});
