import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import type { DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import { id, decrypt } from "../src/lib/security";
import {
  requestMemberAccess,
  confirmMemberAccess,
  allocateMember,
  claimMemberDrop,
  supplyUsage,
  marketCoverage,
} from "../src/lib/network";
import {
  createRedemptionPoint,
  redeemAtPoint,
  rotateTapCredential,
} from "../src/lib/tap";
import {
  prepareMembershipWeek,
  shareUptick,
  acceptPendingReferral,
} from "../src/lib/member-experience";
import { configureMemberSender } from "../src/lib/member-messaging";
import { aesCmac } from "../src/lib/nfc";

// Called only after verify-postgres.ts has checked the private cluster marker,
// server data directory and disabled TCP listener. Uses the production adapter.
export async function verifyNetworkPostgres(db: DB) {
  const actor: Actor = {
    id: "network-test-operator",
    role: "operator",
    organizationId: "a",
  };
  let phoneSequence = 0;
  async function reset() {
    await db.query(
      "truncate organizations,customers,market_cells,member_senders cascade",
    );
    await db.query("truncate rate_limits");
    await db.query(
      "insert into organizations(id,name) values('a','Store A'),('b','Store B')",
    );
    await db.query(
      "insert into locations(id,organization_id,name,address) values('a-location','a','First store','One Test Street'),('a-other-location','a','Another branch','Two Test Street'),('b-location','b','Second merchant','Three Test Street')",
    );
    await db.query(
      "insert into market_cells(id,name,slug,state) values('market','Test Market','test-market','pilot')",
    );
    await db.query(
      "insert into market_zips(market_id,zip) values('market','10583')",
    );
    await db.query(
      "insert into market_locations(market_id,location_id,organization_id) values('market','a-location','a'),('market','b-location','b')",
    );
  }
  async function supply(
    policy = "unlimited",
    quantity: number | null = null,
    organization = "a",
  ) {
    const supplyId = id(),
      offerId = id();
    await db.query(
      "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Free local coffee')",
      [offerId, organization, `${organization}-location`],
    );
    await db.query(
      "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values($1,1,'No purchase required','Free large coffee','One per member',now()-interval '1 day',now()+interval '7 days')",
      [offerId],
    );
    await db.query(
      "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,approved_by) values($1,'market',$2,$3,$4,1,'approved',now()-interval '1 day',now()+interval '7 days',$5,$6,'network-test-operator')",
      [
        supplyId,
        organization,
        `${organization}-location`,
        offerId,
        policy,
        quantity,
      ],
    );
    return supplyId;
  }
  async function joinedMember() {
    phoneSequence++;
    const result = await requestMemberAccess(db, {
      phone: `+1201555${String(2000 + phoneSequence)}`,
      homeZip: "10583",
      consentRequested: true,
    });
    await confirmMemberAccess(db, result.credential, true);
    return result;
  }
  async function count(table: string) {
    return (
      await db.query<{ n: number }>(`select count(*)::int n from ${table}`)
    )[0].n;
  }

  await reset();
  const scarce = await supply("claim", 1);
  const competitors = await Promise.all(
    Array.from({ length: 4 }, () => joinedMember()),
  );
  await Promise.all(
    competitors.map((member) => allocateMember(db, member.member.id)),
  );
  const reservations = await Promise.allSettled(
    competitors.map((member) => claimMemberDrop(db, member.credential, scarce)),
  );
  assert.equal(
    reservations.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(await count("member_claims"), 1);
  assert.equal(await count("claims"), 1);
  assert.equal((await supplyUsage(db, scarce)).remaining, 0);
  assert.equal((await marketCoverage(db, "market")).coveredMembers, 1);
  console.log(
    "PASS: four members competing for one reserved network perk produce one entitlement and one reservation.",
  );

  await reset();
  const first = await supply(),
    second = await supply("unlimited", null, "b"),
    member = await joinedMember();
  const allocations = await Promise.all(
    Array.from({ length: 4 }, () => allocateMember(db, member.member.id)),
  );
  assert.equal(
    new Set(allocations.map((value) => value?.allocation.id)).size,
    1,
  );
  assert.equal(await count("member_allocations"), 1);
  assert.equal(await count("allocation_options"), 2);
  const choices = await Promise.allSettled([
    claimMemberDrop(db, member.credential, first),
    claimMemberDrop(db, member.credential, second),
  ]);
  assert.equal(
    choices.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(await count("member_claims"), 1);
  assert.equal(await count("claims"), 1);
  const winner = choices.find((result) => result.status === "fulfilled")!;
  assert.equal(winner.status, "fulfilled");
  if (winner.status === "fulfilled") {
    const repeated = await Promise.all(
      Array.from({ length: 4 }, () =>
        claimMemberDrop(
          db,
          member.credential,
          choices[0].status === "fulfilled" ? first : second,
        ),
      ),
    );
    assert.ok(repeated.every((pass) => pass.id === winner.value.id));
  }
  console.log(
    "PASS: concurrent weekly allocations and different merchant choices preserve one immutable allocation and one chosen Uptick.",
  );

  await reset();
  const capped = await supply("redemption", 1),
    people = await Promise.all(Array.from({ length: 4 }, () => joinedMember()));
  await Promise.all(
    people.map((person) => allocateMember(db, person.member.id)),
  );
  const passes = await Promise.all(
    people.map((person) => claimMemberDrop(db, person.credential, capped)),
  );
  const beforeRedemption = await marketCoverage(db, "market");
  assert.equal(beforeRedemption.activeMembers, 4);
  assert.equal(beforeRedemption.coveredMembers, 1);
  const point = await createRedemptionPoint(db, actor, {
    organizationId: "a",
    locationId: "a-location",
    name: "Counter",
    exposure: "staff",
  });
  const redemptions = await Promise.allSettled(
    passes.map((pass) =>
      redeemAtPoint(db, decrypt(pass.token_encrypted), {
        pointToken: point.credential.public_token,
      }),
    ),
  );
  assert.equal(
    redemptions.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(await count("redemptions"), 1);
  assert.equal(await count("redemption_evidence"), 1);
  assert.equal((await supplyUsage(db, capped)).remaining, 0);
  assert.equal((await marketCoverage(db, "market")).coveredMembers, 1);
  console.log(
    "PASS: four separate network passes racing at a location QR consume the final redemption exactly once.",
  );

  await reset();
  const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  process.env.UPTICK_NFC_KEY_PG_META = key.toString("hex");
  process.env.UPTICK_NFC_KEY_PG_FILE = key.toString("hex");
  function proof(counter: number) {
    const picc = Buffer.alloc(16);
    picc[0] = 0xc7;
    Buffer.from("04DE5F1EACC040", "hex").copy(picc, 1);
    picc.writeUIntLE(counter, 8, 3);
    const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16));
    cipher.setAutoPadding(false);
    const encryptedPicc = Buffer.concat([
      cipher.update(picc),
      cipher.final(),
    ]).toString("hex");
    const session = aesCmac(
      key,
      Buffer.concat([Buffer.from("3cc300010080", "hex"), picc.subarray(1, 11)]),
    );
    const mac = Buffer.from(
      aesCmac(session, Buffer.alloc(0)).filter((_, index) => index % 2 === 1),
    ).toString("hex");
    return { encryptedPicc, mac };
  }
  const nfcSupplies = [await supply(), await supply()],
    nfcMembers = await Promise.all([joinedMember(), joinedMember()]);
  await Promise.all(
    nfcMembers.map((person) => allocateMember(db, person.member.id)),
  );
  const nfcPasses = await Promise.all(
    nfcMembers.map((person, index) =>
      claimMemberDrop(db, person.credential, nfcSupplies[index]),
    ),
  );
  const securePoint = await createRedemptionPoint(db, actor, {
    organizationId: "a",
    locationId: "a-location",
    name: "Secure counter",
    exposure: "staff",
  });
  const sameMerchantWrongLocation = await createRedemptionPoint(db, actor, {
    organizationId: "a",
    locationId: "a-other-location",
    name: "Other branch",
    exposure: "staff",
  });
  const wrongMerchant = await createRedemptionPoint(db, actor, {
    organizationId: "b",
    locationId: "b-location",
    name: "Other merchant",
    exposure: "staff",
  });
  for (const invalid of [sameMerchantWrongLocation, wrongMerchant])
    await assert.rejects(
      redeemAtPoint(db, decrypt(nfcPasses[0].token_encrypted), {
        pointToken: invalid.credential.public_token,
      }),
      /different store/,
    );
  assert.equal(await count("redemptions"), 0);
  const secure = await rotateTapCredential(db, actor, securePoint.point.id, {
    type: "secure_nfc",
    uid: "04DE5F1EACC040",
    metaKeyRef: "UPTICK_NFC_KEY_PG_META",
    fileKeyRef: "UPTICK_NFC_KEY_PG_FILE",
  });
  const replayRace = await Promise.allSettled(
    nfcPasses.map((pass) =>
      redeemAtPoint(db, decrypt(pass.token_encrypted), {
        pointToken: secure.public_token,
        nfc: proof(10),
      }),
    ),
  );
  assert.equal(
    replayRace.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(await count("redemptions"), 1);
  assert.equal(await count("redemption_evidence"), 1);
  const rejectedIndex = replayRace[0].status === "rejected" ? 0 : 1;
  await assert.rejects(
    redeemAtPoint(db, decrypt(nfcPasses[rejectedIndex].token_encrypted), {
      pointToken: secure.public_token,
      nfc: proof(9),
    }),
    /already been used/,
  );
  const fresh = await redeemAtPoint(
    db,
    decrypt(nfcPasses[rejectedIndex].token_encrypted),
    { pointToken: secure.public_token, nfc: proof(11) },
  );
  assert.equal(fresh.evidence?.verification_level, 2);
  assert.equal(fresh.evidence?.transaction_verified, false);
  const winnerIndex = rejectedIndex === 0 ? 1 : 0;
  const duplicate = await redeemAtPoint(
    db,
    decrypt(nfcPasses[winnerIndex].token_encrypted),
    { pointToken: secure.public_token, nfc: proof(10) },
  );
  assert.equal(duplicate.repeated, true);
  assert.equal(await count("redemptions"), 2);
  assert.equal(
    (
      await db.query<{ last_counter: number }>(
        "select last_counter from redemption_credentials where id=$1",
        [secure.id],
      )
    )[0].last_counter,
    11,
  );
  assert.equal(
    (
      await db.query(
        "select id from demand_events where kind='redemption_completed' and jsonb_typeof(detail)='object'",
      )
    ).length,
    2,
  );
  console.log(
    "PASS: secure NFC proof reuse across different offers permits one redemption; stale counters and wrong locations fail; fresh counters succeed with exact observed evidence.",
  );
  await reset();
  await supply();
  await Promise.all(Array.from({ length: 4 }, () => joinedMember()));
  const prepared = await Promise.all(
    Array.from({ length: 4 }, () => prepareMembershipWeek(db, 2)),
  );
  await prepareMembershipWeek(db, 2);
  assert.ok(prepared.reduce((n, value) => n + value, 0) <= 4);
  assert.equal(await count("member_messages"), 4);
  assert.equal(
    (await db.query("select id from member_access where purpose='drop'"))
      .length,
    4,
  );
  assert.equal(await prepareMembershipWeek(db, 2), 0);
  console.log(
    "PASS: overlapping weekly schedulers create one access credential and message per member, then advance beyond the first page.",
  );

  await reset();
  await supply();
  const referrer = await joinedMember();
  await allocateMember(db, referrer.member.id);
  const invite = await shareUptick(db, referrer.credential);
  const friends = await Promise.all(
    Array.from({ length: 6 }, async () => {
      phoneSequence++;
      const friend = await requestMemberAccess(db, {
        phone: `+1201555${String(2000 + phoneSequence)}`,
        homeZip: "10583",
        consentRequested: true,
        referralToken: invite,
      });
      await confirmMemberAccess(db, friend.credential, true);
      return friend;
    }),
  );
  const attributed = await Promise.all(
    friends.map((friend) => acceptPendingReferral(db, friend.credential)),
  );
  assert.equal(attributed.filter((result) => result.attributed).length, 5);
  assert.equal(await count("referral_joins"), 5);
  assert.equal(
    (await db.query("select id from uptick_members where state='active'"))
      .length,
    7,
  );
  console.log(
    "PASS: six concurrent first-verified friends respect a five-join invitation cap without rolling back any valid membership.",
  );

  await reset();
  await supply();
  const inviteOwner = await joinedMember();
  const exactInvite = await shareUptick(db, inviteOwner.credential);
  phoneSequence++;
  const pendingPhone = `+1201555${String(2000 + phoneSequence)}`;
  const directAccess = await requestMemberAccess(db, {
    phone: pendingPhone,
    homeZip: "10583",
    consentRequested: true,
  });
  const referralAccess = await requestMemberAccess(db, {
    phone: pendingPhone,
    homeZip: "10583",
    consentRequested: true,
    referralToken: exactInvite,
  });
  await Promise.all(
    [directAccess, referralAccess].map((access) =>
      confirmMemberAccess(db, access.credential, true),
    ),
  );
  const exactOutcomes = await Promise.all(
    [directAccess, referralAccess].map((access) =>
      acceptPendingReferral(db, access.credential),
    ),
  );
  const [firstVerification] = await db.query<{ access_id: string }>(
    "select access_id from member_first_verifications where member_id=$1",
    [directAccess.member.id],
  );
  assert.equal(
    exactOutcomes.filter((outcome) => outcome.attributed).length,
    firstVerification.access_id === referralAccess.access.id ? 1 : 0,
  );
  assert.equal(
    await count("referral_joins"),
    firstVerification.access_id === referralAccess.access.id ? 1 : 0,
  );
  console.log(
    "PASS: competing pending access links credit only the invitation attached to the exact first verification.",
  );

  await reset();
  await supply("redemption", 100);
  await db.query(
    "insert into customers(id,phone) select 'coverage-customer-'||n,'+1212555'||lpad(n::text,4,'0') from generate_series(1000,1199) n",
  );
  await db.query(
    "insert into uptick_members(id,customer_id,home_zip,market_id,state,verified_at) select 'coverage-member-'||n,'coverage-customer-'||n,'10583','market','active',now() from generate_series(1000,1199) n",
  );
  await db.query(
    "insert into member_consents(id,member_id,accepted,disclosure_version,disclosure,source_ui) select 'coverage-consent-'||n,'coverage-member-'||n,true,'fixture','Explicit test membership','fixture' from generate_series(1000,1199) n",
  );
  let coverageQueries = 0;
  const counted: DB = {
    ...db,
    query: (sql, params) => {
      coverageQueries++;
      return db.query(sql, params);
    },
  };
  const bulkCoverage = await marketCoverage(counted, "market");
  assert.equal(bulkCoverage.activeMembers, 200);
  assert.equal(bulkCoverage.coveredMembers, 100);
  assert.ok(coverageQueries <= 6);
  console.log(
    "PASS: a 200-member market uses six SQL round trips and cannot count 100 available items as more than 100 covered members.",
  );

  await reset();
  const sharedService = `MG${"a".repeat(32)}`,
    sharedPhone = "+12015550199";
  const senderRace = await Promise.allSettled([
    configureMemberSender(db, actor, {
      serviceSid: sharedService,
      phone: sharedPhone,
      approved: true,
    }),
    db.query(
      "insert into senders(id,organization_id,service_sid,phone,approved) values('legacy-race','b',$1,$2,true)",
      [sharedService, sharedPhone],
    ),
  ]);
  assert.equal(
    senderRace.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal((await count("member_senders")) + (await count("senders")), 1);
  console.log(
    "PASS: concurrent merchant and membership sender configuration cannot share one service or phone.",
  );
}
