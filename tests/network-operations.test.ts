import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import {
  saveMarket,
  saveMarketLocation,
  savePartner,
  saveAcquisitionSource,
  saveSupply,
  approveSupply,
  adjustSupply,
  pauseSupply,
  resumeSupply,
  allocateMarket,
  networkOperations,
} from "../src/lib/network-operations";
import {
  requestMemberAccess,
  confirmMemberAccess,
  claimMemberDrop,
  supplyUsage,
} from "../src/lib/network";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
const operator: Actor = {
  id: "operator",
  organizationId: "merchant",
  role: "operator",
};
const merchant: Actor = {
  id: "merchant-user",
  organizationId: "merchant",
  role: "merchant",
};
let db: DB, marketId: string;
const marketInput = {
  name: "River market",
  slug: "river-market",
  timezone: "America/New_York",
  state: "pilot",
  boundaryNote: "A walkable corridor and nearby morning commuter destinations.",
  zips: "10583, 10583, 10530",
  latitude: "",
  longitude: "",
};
const supplyInput = () => ({
  marketId,
  offerId: "drop",
  inventoryPolicy: "claim",
  quantity: 2,
  reservationMinutes: "",
  verificationMode: "staff_tap",
  selfConfirmApproved: false,
  staffInstructions:
    "Check the customer's pass and give one large coffee at the counter.",
  fallbackPlan: "Ask the shift manager to use the staffed backup point.",
  fundingSource: "merchant",
  shareable: true,
  referralCap: 3,
  growthFee: "",
  spendCap: "",
  submit: true,
});
before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db.close?.();
});
beforeEach(async () => {
  await db.query(
    "truncate market_cells,acquisition_partners,organizations,customers,rate_limits cascade",
  );
  await db.query(
    "insert into organizations(id,name) values('merchant','River Fuel'),('second','Southside Fuel')",
  );
  await db.query(
    "insert into locations(id,organization_id,name,address) values('location','merchant','Main store','1 Main Street'),('second-location','second','South store','2 Main Street')",
  );
  marketId = await saveMarket(db, operator, marketInput);
  await saveMarketLocation(db, operator, {
    marketId,
    locationId: "location",
    postalCode: "10583",
    driveMinutes: 5,
    active: true,
    latitude: 40.99,
    longitude: -73.79,
  });
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values('drop','merchant','location','drop','review','Morning coffee')",
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values('drop',1,'Visit the store','Free large coffee','One per Uptick member',now()-interval '1 day',now()+interval '30 days')",
  );
});

test("network operations refuse merchant access before reading or mutating network records", async () => {
  await assert.rejects(() => networkOperations(db, merchant), /access/);
  await assert.rejects(() => saveMarket(db, merchant, marketInput), /access/);
  await assert.rejects(() => saveSupply(db, merchant, supplyInput()), /access/);
  await assert.rejects(() => allocateMarket(db, merchant, marketId), /access/);
  assert.equal((await db.query("select id from market_cells")).length, 1);
  assert.equal(
    (await db.query("select id from network_drop_supplies")).length,
    0,
  );
});

test("Market Cells preserve useful geography with validated ZIPs, paired coordinates and audited edits", async () => {
  const before = await networkOperations(db, operator, marketId);
  assert.deepEqual(before.market?.zips, ["10530", "10583"]);
  await assert.rejects(
    () =>
      saveMarket(db, operator, {
        ...marketInput,
        id: marketId,
        latitude: 40,
        longitude: "",
      }),
    /both latitude/,
  );
  await assert.rejects(
    () =>
      saveMarket(db, operator, { ...marketInput, id: marketId, zips: "123" }),
    /ZIP|small/,
  );
  await saveMarket(db, operator, {
    ...marketInput,
    id: marketId,
    zips: "10583",
    state: "building",
  });
  const after = await networkOperations(db, operator, marketId);
  assert.deepEqual(after.market?.zips, ["10583"]);
  assert.equal(after.market?.state, "building");
  assert.equal(
    after.locations.find((location) => location.id === "location")?.active,
    true,
  );
  assert.equal(
    (
      await db.query(
        "select id from audit_events where action='market_updated'",
      )
    ).length,
    1,
  );
});

test("partner links preserve source market attribution and distinguish unknown cost from zero", async () => {
  const partnerId = await savePartner(db, operator, {
    marketId,
    name: "River House",
    kind: "apartment",
    state: "active",
    agreementNote: "Resident email benefit, no fee agreed.",
    address: "8 River Street",
    latitude: "",
    longitude: "",
  });
  const sourceId = await saveAcquisitionSource(db, operator, {
    marketId,
    partnerId,
    name: "Resident email",
    channel: "partner-email",
    campaign: "Founding members",
    cost: "",
    state: "active",
  });
  let data = await networkOperations(db, operator, marketId);
  assert.equal(data.sources[0].cost, null);
  await saveAcquisitionSource(db, operator, {
    id: sourceId,
    marketId,
    partnerId,
    name: "Resident email",
    channel: "partner-email",
    campaign: "Founding members",
    cost: 0,
    state: "paused",
  });
  data = await networkOperations(db, operator, marketId);
  assert.equal(Number(data.sources[0].cost), 0);
  assert.equal(data.sources[0].state, "paused");
  await assert.rejects(
    () =>
      saveAcquisitionSource(db, operator, {
        id: sourceId,
        marketId,
        partnerId: "",
        name: "Different origin",
        channel: "screen",
        campaign: "No silent re-attribution",
        cost: 0,
        state: "active",
      }),
    /original market and partner/,
  );
  const far = await saveMarket(db, operator, {
    ...marketInput,
    name: "Far market",
    slug: "far-market",
    zips: "10001",
  });
  await assert.rejects(
    () =>
      saveAcquisitionSource(db, operator, {
        marketId: far,
        partnerId,
        name: "Cross market",
        channel: "screen",
        campaign: "Invalid source linkage",
        cost: 0,
        state: "active",
      }),
    /foreign key/,
  );
});

