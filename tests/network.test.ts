import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import {
  requestMemberAccess,
  memberAccess,
  confirmMemberAccess,
  memberPreferences,
  allocateMember,
  eligibleDrops,
  claimMemberDrop,
  supplyUsage,
  marketCoverage,
  marketWeekWindow,
} from "../src/lib/network";
import { redeem } from "../src/lib/domain";
import { decrypt } from "../src/lib/security";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
let db: DB;
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
    "insert into market_cells(id,name,slug,state) values('market','River neighborhood','river','pilot'),('far','Far market','far','pilot')",
  );
  await db.query(
    "insert into market_zips(market_id,zip) values('market','10583'),('far','10001')",
  );
  await db.query(
    "insert into acquisition_partners(id,name,kind) values('partner','River House','apartment')",
  );
  await db.query("insert into partner_markets values('partner','market')");
  await db.query(
    "insert into acquisition_sources(id,partner_id,market_id,token,name,channel,campaign) values('source','partner','market','river-house','Residents','apartment','First market')",
  );
  for (const name of ["a", "b", "c", "d"]) {
    await db.query("insert into organizations(id,name) values($1,$2)", [
      name,
      `Store ${name}`,
    ]);
    await db.query(
      "insert into locations(id,organization_id,name,address,postal_code) values($1,$1,$2,$3,$4)",
      [name, "Counter", "1 Main St", "10583"],
    );
    await db.query(
      "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values('market',$1,$1,5)",
      [name],
    );
    await db.query(
      "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$1,$1,'drop','review','A little something free')",
      [name],
    );
    await db.query(
      "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values($1,1,'Visit the store','Free coffee','One per member',now()-interval '1 day',now()+interval '30 days')",
      [name],
    );
    await db.query(
      "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity) values($1,'market',$1,$1,$1,1,'review',now()-interval '1 day',now()+interval '30 days','redemption',10)",
      [name],
    );
  }
});
async function member(suffix = "0101", homeZip = "10583") {
  await db.query(
    "update network_drop_supplies set state='approved',approved_by='operator' where approved_by is null and state='review'",
  );
  const joined = await requestMemberAccess(db, {
    phone: `+1212555${suffix}`,
    homeZip,
    sourceToken: "river-house",
    consentRequested: true,
  });
  await confirmMemberAccess(db, joined.credential, true);
  return joined;
}
test("joining and private GET do not verify a phone or activate membership consent", async () => {
  const joined = await requestMemberAccess(db, {
    phone: "+12125550101",
    homeZip: "10583",
    consentRequested: true,
  });
  const state = await memberAccess(db, joined.credential);
  assert.equal(state.member.state, "pending");
  assert.equal(state.member.verified_at, null);
  assert.equal(state.access.confirmed_at, null);
  assert.equal((await db.query("select * from member_consents")).length, 0);
  await assert.rejects(
    () => memberAccess(db, joined.credential, true),
    /Open your private/,
  );
  assert.equal((await eligibleDrops(db, joined.member.id)).length, 0);
});
test("explicit confirmed membership remains separate from all merchant subscriptions", async () => {
  const joined = await member();
  assert.equal(
    (await memberAccess(db, joined.credential, true)).member.state,
    "active",
  );
  assert.equal((await db.query("select * from subscriptions")).length, 0);
  assert.equal((await db.query("select * from consent_events")).length, 0);
  assert.equal(
    (await db.query("select * from member_consents where accepted")).length,
    1,
  );
});
test("public repeat requests cannot overwrite verified geography, attribution or paused consent", async () => {
  const joined = await member();
  await memberPreferences(db, joined.credential, {
    homeZip: "10583",
    workZip: "",
    subscribed: false,
  });
  await requestMemberAccess(db, {
    phone: "+12125550101",
    homeZip: "10001",
    consentRequested: true,
  });
  const state = (await memberAccess(db, joined.credential, true)).member;
  assert.equal(state.home_zip, "10583");
  assert.equal(state.source_id, "source");
  assert.equal(state.state, "paused");
  await confirmMemberAccess(db, joined.credential, true);
  assert.equal(
    (await memberAccess(db, joined.credential)).member.state,
    "paused",
  );
});
test("membership geography gates supply across markets and work ZIP can establish local eligibility", async () => {
  const far = await member("0102", "10001");
  assert.equal((await eligibleDrops(db, far.member.id)).length, 0);
  await memberPreferences(db, far.credential, {
    homeZip: "99999",
    workZip: "10583",
    subscribed: true,
  });
  assert.equal((await eligibleDrops(db, far.member.id)).length, 4);
});
test("one immutable featured allocation and two alternatives per member week", async () => {
  const joined = await member();
  const a = await allocateMember(db, joined.member.id);
  assert.equal(a?.options.length, 3);
  assert.deepEqual(
    a?.options.map((s) => s.rank),
    [1, 2, 3],
  );
  assert.equal(
    (await allocateMember(db, joined.member.id))?.allocation.id,
    a?.allocation.id,
  );
  assert.equal((await db.query("select * from member_allocations")).length, 1);
  assert.equal((await db.query("select * from member_claims")).length, 0);
  await assert.rejects(
    () => db.query("update allocation_options set rank=3 where rank=1"),
    /immutable/i,
  );
});
test("concurrent different choices yield only one weekly entitlement and idempotent repeated claim", async () => {
  const joined = await member();
  const allocation = await allocateMember(db, joined.member.id);
  const options = allocation!.options;
  const results = await Promise.allSettled(
    options
      .slice(0, 2)
      .map((s) => claimMemberDrop(db, joined.credential, s.id)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const claim = results.find(
    (r) => r.status === "fulfilled",
  )! as PromiseFulfilledResult<Awaited<ReturnType<typeof claimMemberDrop>>>;
  const same = await claimMemberDrop(
    db,
    joined.credential,
    claim.value.offer_id,
  );
  assert.equal(same.id, claim.value.id);
  assert.equal((await db.query("select * from member_claims")).length, 1);
  await assert.rejects(
    () => redeem(db, decrypt(same.token_encrypted)),
    /Uptick Tap/,
  );
});
test("last reserved item cannot be claimed twice", async () => {
  await db.query(
    "update network_drop_supplies set inventory_policy='claim',quantity=1 where id='a'",
  );
  const first = await member(),
    second = await member("0102");
  await allocateMember(db, first.member.id);
  await allocateMember(db, second.member.id);
  const results = await Promise.allSettled(
    [first, second].map((m) => claimMemberDrop(db, m.credential, "a")),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.deepEqual(await supplyUsage(db, "a"), {
    claimed: 1,
    redeemed: 0,
    reserved: 1,
    quantity: 1,
    remaining: 0,
    policy: "claim",
  });
});
test("timed reservations release capacity after their deadline without changing the original promise", async () => {
  await db.query(
    "update network_drop_supplies set inventory_policy='timed',quantity=1,reservation_minutes=5 where id='a'",
  );
  const joined = await member();
  await allocateMember(db, joined.member.id);
  const claim = await claimMemberDrop(db, joined.credential, "a");
  assert.equal((await supplyUsage(db, "a")).remaining, 0);
  assert.equal(
    (await supplyUsage(db, "a", new Date(Date.now() + 6 * 60000))).remaining,
    1,
  );
  assert.ok(claim.snapshot.origin.reserved_until);
  await assert.rejects(
    () => db.query("update claims set snapshot='{}' where id=$1", [claim.id]),
    /immutable/i,
  );
});
test("network pass pins approved version even when the merchant edits a later draft", async () => {
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values('a',2,'New qualification','Free snack','Different terms',now(),now()+interval '10 days')",
  );
  await db.query("update offers set current_version=2 where id='a'");
  const joined = await member();
  await allocateMember(db, joined.member.id);
  const claim = await claimMemberDrop(db, joined.credential, "a");
  assert.equal(claim.offer_version, 1);
  assert.equal(claim.snapshot.reward, "Free coffee");
});
test("coverage counts people that can be covered, not three choices as three members", async () => {
  await db.query(
    "update network_drop_supplies set quantity=1,state=case when id='a' then 'review' else 'paused' end",
  );
  const one = await member(),
    two = await member("0102");
  const coverage = await marketCoverage(db, "market");
  assert.equal(coverage.activeMembers, 2);
  assert.equal(coverage.capacity, 1);
  assert.equal(coverage.coveredMembers, 1);
  assert.equal(coverage.uncoveredMembers, 1);
  assert.equal(coverage.coveragePercent, 50);
  assert.notEqual(one.member.id, two.member.id);
});
test("foreign keys reject a cross-merchant member entitlement mapping", async () => {
  const joined = await member();
  const a = await allocateMember(db, joined.member.id);
  await db.query(
    "insert into claims(id,customer_id,organization_id,offer_id,offer_version,token_hash,token_encrypted,snapshot) values('unmapped',$1,'a','a',1,'fixture-only-hash','fixture-only-encrypted','{}')",
    [joined.member.customer_id],
  );
  await assert.rejects(
    () =>
      db.query(
        "insert into member_claims(claim_id,member_id,customer_id,organization_id,supply_id,offer_id,allocation_id) values($1,$2,$3,$4,$5,$6,$7)",
        [
          "unmapped",
          joined.member.id,
          joined.member.customer_id,
          "b",
          "b",
          "b",
          a!.allocation.id,
        ],
      ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23503",
  );
});
test("coverage batches a 200-member eligibility graph without counting overlapping capacity twice", async () => {
  await db.query(
    "update network_drop_supplies set state='approved',approved_by='operator',quantity=25",
  );
  await db.query(
    "insert into customers(id,phone) select 'bulk-customer-'||n,'+1212555'||lpad(n::text,4,'0') from generate_series(1000,1199) n",
  );
  await db.query(
    "insert into uptick_members(id,customer_id,home_zip,market_id,state,verified_at) select 'bulk-member-'||n,'bulk-customer-'||n,'10583','market','active',now() from generate_series(1000,1199) n",
  );
  await db.query(
    "insert into member_consents(id,member_id,accepted,disclosure_version,disclosure,source_ui) select 'bulk-consent-'||n,'bulk-member-'||n,true,'fixture','Explicit test membership','fixture' from generate_series(1000,1199) n",
  );
  let queries = 0;
  const counted: DB = {
    ...db,
    query: (sql, params) => {
      queries++;
      return db.query(sql, params);
    },
  };
  const coverage = await marketCoverage(counted, "market");
  assert.equal(coverage.activeMembers, 200);
  assert.equal(coverage.eligibleMembers, 200);
  assert.equal(coverage.capacity, 100);
  assert.equal(coverage.coveredMembers, 100);
  assert.equal(coverage.uncoveredMembers, 100);
  assert.ok(
    queries <= 6,
    `Expected a batched graph, received ${queries} SQL round trips`,
  );
});
test("unreserved claimed passes still compete for capped redemption inventory in coverage", async () => {
  await db.query(
    "update network_drop_supplies set state=case when id='a' then 'review' else 'paused' end,quantity=1",
  );
  const people = [await member(), await member("0102"), await member("0103")];
  for (const person of people) {
    await allocateMember(db, person.member.id);
    await claimMemberDrop(db, person.credential, "a");
  }
  const coverage = await marketCoverage(db, "market");
  assert.equal(coverage.activeMembers, 3);
  assert.equal(coverage.capacity, 1);
  assert.equal(coverage.coveredMembers, 1);
  assert.equal(coverage.uncoveredMembers, 2);
});
test("coverage preserves issued reservations after supply pauses without offering their stock twice", async () => {
  await db.query(
    "update network_drop_supplies set state=case when id='a' then 'review' else 'paused' end,inventory_policy='claim',quantity=1",
  );
  const first = await member();
  await member("0102");
  await allocateMember(db, first.member.id);
  await claimMemberDrop(db, first.credential, "a");
  await db.query(
    "update network_drop_supplies set state='paused' where id='a'",
  );
  const coverage = await marketCoverage(db, "market");
  assert.equal(coverage.coveredMembers, 1);
  assert.equal(coverage.capacity, 0);
  assert.equal(coverage.supplies, 0);
});
test("coverage respects the immutable choices already shown, ZIP relevance, and prior offer claims", async () => {
  const joined = await member();
  const allocation = await allocateMember(db, joined.member.id);
  const options = allocation!.options.map((option) => option.id);
  await db.query(
    "update network_drop_supplies set state='paused' where id=any($1::text[])",
    [options],
  );
  assert.equal((await marketCoverage(db, "market")).coveredMembers, 0);
  const second = await member("0102");
  assert.equal((await marketCoverage(db, "market")).coveredMembers, 1);
  await db.query("update uptick_members set home_zip='99999' where id=$1", [
    second.member.id,
  ]);
  assert.equal((await marketCoverage(db, "market")).coveredMembers, 0);
  await db.query("update uptick_members set home_zip='10583' where id=$1", [
    second.member.id,
  ]);
  const remaining = ["a", "b", "c", "d"].find(
    (supply) => !options.includes(supply),
  )!;
  await db.query(
    "insert into claims(id,customer_id,organization_id,offer_id,offer_version,token_hash,token_encrypted,snapshot) values('previous-claim',$1,$2,$2,1,'history-fixture-hash','history-fixture-encrypted','{}')",
    [second.member.customer_id, remaining],
  );
  assert.equal((await marketCoverage(db, "market")).coveredMembers, 0);
});
test("market weeks use local Monday boundaries through DST and claim lookup uses the market timezone", async () => {
  const spring = marketWeekWindow(
    new Date("2026-03-08T16:00:00Z"),
    "America/New_York",
  );
  assert.equal(spring.start.toISOString(), "2026-03-02T05:00:00.000Z");
  assert.equal(spring.end.toISOString(), "2026-03-09T04:00:00.000Z");
  const next = marketWeekWindow(
    new Date(Date.now() + 7 * 86400000),
    "America/New_York",
  ).start;
  const at = new Date(next.getTime() + 60000);
  await db.query("update organizations set timezone='America/Los_Angeles'");
  const joined = await member();
  const allocation = await allocateMember(db, joined.member.id, at);
  const claim = await claimMemberDrop(
    db,
    joined.credential,
    allocation!.options[0].id,
    at,
  );
  assert.ok(claim.id);
  assert.equal((await db.query("select * from member_claims")).length, 1);
});
