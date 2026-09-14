import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import {
  admitPilotMember,
  commitPilotSupply,
  createPilotRun,
  loadPilotRun,
  pilotCapacity,
  pilotScorecard,
  partnerSummary,
  recordEconomicEntry,
  reverseEconomicEntry,
  savePartnerCommitment,
  completePartnerCommitment,
  setPilotState,
  classifyPilotEntity,
} from "../src/lib/pilot-operations";
import { runScheduledJob, scheduledJobHealth } from "../src/lib/scheduled-jobs";
import {
  assertLocalSeedEnvironment,
  assertNoRealPilotData,
} from "../src/lib/seed-safety";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
let db: DB;
const actor: Actor = { id: "op", role: "operator", organizationId: "store" };
before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db.close?.();
});
beforeEach(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.PILOT_ENROLLMENT_ENABLED;
  await db.query(
    "truncate organizations,market_cells,acquisition_partners,customers,scheduled_job_runs,scheduled_job_leases cascade",
  );
  await db.query("insert into organizations(id,name) values('store','Store')");
  await db.query(
    "insert into locations(id,organization_id,name,address) values('counter','store','Counter','1 Main St')",
  );
  await db.query(
    "insert into market_cells(id,name,slug,state) values('market','Neighborhood','neighborhood','pilot')",
  );
  await db.query("insert into market_zips values('market','10583')");
  await db.query(
    "insert into market_locations(market_id,location_id,organization_id) values('market','counter','store')",
  );
  await db.query(
    "insert into acquisition_partners(id,name,kind) values('partner','Residents','residential')",
  );
  await db.query("insert into partner_markets values('partner','market')");
  await db.query(
    "insert into acquisition_sources(id,partner_id,market_id,token,name,channel,campaign) values('source','partner','market','test-source','Resident email','email','Pilot')",
  );
});
const input = {
  marketId: "market",
  name: "Four week test",
  startsOn: "2030-01-07",
  dataKind: "internal",
  targetMembers: 2,
  hardCap: 2,
  operatorOwner: "Operator",
  supportOwner: "Support",
  backupSupportOwner: "Backup",
  budget: 100,
};
const weeks = ["2030-01-07", "2030-01-14", "2030-01-21", "2030-01-28"];
async function supply(sid: string, quantity = 2) {
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,'store','counter','drop','review','Beverage')",
    [sid],
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values($1,1,'No purchase required','Free bottle','One bottle at no charge','2030-01-01','2030-03-01')",
    [sid],
  );
  await db.query(
    "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,approved_by) values($1,'market','store','counter',$1,1,'approved','2030-01-01','2030-03-01','claim',$2,'op')",
    [sid, quantity],
  );
  await db.query(
    "insert into pilot_supply_terms(supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,funder_organization_id,fulfiller_organization_id,data_kind,created_by) values($1,'Bottled beverage','BOTTLE','16 oz','7 AM to 7 PM','cold-stock','store','store','internal','op')",
    [sid],
  );
}
async function readyRun(count = 2) {
  const runId = await createPilotRun(db, actor, {
    ...input,
    targetMembers: count,
    hardCap: count,
  });
  for (const [i, week] of weeks.entries()) {
    await supply(`s${i}`, count);
    await commitPilotSupply(db, actor, {
      runId,
      weekKey: week,
      supplyId: `s${i}`,
      quantity: count,
    });
  }
  await savePartnerCommitment(db, actor, {
    runId,
    partnerId: "partner",
    sourceId: "source",
    channel: "resident_email",
    plannedAt: "2030-01-07T14:00:00Z",
    owner: "Property manager",
    intendedPopulation: 100,
  });
  await setPilotState(db, actor, {
    runId,
    state: "enrolling",
    checklist: Object.fromEntries(
      [
        "ownerAgreements",
        "staffRehearsal",
        "recoveryFunded",
        "supportCoverage",
        "partnerDistribution",
        "privacyIdentity",
        "releaseVerified",
      ].map((k) => [k, true]),
    ),
  });
  return runId;
}
async function member(i: number, kind = "internal") {
  await db.query("insert into customers(id,phone) values($1,$2)", [
    `c${i}`,
    `+1212555${String(i).padStart(4, "0")}`,
  ]);
  await db.query(
    "insert into uptick_members(id,customer_id,home_zip,market_id,source_id,state,verified_at,data_kind,age_confirmed_at) values($1,$2,'10583','market','source','active',now(),$3,now())",
    [`m${i}`, `c${i}`, kind],
  );
  return `m${i}`;
}
test("four-week admission uses smallest backed week and refuses caps above 200", async () => {
  await assert.rejects(() =>
    createPilotRun(db, actor, { ...input, hardCap: 201 }),
  );
  const runId = await createPilotRun(db, actor, input);
  await supply("one");
  await commitPilotSupply(db, actor, {
    runId,
    weekKey: weeks[0],
    supplyId: "one",
    quantity: 2,
  });
  assert.equal(
    (await pilotCapacity(db, await loadPilotRun(db, runId))).capacity,
    0,
  );
  await assert.rejects(
    () => setPilotState(db, actor, { runId, state: "enrolling" }),
    /Four-week supply backs 0/,
  );
  await assert.rejects(() =>
    commitPilotSupply(db, actor, {
      runId,
      weekKey: weeks[1],
      supplyId: "one",
      quantity: 2,
    }),
  );
});
test("concurrent admissions stop at capacity; optional SMS and internal data never inflate a real cohort", async () => {
  const runId = await readyRun();
  const members = await Promise.all([1, 2, 3].map((i) => member(i)));
  const outcomes = await Promise.all(
    members.map((memberId) => admitPilotMember(db, actor, { memberId })),
  );
  assert.equal(outcomes.filter((o) => o.state === "admitted").length, 2);
  assert.equal(outcomes.filter((o) => o.state === "waitlisted").length, 1);
  assert.equal((await db.query("select * from member_consents")).length, 0);
  const real = await member(4, "real");
  assert.equal(
    (await admitPilotMember(db, actor, { memberId: real })).state,
    "unavailable",
  );
  assert.equal((await pilotScorecard(db, actor, runId)).denominator, 2);
  await db.query("update uptick_members set state='paused' where id=$1", [
    members[0],
  ]);
  assert.equal((await pilotScorecard(db, actor, runId)).denominator, 2);
  assert.equal((await pilotScorecard(db, actor, runId)).weekFour, null);
  await assert.rejects(
    () => db.query("delete from pilot_admissions where run_id=$1", [runId]),
    /immutable|append.only/i,
  );
});

