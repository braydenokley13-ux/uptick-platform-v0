import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import { id, decrypt } from "../src/lib/security";
import {
  requestMemberAccess,
  confirmMemberAccess,
  allocateMember,
  claimMemberDrop,
  eligibleDrops,
  marketCoverage,
  memberPreferences,
} from "../src/lib/network";
import {
  shareUptick,
  referralLanding,
  acceptReferral,
  acceptPendingReferral,
  memberHome,
  prepareMembershipWeek,
} from "../src/lib/member-experience";
import {
  configureMemberSender,
  dispatchMemberMessages,
  queueMemberAccess,
} from "../src/lib/member-messaging";
import { createRedemptionPoint, redeemAtPoint } from "../src/lib/tap";
let db: DB,
  number = 0;
before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db.close?.();
});
beforeEach(async () => {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.SMS_TRANSPORT = "development";
  process.env.APP_URL = "http://localhost:3000";
  delete process.env.VERCEL;
  await db.query(
    "truncate organizations,customers,market_cells,member_senders,rate_limits cascade",
  );
  number = 0;
  await db.query(
    "insert into market_cells(id,name,slug,state) values('market','Near market','near','pilot'),('far','Far market','far','pilot')",
  );
  await db.query(
    "insert into market_zips values('market','10583'),('far','10001')",
  );
  await db.query(
    "insert into organizations(id,name) values('merchant','Test store'),('second','Another store')",
  );
  await db.query(
    "insert into locations(id,organization_id,name,address) values('location','merchant','Main','One Street'),('second-location','second','Main','Two Street')",
  );
  await db.query(
    "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values('market','location','merchant',2),('market','second-location','second',1)",
  );
});
async function supply(
  supplyId = "supply",
  options: {
    org?: string;
    quantity?: number;
    shared?: boolean;
    cap?: number;
  } = {},
) {
  const org = options.org || "merchant",
    location = org === "merchant" ? "location" : "second-location";
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Free coffee')",
    [supplyId, org, location],
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values($1,1,'No purchase required','Free coffee','One per member',now()-interval '1 day',now()+interval '7 days')",
    [supplyId],
  );
  await db.query(
    "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,shareable,referral_cap,approved_by) values($1,'market',$2,$3,$1,1,'approved',now()-interval '1 day',now()+interval '7 days','redemption',$4,$5,$6,'operator')",
    [
      supplyId,
      org,
      location,
      options.quantity ?? 20,
      options.shared ?? true,
      options.cap ?? 5,
    ],
  );
  return supplyId;
}
async function request(
  options: { referralToken?: string; zip?: string; phone?: string } = {},
) {
  number++;
  return requestMemberAccess(db, {
    phone: options.phone || `+1201555${String(3000 + number)}`,
    homeZip: options.zip || "10583",
    consentRequested: true,
    referralToken: options.referralToken,
  });
}
async function join(
  options: { referralToken?: string; zip?: string; phone?: string } = {},
) {
  const result = await request(options);
  await confirmMemberAccess(db, result.credential, true);
  return result;
}
async function count(table: string) {
  return (
    await db.query<{ n: number }>(`select count(*)::int n from ${table}`)
  )[0].n;
}
async function invitation(cap = 5) {
  await supply("shared", { cap });
  const owner = await join();
  await allocateMember(db, owner.member.id);
  const link = await shareUptick(db, owner.credential, "shared");
  return { owner, link };
}

