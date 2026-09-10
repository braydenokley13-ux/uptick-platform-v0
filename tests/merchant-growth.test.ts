import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import { saveDraft, type Actor } from "../src/lib/domain";
import {
  allocateMember,
  claimMemberDrop,
  confirmMemberAccess,
  requestMemberAccess,
} from "../src/lib/network";
import { operatorOverride } from "../src/lib/tap";
import { decrypt } from "../src/lib/security";
import {
  merchantGrowth,
  requestGrowthSupply,
  saveGrowthPreferences,
} from "../src/lib/merchant-growth";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
delete process.env.VERCEL;
const merchant: Actor = {
  id: "merchant-a",
  role: "merchant",
  organizationId: "a",
};
let db: DB;
before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db?.close?.();
});
beforeEach(async () => {
  await db.query("truncate organizations,customers,rate_limits cascade");
  await db.query("truncate market_cells cascade");
  await db.query(
    "insert into market_cells(id,name,slug,state) values('market','Market','test','pilot')",
  );
  await db.query(
    "insert into market_zips(market_id,zip) values('market','10583')",
  );
  for (const org of ["a", "b"]) {
    await db.query("insert into organizations(id,name) values($1,$2)", [
      org,
      `Store ${org}`,
    ]);
    await db.query(
      "insert into locations(id,organization_id,name,address) values($1,$2,'Main','Test address')",
      [`${org}-location`, org],
    );
    await db.query(
      "insert into market_locations(market_id,location_id,organization_id) values('market',$1,$2)",
      [`${org}-location`, org],
    );
  }
});
const times = () => ({
  startsAt: new Date(Date.now() + 86400000).toISOString(),
  expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
});
async function offer(org = "a", offerId?: string) {
  return saveDraft(
    db,
    { ...merchant, organizationId: org },
    {
      id: offerId,
      organizationId: org,
      title: "Coffee Drop",
      qualification: "Buy a breakfast sandwich",
      reward: "Free large coffee",
      terms: "One per member at this store.",
      ...times(),
      limitMode: "redemption",
      quantity: 50,
      submit: false,
      productMetadata: {
        goal: "trial",
        templateId: "coffee",
        customerValue: 3,
        rewardCost: 0.5,
        requiredPurchase: 5,
        staffInstructions: "Check the receipt, then give one coffee.",
      },
    },
  );
}
const request = (offerId: string) => ({
  offerId,
  marketId: "market",
  ...times(),
  inventoryPolicy: "redemption",
  quantity: 50,
  reservationMinutes: null,
  verificationPreference: "staff_tap",
  staffInstructions: "Check the receipt, present Tap and wait for redeemed.",
  fallbackPlan: "Ask the manager to replenish the coffee.",
  rewardCost: 0.5,
  fixedFeeBudget: 100,
  rewardSpendCap: 25,
  submit: true,
});
test("merchant priorities are scoped, durable planning inputs and never billing actions", async () => {
  const input = {
    organizationId: "a",
    objective: "morning_traffic",
    objectiveNote: "More Thursday morning visits",
    fixedFeeBudget: 100,
    rewardSpendCap: 50,
    verificationPreference: "staff_tap",
  };
  await saveGrowthPreferences(db, merchant, input);
  await assert.rejects(
    saveGrowthPreferences(db, merchant, { ...input, organizationId: "b" }),
    /access/,
  );
  const result = await merchantGrowth(db, merchant);
  assert.equal(result.plan.objective, "morning_traffic");
  assert.equal(Number(result.plan.fixed_fee_budget), 100);
  assert.equal(
    (await db.query("select * from merchant_growth_preferences")).length,
    1,
  );
  assert.equal((await db.query("select * from messages")).length, 0);
});
test("a merchant commitment creates a new immutable offer version and waits for Uptick approval", async () => {
  const offerId = await offer(),
    input = request(offerId);
  const supplyId = await requestGrowthSupply(db, merchant, {
    ...input,
    verificationPreference: "self_confirm",
    selfConfirmApproved: true,
    approvedBy: merchant.id,
    state: "approved",
  });
  const [supply] = await db.query<{
    state: string;
    offer_version: number;
    self_confirm_approved: boolean;
    approved_by: string | null;
  }>("select * from network_drop_supplies where id=$1", [supplyId]);
  assert.equal(supply.state, "review");
  assert.equal(supply.offer_version, 2);
  assert.equal(supply.self_confirm_approved, false);
  assert.equal(supply.approved_by, null);
  const versions = await db.query<{ version: number; starts_at: string }>(
    "select version,starts_at from offer_versions where offer_id=$1 order by version",
    [offerId],
  );
  assert.equal(versions.length, 2);
  assert.equal(new Date(versions[1].starts_at).toISOString(), input.startsAt);
  assert.equal(
    (
      await db.query("select * from offer_product_metadata where offer_id=$1", [
        offerId,
      ])
    ).length,
    2,
  );
  assert.equal((await db.query("select * from messages")).length, 0);
  await assert.rejects(
    db.query("delete from offer_versions where offer_id=$1", [offerId]),
    /immutable/,
  );
});
test("foreign merchant offers and unlinked markets cannot become merchant supply", async () => {
  const foreign = await offer("b");
  await assert.rejects(
    requestGrowthSupply(db, merchant, request(foreign)),
    /access/,
  );
  const own = await offer();
  await assert.rejects(
    requestGrowthSupply(db, merchant, { ...request(own), marketId: "missing" }),
    /connect this store/,
  );
  assert.equal(
    (await db.query("select * from network_drop_supplies")).length,
    0,
  );
});
test("reward cost guardrails reject overspend and do not mutate the saved offer", async () => {
  const own = await offer();
  await assert.rejects(
    requestGrowthSupply(db, merchant, { ...request(own), quantity: 51 }),
    /exceed your reward budget/,
  );
  await assert.rejects(
    requestGrowthSupply(db, merchant, {
      ...request(own),
      inventoryPolicy: "unlimited",
    }),
    /fixed quantity/,
  );
  await assert.rejects(
    requestGrowthSupply(db, merchant, { ...request(own), rewardCost: null }),
    /per-item cost/,
  );
  assert.equal(
    (await db.query("select * from offer_versions where offer_id=$1", [own]))
      .length,
    1,
  );
});
test("approved supply cannot be changed by a merchant even while its base offer is in review", async () => {
  const own = await offer(),
    supplyId = await requestGrowthSupply(db, merchant, request(own));
  await db.query(
    "update network_drop_supplies set state='approved',approved_by='operator' where id=$1",
    [supplyId],
  );
  await assert.rejects(
    requestGrowthSupply(db, merchant, { ...request(own), quantity: 25 }),
    /approved plan/,
  );
  await assert.rejects(offer("a", own), /approved commitment/);
  assert.equal((await merchantGrowth(db, merchant)).drafts.length, 0);
  assert.equal(
    (await db.query("select * from offer_versions where offer_id=$1", [own]))
      .length,
    2,
  );
});
test("merchant can revise an unapproved commitment without replacing its identity or prior promise", async () => {
  const own = await offer();
  const initial = request(own);
  const supplyId = await requestGrowthSupply(db, merchant, initial);
  const revised = {
    ...initial,
    quantity: 20,
    startsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 4 * 86400000).toISOString(),
    inventoryPolicy: "timed",
    reservationMinutes: 30,
    verificationPreference: "self_confirm",
    staffInstructions:
      "Check the saved pass and give one coffee after redemption.",
    submit: false,
  };
  assert.equal(await requestGrowthSupply(db, merchant, revised), supplyId);
  const state = await merchantGrowth(db, merchant);
  assert.equal(state.supplies.length, 1);
  assert.equal(state.supplies[0].offer_version, 3);
  assert.equal(state.supplies[0].state, "draft");
  assert.equal(state.supplies[0].quantity, 20);
  assert.equal(state.supplies[0].reservation_minutes, 30);
  assert.equal(state.supplies[0].self_confirm_approved, false);
  assert.equal(state.supplies[0].staff_instructions, revised.staffInstructions);
  assert.equal(
    new Date(state.supplies[0].starts_at).toISOString(),
    revised.startsAt,
  );
  const [previous] = await db.query<{ quantity: number; starts_at: string }>(
    "select quantity,starts_at from offer_versions where offer_id=$1 and version=2",
    [own],
  );
  assert.equal(previous.quantity, 50);
  assert.equal(new Date(previous.starts_at).toISOString(), initial.startsAt);
  assert.equal((await db.query("select * from messages")).length, 0);
});
test("invalid windows, blank staff instructions, and fractional cents are rejected before any version is saved", async () => {
  const own = await offer();
  const input = request(own);
  for (const invalid of [
    { ...input, startsAt: input.expiresAt },
    { ...input, expiresAt: new Date(Date.now() - 60000).toISOString() },
    { ...input, staffInstructions: "            " },
    { ...input, rewardCost: 0.501 },
    { ...input, inventoryPolicy: "timed", reservationMinutes: null },
  ])
    await assert.rejects(requestGrowthSupply(db, merchant, invalid));
  assert.equal(
    (await db.query("select * from network_drop_supplies")).length,
    0,
  );
  assert.equal(
    (await db.query("select * from offer_versions where offer_id=$1", [own]))
      .length,
    1,
  );
});
test("shared market members produce independent merchant results without exposing member identities", async () => {
  const supplies: Record<string, string> = {};
  for (const org of ["a", "b"]) {
    const own = await offer(org);
    supplies[org] = await requestGrowthSupply(
      db,
      { ...merchant, organizationId: org },
      {
        ...request(own),
        startsAt: new Date(Date.now() - 60000).toISOString(),
      },
    );
  }
  await db.query(
    "update network_drop_supplies set state='approved',approved_by='operator'",
  );
  const phones = ["+12015550131", "+12015550132", "+12015550133"];
  for (const [index, phone] of phones.entries()) {
    const joined = await requestMemberAccess(db, {
      phone,
      homeZip: "10583",
      consentRequested: true,
    });
    await confirmMemberAccess(db, joined.credential, true);
    const allocation = await allocateMember(db, joined.member.id);
    assert.equal(allocation?.options.length, 2);
    const org = index === 0 ? "a" : "b";
    const claim = await claimMemberDrop(db, joined.credential, supplies[org]);
    await operatorOverride(
      db,
      { id: "operator", role: "operator", organizationId: org },
      decrypt(claim.token_encrypted),
      "Controlled test of merchant result isolation.",
    );
  }
  const a = await merchantGrowth(db, merchant);
  const b = await merchantGrowth(db, { ...merchant, organizationId: "b" });
  assert.equal(a.metrics.claims, 1);
  assert.equal(a.metrics.redemptions, 1);
  assert.equal(a.metrics.overrides, 1);
  assert.equal(a.metrics.allocated, 3);
  assert.equal(b.metrics.claims, 2);
  assert.equal(b.metrics.redemptions, 2);
  assert.equal(b.metrics.overrides, 2);
  assert.equal(a.metrics.returns, 0);
  assert.equal(b.metrics.returns, 0);
  assert.equal(a.markets[0].members, 3);
  assert.equal(b.markets[0].members, 3);
  for (const phone of phones)
    assert.equal(JSON.stringify([a, b]).includes(phone), false);
  assert.equal((await db.query("select * from subscriptions")).length, 0);
});
test("merchant workspace reveals only own commitments and aggregate local demand", async () => {
  const a = await offer(),
    b = await offer("b");
  await requestGrowthSupply(db, merchant, request(a));
  await requestGrowthSupply(
    db,
    { ...merchant, organizationId: "b" },
    request(b),
  );
  const result = await merchantGrowth(db, merchant);
  assert.equal(result.supplies.length, 1);
  assert.equal(result.supplies[0].offer_id, a);
  assert.equal(
    result.drafts.every((o) => o.organization_id === "a"),
    true,
  );
  assert.equal(result.metrics.claims, 0);
  assert.equal(
    Object.keys(result).some((k) =>
      ["phones", "customers", "members"].includes(k),
    ),
    false,
  );
  assert.equal(JSON.stringify(result).includes('"phone"'), false);
});