test("legacy and other-run redemptions do not inflate pilot or partner use", async () => {
  const runId = await readyRun(10);
  const memberIds: string[] = [];
  for (let index = 1; index <= 10; index++) {
    const memberId = await member(index);
    memberIds.push(memberId);
    assert.equal(
      (await admitPilotMember(db, actor, { memberId })).state,
      "admitted",
    );
  }
  await db.query(
    "insert into pilot_runs(id,market_id,name,starts_on,ends_on,state,data_kind,target_members,hard_cap,operator_owner,support_owner,backup_support_owner,created_by) values('other-run','market','Other run','2030-01-07','2030-02-04','draft','internal',10,10,'Operator','Support','Backup','op')",
  );
  await db.query(
    "insert into weekly_releases(id,run_id,market_id,week_key,state,data_kind,member_count,reviewed_by,request_key,request_fingerprint) values('other-release','other-run','market',$1,'published','internal',10,'op','other-release-request','other-release-fingerprint')",
    [weeks[1]],
  );

  for (const memberId of memberIds) {
    const suffix = memberId.slice(1);
    const [record] = await db.query<{ customer_id: string }>(
      "select customer_id from uptick_members where id=$1",
      [memberId],
    );
    for (const [kind, weekKey, supplyId] of [
      ["legacy", weeks[0], "s0"],
      ["other", weeks[1], "s1"],
    ] as const) {
      const allocationId = `${kind}-allocation-${suffix}`;
      const claimId = `${kind}-claim-${suffix}`;
      await db.query(
        "insert into member_allocations(id,member_id,market_id,week_key) values($1,$2,'market',$3)",
        [allocationId, memberId, weekKey],
      );
      await db.query(
        "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values($1,$2,'market',1,'{}')",
        [allocationId, supplyId],
      );
      let grantId: string | null = null;
      if (kind === "other") {
        grantId = `other-grant-${suffix}`;
        await db.query(
          "insert into fulfillment_grants(id,release_id,allocation_id,member_id,market_id,week_key,supply_id,organization_id,location_id,offer_id,offer_version,member_snapshot,expires_at,data_kind,state,claimed_at,redeemed_at) values($1,'other-release',$2,$3,'market',$4,$5,'store','counter',$5,1,'{}','2030-02-04','internal','redeemed',now(),now())",
          [grantId, allocationId, memberId, weekKey, supplyId],
        );
      }
      await db.query(
        "insert into claims(id,customer_id,organization_id,offer_id,offer_version,token_hash,token_encrypted,snapshot,state,redeemed_at) values($1,$2,'store',$3,1,$4,$4,'{}','redeemed',now())",
        [claimId, record.customer_id, supplyId, `${kind}-token-${suffix}`],
      );
      await db.query(
        "insert into member_claims(claim_id,member_id,customer_id,organization_id,supply_id,offer_id,allocation_id,grant_id) values($1,$2,$3,'store',$4,$4,$5,$6)",
        [
          claimId,
          memberId,
          record.customer_id,
          supplyId,
          allocationId,
          grantId,
        ],
      );
    }
  }

  const scorecard = await pilotScorecard(db, actor, runId);
  assert.equal(scorecard.denominator, 10);
  assert.equal(scorecard.firstUse, 0);
  assert.equal(scorecard.repeatUse, 0);
  const [partner] = await partnerSummary(db, actor, runId);
  assert.equal(partner.verified_members, 10);
  assert.equal(partner.retained_members, 0);
});