test("referral links disclose only market and perk, preserve their market, and record link creation without invented sends", async () => {
  const { owner, link } = await invitation();
  assert.equal(await shareUptick(db, owner.credential, "shared"), link);
  const landing = await referralLanding(db, link);
  assert.equal(landing.referral.market, "Near market");
  assert.ok(!("member_id" in landing.referral));
  assert.ok(!JSON.stringify(landing).includes(owner.member.id));
  assert.equal(await count("member_messages"), 0);
  assert.equal(
    (
      await db.query(
        "select id from demand_events where kind='referral_link_created'",
      )
    ).length,
    1,
  );
  assert.equal(
    (await db.query("select id from demand_events where kind='referral_sent'"))
      .length,
    0,
  );
  await memberPreferences(db, owner.credential, {
    homeZip: "10001",
    workZip: "",
    subscribed: true,
  });
  assert.equal(
    (await referralLanding(db, link)).referral.market,
    "Near market",
  );
});
test("only the invitation bound before exact first verification earns new-member attribution", async () => {
  const { link } = await invitation();
  const fresh = await join({ referralToken: link });
  assert.deepEqual(await acceptPendingReferral(db, fresh.credential), {
    attributed: true,
    status: "accepted",
  });
  await acceptPendingReferral(db, fresh.credential);
  assert.equal(await count("referral_joins"), 1);
  const existing = await join();
  const repeat = await request({
    phone: (
      await db.query<{ phone: string }>(
        "select phone from customers where id=$1",
        [existing.member.customer_id],
      )
    )[0].phone,
    referralToken: link,
  });
  await confirmMemberAccess(db, repeat.credential, true);
  await acceptReferral(db, repeat.credential, link);
  assert.equal(await count("referral_joins"), 1);
  assert.equal(
    (
      await db.query(
        "select access_id from access_referral_intents where access_id=$1",
        [repeat.access.id],
      )
    ).length,
    0,
  );
  const unbound = await join();
  await acceptReferral(db, unbound.credential, link);
  assert.equal(await count("referral_joins"), 1);
});
test("a later pending access request cannot replace the referral source of the first confirmed link", async () => {
  const { link } = await invitation();
  const first = await request();
  const phone = (
    await db.query<{ phone: string }>(
      "select phone from customers where id=$1",
      [first.member.customer_id],
    )
  )[0].phone;
  const later = await request({ phone, referralToken: link });
  await confirmMemberAccess(db, first.credential, true);
  await confirmMemberAccess(db, later.credential, true);
  assert.equal(
    (await acceptPendingReferral(db, later.credential)).attributed,
    false,
  );
  assert.equal(await count("referral_joins"), 0);
  await assert.rejects(
    db.query(
      "update member_first_verifications set access_id=$1 where member_id=$2",
      [later.access.id, first.member.id],
    ),
    /immutable/,
  );
});
test("referral cap contention admits one acquisition but never rolls back the friend's valid membership", async () => {
  const { link } = await invitation(1);
  const friends = await Promise.all([
    join({ referralToken: link }),
    join({ referralToken: link }),
  ]);
  const outcomes = await Promise.all(
    friends.map((friend) => acceptPendingReferral(db, friend.credential)),
  );
  assert.equal(outcomes.filter((outcome) => outcome.attributed).length, 1);
  assert.equal(await count("referral_joins"), 1);
  assert.equal(
    (await db.query("select id from uptick_members where state='active'"))
      .length,
    3,
  );
  await assert.rejects(referralLanding(db, link), /limit or ended/);
});
test("shared perks are prioritized only through ordinary market and inventory eligibility", async () => {
  const { link } = await invitation();
  await supply("closer", { org: "second" });
  const friend = await join({ referralToken: link });
  await acceptPendingReferral(db, friend.credential);
  const chosen = await allocateMember(db, friend.member.id);
  assert.equal(chosen?.options[0].id, "shared");
  assert.equal(chosen?.options[0].reason?.referral, true);
  assert.ok((chosen?.options.length || 0) <= 3);
  const far = await join({ referralToken: link, zip: "10001" });
  assert.equal(
    (await acceptPendingReferral(db, far.credential)).status,
    "unavailable",
  );
  assert.equal(await allocateMember(db, far.member.id), null);
  await db.query(
    "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values($1,'shared',-20,'Removed remaining stock','operator')",
    [id()],
  );
  const soldOut = await join({ referralToken: link });
  await acceptPendingReferral(db, soldOut.credential);
  assert.equal(
    (await allocateMember(db, soldOut.member.id))?.options[0].id,
    "closer",
  );
  assert.equal((await referralLanding(db, link)).supply, undefined);
});
test("later referral handling cannot rewrite an allocation already shown to a member", async () => {
  const { link } = await invitation();
  await supply("closer", { org: "second" });
  const friend = await join({ referralToken: link });
  const before = await allocateMember(db, friend.member.id);
  assert.equal(before?.options[0].id, "closer");
  await acceptPendingReferral(db, friend.credential);
  const after = await allocateMember(db, friend.member.id);
  assert.deepEqual(after, before);
});
test("notification preparation pages through existing released allocations only", async () => {
  await supply();
  await join({ zip: "10001" });
  await join({ zip: "10001" });
  const available = [await join(), await join(), await join()];
  for (const member of available) await allocateMember(db, member.member.id);
  assert.equal(await prepareMembershipWeek(db, 2), 2);
  assert.equal(await prepareMembershipWeek(db, 2), 1);
  assert.equal(await prepareMembershipWeek(db, 2), 0);
  assert.equal(await count("member_messages"), 3);
  assert.equal(
    (await db.query("select id from member_access where purpose='drop'"))
      .length,
    3,
  );
  assert.equal((await db.query("select * from member_allocations")).length, 3);
  assert.deepEqual(
    new Set(
      (
        await db.query<{ member_id: string }>(
          "select member_id from member_messages",
        )
      ).map((row) => row.member_id),
    ),
    new Set(available.map((member) => member.member.id)),
  );
});
test("overlapping scheduler runs create one credential and message per member week atomically", async () => {
  await supply();
  const members = [await join(), await join()];
  for (const member of members) await allocateMember(db, member.member.id);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => prepareMembershipWeek(db, 2)),
  );
  assert.equal(
    results.reduce((total, value) => total + value, 0),
    2,
  );
  assert.equal(await count("member_messages"), 2);
  assert.equal(
    (await db.query("select id from member_access where purpose='drop'"))
      .length,
    2,
  );
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query(
        "insert into member_week_preparations(member_id,week_key,state,next_attempt_at) select id,'2099-01-05','waiting_supply',now() from uptick_members limit 1",
      );
      throw Error("fail before commit");
    }),
    /fail before commit/,
  );
  assert.equal(
    (
      await db.query(
        "select member_id from member_week_preparations where week_key='2099-01-05'",
      )
    ).length,
    0,
  );
});
test("weekly preparation rechecks a choice made after allocation before creating a message or credential", async () => {
  await supply();
  const member = await join();
  await allocateMember(db, member.member.id);
  let transactions = 0;
  const raced: DB = {
    ...db,
    transaction: async (fn) => {
      if (++transactions === 1)
        await claimMemberDrop(db, member.credential, "supply");
      return db.transaction(fn);
    },
  };
  assert.equal(await prepareMembershipWeek(raced), 0);
  assert.equal(await count("member_messages"), 0);
  assert.equal(
    (await db.query("select id from member_access where purpose='drop'"))
      .length,
    0,
  );
  assert.equal(await count("member_claims"), 1);
});
test("weekly preparation keeps an issued allocation visible after geography changes", async () => {
  await supply();
  const member = await join();
  await allocateMember(db, member.member.id);
  let transactions = 0;
  const raced: DB = {
    ...db,
    transaction: async (fn) => {
      if (++transactions === 1)
        await db.query(
          "update uptick_members set home_zip='99999',work_zip=null where id=$1",
          [member.member.id],
        );
      return db.transaction(fn);
    },
  };
  assert.equal(await prepareMembershipWeek(raced), 1);
  assert.equal(await count("member_messages"), 1);
  assert.equal(
    (await db.query("select id from member_access where purpose='drop'"))
      .length,
    1,
  );
});
test("declined promotional consent blocks notification without ending membership eligibility", async () => {
  await supply();
  const member = await join();
  assert.equal((await marketCoverage(db, "market")).coveredMembers, 1);
  await db.query(
    "insert into member_consents(id,member_id,accepted,disclosure_version,disclosure,source_ui) values($1,$2,false,'test','Declined','test')",
    [id(), member.member.id],
  );
  assert.equal((await eligibleDrops(db, member.member.id)).length, 1);
  assert.equal((await marketCoverage(db, "market")).activeMembers, 1);
  assert.equal(await prepareMembershipWeek(db), 0);
  await join();
  await db.query("update market_locations set active=false");
  const disabled = await marketCoverage(db, "market");
  assert.equal(disabled.supplies, 0);
  assert.equal(disabled.capacity, 0);
  assert.equal(disabled.coveredMembers, 0);
});
test("member history and issued allocation remain available when promotional texts stop", async () => {
  await supply();
  const member = await join();
  await allocateMember(db, member.member.id);
  const pass = await claimMemberDrop(db, member.credential, "supply");
  const point = await createRedemptionPoint(
    db,
    { id: "operator", organizationId: "merchant", role: "operator" },
    {
      organizationId: "merchant",
      locationId: "location",
      name: "Counter",
      exposure: "staff",
    },
  );
  await redeemAtPoint(db, decrypt(pass.token_encrypted), {
    pointToken: point.credential.public_token,
  });
  assert.equal(
    (await memberHome(db, member.credential)).history[0].method,
    "qr",
  );
  await memberPreferences(db, member.credential, {
    homeZip: "10583",
    workZip: "",
    subscribed: false,
  });
  const home = await memberHome(db, member.credential);
  assert.ok(home.current?.allocation.id);
  assert.equal(home.marketingSubscribed, false);
  assert.equal(home.history[0].state, "redeemed");
  assert.equal(home.saved?.id, pass.id);
  assert.equal(home.shareableSupplyId, "supply");
});
test("the only saved pass remains on Your Uptick when it no longer appears in new-claim eligibility", async () => {
  await supply();
  const member = await join();
  await allocateMember(db, member.member.id);
  const pass = await claimMemberDrop(db, member.credential, "supply");
  assert.equal((await eligibleDrops(db, member.member.id)).length, 0);
  const home = await memberHome(db, member.credential);
  assert.ok(home.current?.allocation.id);
  assert.equal(home.current?.options.length, 1);
  assert.equal(home.saved?.id, pass.id);
  assert.equal(home.shareableSupplyId, "supply");
  await memberPreferences(db, member.credential, {
    homeZip: "10583",
    workZip: "",
    subscribed: false,
  });
  const unsubscribed = await memberHome(db, member.credential);
  assert.ok(unsubscribed.current?.allocation.id);
  assert.equal(unsubscribed.marketingSubscribed, false);
  assert.equal(unsubscribed.saved?.id, pass.id);
  assert.equal(unsubscribed.shareableSupplyId, "supply");
});
test("dedicated sender separation is enforced in both directions at the database boundary", async () => {
  const service = `MG${"b".repeat(32)}`,
    phone = "+12015550199";
  await configureMemberSender(
    db,
    { id: "operator", role: "operator", organizationId: "merchant" },
    { serviceSid: service, phone, approved: true },
  );
  await assert.rejects(
    db.query(
      "insert into senders(id,organization_id,service_sid,phone) values('legacy','merchant',$1,$2)",
      [service, phone],
    ),
    /cannot be shared/,
  );
  await db.query(
    "insert into senders(id,organization_id,service_sid,phone) values('legacy','merchant',$1,'+12015550198')",
    [`MG${"c".repeat(32)}`],
  );
  await assert.rejects(
    db.query("update senders set phone=$1 where id='legacy'", [phone]),
    /cannot be shared/,
  );
});
test("targeted access dispatch cannot be starved by an older queued membership message", async () => {
  const first = await request(),
    second = await request();
  const older = await queueMemberAccess(db, first.access.id),
    target = await queueMemberAccess(db, second.access.id);
  await dispatchMemberMessages(
    db,
    1,
    async () => {
      throw Error("development must not call provider");
    },
    target.id,
  );
  assert.equal(
    (
      await db.query<{ state: string }>(
        "select state from member_messages where id=$1",
        [target.id],
      )
    )[0].state,
    "development",
  );
  assert.equal(
    (
      await db.query<{ state: string }>(
        "select state from member_messages where id=$1",
        [older.id],
      )
    )[0].state,
    "queued",
  );
});
