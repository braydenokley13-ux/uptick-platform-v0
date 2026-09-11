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
  saveMembershipSender,
  prepareMembershipMessages,
  dispatchMembershipMessages,
  membershipMessagingOperations,
  lookupNetworkMember,
} from "../src/lib/network-operations";
import { createRedemptionPoint, redeemAtPoint } from "../src/lib/tap";
import {
  shareUptick,
  acceptPendingReferral,
} from "../src/lib/member-experience";
import { decrypt } from "../src/lib/security";
import {
  requestMemberAccess,
  confirmMemberAccess,
  claimMemberDrop,
  supplyUsage,
} from "../src/lib/network";
import { merchantGrowth } from "../src/lib/merchant-growth";
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
  await createRedemptionPoint(db, operator, {
    organizationId: "merchant",
    locationId: "location",
    name: "Staff counter",
    exposure: "staff",
  });
  await createRedemptionPoint(db, operator, {
    organizationId: "merchant",
    locationId: "location",
    name: "Public counter",
    exposure: "public",
  });
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

test("operator approval catches a revised offer and an unavailable verification point", async () => {
  const supplyId = await saveSupply(db, operator, supplyInput());
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) select offer_id,2,qualification,'Free small coffee',terms,starts_at,expires_at from offer_versions where offer_id='drop' and version=1",
  );
  await db.query("update offers set current_version=2 where id='drop'");
  await assert.rejects(
    () => approveSupply(db, operator, supplyId),
    /changed after/,
  );
  await saveSupply(db, operator, { ...supplyInput(), id: supplyId });
  await db.query(
    "update redemption_credentials set state='revoked' where point_id in (select id from redemption_points where exposure='staff')",
  );
  await assert.rejects(
    () => approveSupply(db, operator, supplyId),
    /staff-controlled/,
  );
  await createRedemptionPoint(db, operator, {
    organizationId: "merchant",
    locationId: "location",
    name: "Replacement staff counter",
    exposure: "staff",
  });
  await approveSupply(db, operator, supplyId);
  const data = await networkOperations(db, operator, marketId);
  assert.equal(data.supplies[0].offer_version, 2);
  assert.equal(data.supplies[0].staff_tap_count, 1);
});

test("membership message operations require operator access and return a masked ledger", async () => {
  await assert.rejects(
    () => membershipMessagingOperations(db, merchant),
    /access/,
  );
  await assert.rejects(() => prepareMembershipMessages(db, merchant), /access/);
  await assert.rejects(
    () => dispatchMembershipMessages(db, merchant, { reviewed: true }),
    /access/,
  );
  await assert.rejects(() => saveMembershipSender(db, merchant, {}), /access/);
  await assert.rejects(
    () => dispatchMembershipMessages(db, operator, {}),
    /Review/,
  );
  const sender = {
    serviceSid: `MG${"e".repeat(32)}`,
    phone: "+12125550199",
    approved: false,
  };
  await saveMembershipSender(db, operator, sender);
  const supplyId = await saveSupply(db, operator, supplyInput());
  await approveSupply(db, operator, supplyId);
  const joined = await requestMemberAccess(db, {
    phone: "+12125550131",
    homeZip: "10583",
    consentRequested: true,
  });
  await confirmMemberAccess(db, joined.credential, true);
  assert.equal(await prepareMembershipMessages(db, operator), 1);
  assert.equal(await prepareMembershipMessages(db, operator), 0);
  let data = await membershipMessagingOperations(db, operator);
  assert.equal(data.readiness.simulated, true);
  assert.equal(
    data.messages.find((message) => message.purpose === "drop")?.phone_hint,
    "0131",
  );
  assert.equal(JSON.stringify(data).includes("+12125550131"), false);
  assert.equal(JSON.stringify(data).includes(joined.credential), false);
  await dispatchMembershipMessages(db, operator, { reviewed: true });
  data = await membershipMessagingOperations(db, operator);
  assert.equal(
    data.messages.some((message) => message.state === "delivered"),
    false,
  );
  assert.equal(
    data.messages.every((message) =>
      ["development", "queued", "suppressed"].includes(message.state),
    ),
    true,
  );
});