test("a fixed live cohort cannot reopen admissions after a pause", async () => {
  const runId = await readyRun();
  await admitPilotMember(db, actor, { memberId: await member(1) });
  await setPilotState(db, actor, { runId, state: "live" });
  assert.ok((await loadPilotRun(db, runId)).cohort_frozen_at);
  await setPilotState(db, actor, { runId, state: "paused" });
  await assert.rejects(
    () => setPilotState(db, actor, { runId, state: "enrolling" }),
    /frozen/,
  );
  await assert.rejects(
    () =>
      db.query("update pilot_runs set state='enrolling' where id=$1", [runId]),
    /cannot be reopened/,
  );
  assert.equal(
    (await admitPilotMember(db, actor, { memberId: await member(2) })).state,
    "unavailable",
  );
  await setPilotState(db, actor, { runId, state: "live" });
  assert.equal((await pilotScorecard(db, actor, runId)).denominator, 1);
});
test("ledger reversals are append-only and duplicate references cannot double-count money", async () => {
  const runId = await createPilotRun(db, actor, input);
  const d = {
    runId,
    category: "uptick_expense",
    amount: 12.5,
    basis: "actual",
    payer: "Uptick",
    payee: "Print shop",
    occurredOn: "2030-01-07",
    evidence: "Receipt 123",
    dedupKey: "receipt-123",
  };
  const entryId = await recordEconomicEntry(db, actor, d);
  await assert.rejects(
    () => recordEconomicEntry(db, actor, d),
    /already been recorded/,
  );
  await Promise.all(
    [1, 2].map(() =>
      reverseEconomicEntry(db, actor, {
        entryId,
        evidence: "Refunded receipt 123",
      }),
    ),
  );
  assert.equal(
    Number(
      (
        await db.query<{ n: string }>(
          "select sum(amount)::text n from economic_entries",
        )
      )[0].n,
    ),
    0,
  );
  assert.equal((await db.query("select * from economic_entries")).length, 2);
  await assert.rejects(
    () =>
      recordEconomicEntry(db, actor, {
        ...d,
        category: "uptick_revenue",
        basis: "committed",
        dedupKey: "fee",
      }),
    /Program once/,
  );
  await assert.rejects(
    () => db.query("update economic_entries set amount=100"),
    /immutable|append.only/i,
  );
});
test("partner completion needs evidence, is one-time, and used source history cannot be relabeled", async () => {
  const runId = await readyRun();
  const [c] = await db.query<{ id: string }>(
    "select id from partner_commitments",
  );
  await assert.rejects(() =>
    completePartnerCommitment(db, actor, {
      commitmentId: c.id,
      state: "completed",
      evidence: "",
      reportedDelivered: 80,
    }),
  );
  await completePartnerCommitment(db, actor, {
    commitmentId: c.id,
    state: "completed",
    evidence: "Email service delivery report",
    reportedDelivered: 80,
  });
  await assert.rejects(
    () =>
      completePartnerCommitment(db, actor, {
        commitmentId: c.id,
        state: "completed",
        evidence: "Duplicate",
        reportedDelivered: 80,
      }),
    /already/,
  );
  await assert.rejects(
    () =>
      classifyPilotEntity(db, actor, {
        entity: "acquisition_sources",
        entityId: "source",
        dataKind: "real",
        evidence: "Relabel",
      }),
    /obligations/,
  );
  assert.equal((await pilotScorecard(db, actor, runId)).denominator, 0);
});
test("job lease blocks a concurrent worker and restart records interruption", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = runScheduledJob(db, "membership_dispatch", async () => {
    started();
    await pending;
    return 2;
  });
  await ready;
  assert.equal(
    (await runScheduledJob(db, "membership_dispatch", async () => 99)).state,
    "busy",
  );
  release();
  await first;
  await db.query(
    "insert into scheduled_job_leases values('membership_prepare','abandoned',now()-interval '1 minute')",
  );
  await db.query(
    "insert into scheduled_job_runs(id,job_key,state) values('abandoned','membership_prepare','running')",
  );
  await runScheduledJob(db, "membership_prepare", async () => 0);
  assert.equal(
    (
      await db.query<{ state: string }>(
        "select state from scheduled_job_runs where id='abandoned'",
      )
    )[0].state,
    "interrupted",
  );
  assert.equal((await scheduledJobHealth(db)).length, 2);
});
test("seed guards reject hosted connections and real records", async () => {
  process.env.DATABASE_URL = "postgres://example.invalid/never-connect";
  assert.throws(assertLocalSeedEnvironment, /no DATABASE_URL/);
  delete process.env.DATABASE_URL;
  assertLocalSeedEnvironment();
  await member(1, "real");
  await assert.rejects(() => assertNoRealPilotData(db), /real pilot records/);
});
