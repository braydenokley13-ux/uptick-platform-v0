import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import {
  approve,
  createEntitlement,
  offerSelect,
  pauseOffer,
  queueMessage,
  weekKey,
  type Actor,
  type Offer,
} from "../src/lib/domain";
import { operatorOverview, reviewDecision } from "../src/lib/operator";
import {
  dispatch,
  eligibility,
  expandDueBroadcasts,
  type Message,
} from "../src/lib/messaging";

process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
delete process.env.VERCEL;
const operator: Actor = {
  id: "operator",
  role: "operator",
  organizationId: "store",
};
let db: DB;
before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db.close?.();
});
beforeEach(async () => {
  await db.query("truncate organizations,customers,market_cells cascade");
  await db.query(
    "insert into organizations(id,name) values('store','Test store')",
  );
  await db.query(
    "insert into locations(id,organization_id,name,address) values('counter','store','Counter','Test address')",
  );
  await db.query(
    "insert into senders(id,organization_id) values('sender','store')",
  );
  await db.query(
    "insert into market_cells(id,name,slug,state) values('market','Test market','test-market','pilot')",
  );
  await db.query(
    "insert into market_locations(market_id,location_id,organization_id) values('market','counter','store')",
  );
  for (const id of ["network-offer", "legacy-offer"]) {
    await db.query(
      "insert into offers(id,organization_id,location_id,kind,state,title) values($1,'store','counter','drop','review',$1)",
      [id],
    );
    await db.query(
      "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values($1,1,'Visit the store','Free coffee','One per member',now()-interval '1 day',now()+interval '10 days')",
      [id],
    );
  }
  await db.query(
    "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy) values('supply','market','store','counter','network-offer',1,'review',now()-interval '1 day',now()+interval '10 days','unlimited')",
  );
});
async function networkClaim() {
  await db.query(
    "insert into customers(id,phone) values('person','+12015550148')",
  );
  const [offer] = await db.query<Offer>(
    `${offerSelect} where o.id='network-offer'`,
  );
  return createEntitlement(db, offer, "person", null, { network: true });
}
async function staleBroadcast() {
  await db.query(
    "insert into broadcasts(id,offer_id,organization_id,scheduled_at,week_key,approved_by) values('stale-broadcast','network-offer','store',now()-interval '1 minute',$1,'operator')",
    [weekKey(new Date(), "America/New_York")],
  );
}
test("legacy operator queues and schedules exclude network-owned offers while retaining legacy work", async () => {
  await staleBroadcast();
  const overview = await operatorOverview(db, operator);
  assert.deepEqual(
    overview.offers.map((offer) => offer.id),
    ["legacy-offer"],
  );
  assert.equal(overview.broadcasts.length, 0);
  await db.query(
    "update network_drop_supplies set state='approved',approved_by='operator'",
  );
  const approved = await operatorOverview(db, operator);
  assert.deepEqual(
    approved.offers.map((offer) => offer.id),
    ["legacy-offer"],
  );
});
test("network offers reject every legacy approval, pause, return and message-queue action", async () => {
  const claim = await networkClaim();
  await assert.rejects(
    approve(
      db,
      operator,
      "network-offer",
      new Date(Date.now() + 86400000).toISOString(),
    ),
    /Network control/,
  );
  await assert.rejects(
    pauseOffer(db, operator, "network-offer"),
    /Network control/,
  );
  await assert.rejects(
    reviewDecision(db, operator, {
      offerId: "network-offer",
      decision: "returned",
      note: "Use network approval",
    }),
    /Network control/,
  );
  await assert.rejects(queueMessage(db, claim, "merchant"), /Network control/);
  await assert.rejects(
    queueMessage(db, claim, "fulfillment"),
    /Network control/,
  );
  assert.equal((await db.query("select * from messages")).length, 0);
  assert.equal((await db.query("select * from broadcasts")).length, 0);
  assert.equal(
    (
      await db.query<{ state: string }>(
        "select state from offers where id='network-offer'",
      )
    )[0].state,
    "review",
  );
});
test("legacy workers quarantine stale network broadcasts and suppress already queued merchant messages", async () => {
  const claim = await networkClaim();
  await staleBroadcast();
  await db.query(
    "update offers set state='scheduled' where id='network-offer'",
  );
  assert.equal(await expandDueBroadcasts(db), 0);
  assert.equal(
    (
      await db.query<{ state: string }>(
        "select state from broadcasts where id='stale-broadcast'",
      )
    )[0].state,
    "paused",
  );
  assert.equal(
    (
      await db.query(
        "select * from audit_events where action='broadcast.network_boundary_blocked'",
      )
    ).length,
    1,
  );
  await db.query(
    "insert into messages(id,organization_id,customer_id,sender_id,claim_id,purpose) values('stale-message','store','person','sender',$1,'merchant')",
    [claim.id],
  );
  const [message] = await db.query<Message>(
    "select * from messages where id='stale-message'",
  );
  assert.equal(
    await eligibility(db, message),
    "Network Drop requires Uptick membership messaging",
  );
  await dispatch(db);
  const [result] = await db.query<Message>(
    "select * from messages where id='stale-message'",
  );
  assert.equal(result.state, "suppressed");
  assert.equal(result.provider_sid, null);
  assert.equal(
    result.suppression_reason,
    "Network Drop requires Uptick membership messaging",
  );
});