test("protected member support resolves normalized phones before a claim without exposing private credentials", async () => {
  const phone = "+12125550141";
  const joined = await requestMemberAccess(db, {
    phone,
    homeZip: "10583",
    consentRequested: true,
  });
  await assert.rejects(
    () => lookupNetworkMember(db, merchant, { phone }),
    /access/,
  );
  const pending = await lookupNetworkMember(db, operator, {
    phone: "(212) 555-0141",
  });
  assert.equal(pending?.member.state, "pending");
  assert.equal(pending?.member.verified_at, null);
  assert.equal(pending?.claims.length, 0);
  assert.equal(pending?.consents.length, 0);
  assert.equal(
    pending?.events.some((event) => event.kind === "membership_requested"),
    true,
  );
  const supplyId = await saveSupply(db, operator, supplyInput());
  await approveSupply(db, operator, supplyId);
  await confirmMemberAccess(db, joined.credential, true);
  await allocateMarket(db, operator, marketId);
  await claimMemberDrop(db, joined.credential, supplyId);
  const result = await lookupNetworkMember(db, operator, { phone });
  assert.equal(result?.member.phone_hint, "0141");
  assert.equal(result?.consents[0].accepted, true);
  assert.equal(result?.claims.length, 1);
  assert.equal(result?.claims[0].merchant, "River Fuel");
  assert.equal(result?.claims[0].redeemed_at, null);
  assert.equal(result?.allocations[0].options[0].title, "Morning coffee");
  assert.equal(JSON.stringify(result).includes(phone), false);
  assert.equal(JSON.stringify(result).includes(joined.credential), false);
  const audits = await db.query(
    "select detail from audit_events where action='membership.support_lookup'",
  );
  assert.equal(audits.length, 2);
  assert.equal(JSON.stringify(audits).includes(phone), false);
  assert.equal(
    await lookupNetworkMember(db, operator, { phone: "+12125550142" }),
    null,
  );
});

test("referral cohorts count distinct verified members and keep source attribution separate without private data", async () => {
  const sourceId = await saveAcquisitionSource(db, operator, {
    marketId,
    partnerId: "",
    name: "Resident newsletter",
    channel: "partner-email",
    campaign: "Founding members",
    cost: "",
    state: "active",
  });
  const [source] = await db.query<{ token: string }>(
    "select token from acquisition_sources where id=$1",
    [sourceId],
  );
  const original = await requestMemberAccess(db, {
    phone: "+12125550151",
    homeZip: "10583",
    sourceToken: source.token,
    consentRequested: true,
  });
  await confirmMemberAccess(db, original.credential, true);
  const supplyId = await saveSupply(db, operator, supplyInput());
  await approveSupply(db, operator, supplyId);
  await allocateMarket(db, operator, marketId);
  const invitation = await shareUptick(db, original.credential, supplyId);
  const referred = await requestMemberAccess(db, {
    phone: "+12125550152",
    homeZip: "10583",
    referralToken: invitation,
    consentRequested: true,
  });
  await confirmMemberAccess(db, referred.credential, true);
  await acceptPendingReferral(db, referred.credential);
  await acceptPendingReferral(db, referred.credential);
  await allocateMarket(db, operator, marketId);
  const claimed = await claimMemberDrop(db, referred.credential, supplyId);
  const [point] = await db.query<{ public_token: string }>(
    "select c.public_token from redemption_credentials c join redemption_points p on p.id=c.point_id where p.location_id='location' and p.exposure='staff' and p.state='active' and c.state='active' limit 1",
  );
  await redeemAtPoint(db, decrypt(claimed.token_encrypted), {
    pointToken: point.public_token,
  });
  await redeemAtPoint(db, decrypt(claimed.token_encrypted), {
    pointToken: point.public_token,
  });
  let data = await networkOperations(db, operator, marketId);
  assert.equal(data.members.joined, 2);
  assert.equal(data.sources[0].joins, 1);
  assert.deepEqual(data.referrals, {
    joined: 1,
    verified: 1,
    allocated: 1,
    claimed: 1,
    redeemed: 1,
    source_overlap: 0,
  });
  const support = await lookupNetworkMember(db, operator, {
    phone: "+12125550152",
  });
  assert.equal(support?.member.referred, true);
  assert.equal(support?.member.source, null);
  assert.equal(JSON.stringify(support).includes(original.member.id), false);
  for (const secret of [
    "+12125550151",
    "+12125550152",
    original.credential,
    referred.credential,
    invitation,
    decrypt(claimed.token_encrypted),
  ]) {
    assert.equal(JSON.stringify(data).includes(secret), false);
    assert.equal(JSON.stringify(support).includes(secret), false);
  }
  const mixed = await requestMemberAccess(db, {
    phone: "+12125550153",
    homeZip: "10583",
    sourceToken: source.token,
    referralToken: invitation,
    consentRequested: true,
  });
  await confirmMemberAccess(db, mixed.credential, true);
  await acceptPendingReferral(db, mixed.credential);
  data = await networkOperations(db, operator, marketId);
  assert.equal(data.members.joined, 3);
  assert.equal(data.sources[0].joins, 2);
  assert.equal(data.referrals.joined, 2);
  assert.equal(data.referrals.source_overlap, 1);
  assert.equal(data.referrals.claimed, 1);
  assert.equal(data.referrals.redeemed, 1);
  const mixedSupport = await lookupNetworkMember(db, operator, {
    phone: "+12125550153",
  });
  assert.equal(mixedSupport?.member.source, "Resident newsletter");
  assert.equal(mixedSupport?.member.referred, true);
});