test("approved Drop supply pins a saved version, records approval evidence and forbids later promise edits", async () => {
  const supplyId = await saveSupply(db, operator, supplyInput());
  await approveSupply(db, operator, supplyId);
  const data = await networkOperations(db, operator, marketId);
  assert.equal(data.supplies[0].state, "approved");
  assert.equal(data.supplies[0].offer_version, 1);
  const [approval] = await db.query<{
    detail: { offerVersion: number; quantity: number };
  }>("select detail from audit_events where action='network_supply_approved'");
  assert.equal(approval.detail.offerVersion, 1);
  assert.equal(approval.detail.quantity, 2);
  await assert.rejects(
    () =>
      saveSupply(db, operator, {
        ...supplyInput(),
        id: supplyId,
        quantity: 99,
      }),
    /fixed/,
  );
  await assert.rejects(
    () =>
      db.query(
        "update network_drop_supplies set staff_instructions='Different promise' where id=$1",
        [supplyId],
      ),
    /immutable/,
  );
  await pauseSupply(db, operator, {
    supplyId,
    reason: "The merchant asked to pause new allocations.",
  });
  assert.equal(
    (await networkOperations(db, operator, marketId)).supplies[0].state,
    "paused",
  );
  await resumeSupply(db, operator, {
    supplyId,
    reason: "The merchant confirmed the original offer can resume.",
  });
  assert.equal(
    (await networkOperations(db, operator, marketId)).supplies[0].state,
    "approved",
  );
});

test("approval requires explicit weak-verification approval and a fallback for public Tap", async () => {
  const supplyId = await saveSupply(db, operator, {
    ...supplyInput(),
    verificationMode: "self_confirm",
  });
  await assert.rejects(
    () => approveSupply(db, operator, supplyId),
    /self-confirmation/,
  );
  await saveSupply(db, operator, {
    ...supplyInput(),
    id: supplyId,
    verificationMode: "public_tap",
    fallbackPlan: "",
  });
  await assert.rejects(() => approveSupply(db, operator, supplyId), /fallback/);
  await saveSupply(db, operator, {
    ...supplyInput(),
    id: supplyId,
    verificationMode: "self_confirm",
    selfConfirmApproved: true,
  });
  await approveSupply(db, operator, supplyId);
});

test("legacy broadcast offers cannot also become member-allocation supply", async () => {
  await db.query(
    "insert into broadcasts(id,offer_id,organization_id,scheduled_at,week_key,approved_by) values('legacy','drop','merchant',now()+interval '1 day','2026-09-07','operator')",
  );
  await assert.rejects(
    () => saveSupply(db, operator, supplyInput()),
    /legacy campaign/,
  );
  assert.equal(
    (await db.query("select id from network_drop_supplies")).length,
    0,
  );
});

test("finite reward spend guards are enforceable at approval and later inventory adjustments", async () => {
  const supplyId = await saveSupply(db, operator, {
    ...supplyInput(),
    quantity: 10,
    spendCap: 5,
  });
  await assert.rejects(
    () => approveSupply(db, operator, supplyId),
    /per-item reward cost/,
  );
  await db.query(
    "insert into offer_product_metadata(offer_id,version,goal,reward_cost) values('drop',1,'morning',0.75)",
  );
  await assert.rejects(() => approveSupply(db, operator, supplyId), /exceed/);
  await saveSupply(db, operator, {
    ...supplyInput(),
    id: supplyId,
    quantity: 5,
    spendCap: 5,
  });
  await approveSupply(db, operator, supplyId);
  await adjustSupply(db, operator, {
    supplyId,
    delta: 1,
    reason: "One more coffee available within the guardrail.",
  });
  assert.equal((await supplyUsage(db, supplyId)).quantity, 6);
  await assert.rejects(
    () =>
      adjustSupply(db, operator, {
        supplyId,
        delta: 1,
        reason: "One more would exceed the agreed guardrail.",
      }),
    /exceed/,
  );
});

test("inventory adjustments cannot erase reservations and aggregate views expose no member phone data", async () => {
  const supplyId = await saveSupply(db, operator, supplyInput());
  await approveSupply(db, operator, supplyId);
  const joined = await requestMemberAccess(db, {
    phone: "+12125550121",
    homeZip: "10583",
    consentRequested: true,
  });
  await confirmMemberAccess(db, joined.credential, true);
  const allocation = await allocateMarket(db, operator, marketId);
  assert.equal(allocation.allocated, 1);
  await claimMemberDrop(db, joined.credential, supplyId);
  await adjustSupply(db, operator, {
    supplyId,
    delta: -1,
    reason: "Remove the one unreserved extra item.",
  });
  assert.equal((await supplyUsage(db, supplyId)).remaining, 0);
  await assert.rejects(
    () =>
      adjustSupply(db, operator, {
        supplyId,
        delta: -1,
        reason: "This would remove a member's reserved item.",
      }),
    /reservations/,
  );
  const data = await networkOperations(db, operator, marketId);
  assert.equal(data.members.permissioned, 1);
  assert.equal(data.members.claimed, 1);
  assert.equal(data.members.redeemed, 0);
  assert.equal(JSON.stringify(data).includes("+12125550121"), false);
  assert.equal(JSON.stringify(data).includes(joined.credential), false);
  assert.equal(data.coverage.length, 5);
});