test("later network redemptions count one returning member and retention uses exact mature windows", async () => {
  const sourceId = await saveAcquisitionSource(db, operator, {
    marketId,
    partnerId: "",
    name: "Return cohort",
    channel: "partner-email",
    campaign: "Six week pilot",
    cost: "",
    state: "active",
  });
  const [source] = await db.query<{ token: string }>(
    "select token from acquisition_sources where id=$1",
    [sourceId],
  );
  const member = await requestMemberAccess(db, {
    phone: "+12125550154",
    homeZip: "10583",
    sourceToken: source.token,
    consentRequested: true,
  });
  await confirmMemberAccess(db, member.credential, true);
  const supplyId = await saveSupply(db, operator, supplyInput());
  await approveSupply(db, operator, supplyId);
  await allocateMarket(db, operator, marketId);
  const claim = await claimMemberDrop(db, member.credential, supplyId);
  const [point] = await db.query<{ public_token: string }>(
    "select c.public_token from redemption_credentials c join redemption_points p on p.id=c.point_id where p.location_id='location' and p.exposure='staff' and c.state='active'",
  );
  await redeemAtPoint(db, decrypt(claim.token_encrypted), {
    pointToken: point.public_token,
  });
  await redeemAtPoint(db, decrypt(claim.token_encrypted), {
    pointToken: point.public_token,
  });
  let data = await networkOperations(db, operator, marketId);
  assert.equal(
    data.members.returned,
    0,
    "Reloading one redemption is not a return.",
  );
  assert.equal(
    data.sources[0].mature2,
    0,
    "New members do not have mature retention windows.",
  );

  // This in-memory fixture represents a prior week. Immutable history is inserted
  // with its original timestamps; no history trigger is bypassed or disabled.
  await db.query(
    "update uptick_members set created_at=now()-interval '36 days' where id=$1",
    [member.member.id],
  );
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values('past-drop','merchant','location','drop','live','Earlier coffee')",
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values('past-drop',1,'Visit the store','Earlier coffee','One per member',now()-interval '20 days',now()-interval '13 days')",
  );
  await db.query(
    "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,verification_mode,approved_by) values('past-supply',$1,'merchant','location','past-drop',1,'approved',now()-interval '20 days',now()-interval '13 days','redemption',2,'staff_tap','operator')",
    [marketId],
  );
  await db.query(
    "insert into member_allocations(id,member_id,market_id,week_key,created_at) values('past-allocation',$1,$2,to_char(date_trunc('week',(now()-interval '18 days') at time zone 'America/New_York'),'YYYY-MM-DD'),now()-interval '18 days')",
    [member.member.id, marketId],
  );
  await db.query(
    "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values('past-allocation','past-supply',$1,1,'{}')",
    [marketId],
  );
  await db.query(
    "insert into claims(id,customer_id,organization_id,offer_id,offer_version,token_hash,token_encrypted,snapshot,state,created_at,redeemed_at) select 'past-claim',customer_id,organization_id,'past-drop',1,'past-fixture-hash',token_encrypted,snapshot || jsonb_build_object('reward','Earlier coffee','starts_at',now()-interval '20 days','expires_at',now()-interval '13 days','origin',jsonb_build_object('network',true,'market_id',$2::text,'supply_id','past-supply','allocation_id','past-allocation')),'redeemed',now()-interval '18 days',now()-interval '18 days' from claims where id=$1",
    [claim.id, marketId],
  );
  await db.query(
    "insert into member_claims(claim_id,member_id,customer_id,organization_id,supply_id,offer_id,allocation_id,created_at) values('past-claim',$1,$2,'merchant','past-supply','past-drop','past-allocation',now()-interval '18 days')",
    [member.member.id, member.member.customer_id],
  );
  await db.query(
    "insert into redemptions(id,claim_id,organization_id,created_at) values('past-redemption','past-claim','merchant',now()-interval '18 days')",
  );
  await db.query(
    "insert into redemption_evidence(id,claim_id,organization_id,point_id,credential_id,method,verification_level,verification_policy,staff_gated,actor,created_at) select 'past-evidence','past-claim',organization_id,point_id,credential_id,method,verification_level,verification_policy,staff_gated,actor,now()-interval '18 days' from redemption_evidence where claim_id=$1",
    [claim.id],
  );
  data = await networkOperations(db, operator, marketId);
  assert.equal(data.members.redeemed, 1);
  assert.equal(data.members.returned, 1);
  assert.equal(
    data.sources[0].redeemed,
    1,
    "Source adoption counts people, not their redemption total.",
  );
  assert.equal(data.sources[0].mature2, 1);
  assert.equal(data.sources[0].retained2, 1);
  assert.equal(data.sources[0].mature4, 1);
  assert.equal(
    data.sources[0].retained4,
    0,
    "A day-36 return is outside the day-28 through day-34 window.",
  );
  const result = await merchantGrowth(db, merchant);
  assert.equal(result.metrics.redemptions, 2);
  assert.equal(result.metrics.visitors, 1);
  assert.equal(result.metrics.returns, 1);
  assert.equal(result.metrics.qr, 2);
  const other = await merchantGrowth(db, {
    ...merchant,
    organizationId: "second",
  });
  assert.equal(other.metrics.returns, 0);
});
