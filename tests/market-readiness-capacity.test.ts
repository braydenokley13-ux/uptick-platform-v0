/* What "this Market Cell is ready" has to mean.

   The bug these pin down: the Market Cell gate asked four aggregate questions —
   are there four distinct weeks with any commitment, is there any approved
   supply, any approved fallback, any rehearsed destination — and called a yes
   to all four "ready". Every one of those is satisfied by a single unit per
   week. A 200-member pilot backed by one drink a week would have passed, and
   the first release would have failed 199 people at the counter.

   The repair is not a stricter count. It is proving the claim the gate makes:
   for each week the run still has to serve, compare the cohort that week owes
   against the usable eligible committed capacity behind it — through
   `pilotBacking`, which is the same function the run-state gate uses and runs
   on the same `pilotCapacity` engine as admission and release. No second
   algorithm, because a second algorithm is how a green gate and a refusing
   server end up both being "right". */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import {
  enrollmentBlockers,
  marketReadiness,
  releaseReadiness,
} from "../src/lib/release-readiness";
import { readinessGates } from "../src/lib/operator-readiness";
import {
  loadPilotRun,
  pilotBacking,
  pilotWeeks,
  setPilotState,
} from "../src/lib/pilot-operations";
import { recordMemberServiceEvent } from "../src/lib/member-service";
import { id } from "../src/lib/security";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "../scripts/verify-postgres-pilot";
import { addEligibleCounter } from "./support/pilot-counters";

function localEnvironment() {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
}

async function withDatabase(run: (db: DB) => Promise<void>) {
  localEnvironment();
  const db = await memoryDb();
  try {
    await run(db);
  } finally {
    await db.close?.();
  }
}

/** The audited path for changing physical stock; approved supply is immutable. */
async function adjustInventory(
  db: DB,
  fixture: SyntheticPilotFixture,
  delta: number,
) {
  await db.query(
    "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values($1,$2,$3,$4,$5)",
    [
      id(),
      fixture.supplyId,
      delta,
      "Synthetic stock adjustment.",
      fixture.actor.id,
    ],
  );
}

/** A fully planned pilot: the fixture only commits week one, so weeks two to
    four get their own eligible counters. Without them every shortfall lands on
    an empty week and the per-week proof is never exercised on a real one. */
async function planRemainingWeeks(
  db: DB,
  fixture: SyntheticPilotFixture,
  prefix: string,
  quantity: number,
) {
  const run = await loadPilotRun(db, fixture.runId);
  const weeks = pilotWeeks(run);
  for (const [index, week] of weeks.slice(1).entries())
    await addEligibleCounter(
      db,
      fixture,
      `${prefix}-week-${index + 2}`,
      quantity,
      week,
    );
}

async function backingFor(db: DB, fixture: SyntheticPilotFixture) {
  const run = await loadPilotRun(db, fixture.runId);
  return { run, backing: await pilotBacking(db, run) };
}

async function marketFor(db: DB, marketId: string) {
  const cells = await marketReadiness(db);
  return cells.find((cell) => cell.id === marketId)!;
}

test("A · a cell with one unit per week is not ready for a cohort of twenty", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "mr-thin");
    /* The aggregate gate's exact blind spot: four weeks each hold a
       commitment, there is approved supply, an approved fallback and a
       rehearsed destination — and each week can serve one person. */
    await planRemainingWeeks(db, fixture, "mr-thin", 1);
    await adjustInventory(db, fixture, -19);

    const cell = await marketFor(db, fixture.marketId);
    assert.ok(cell.approvedSupplies > 0, "there is approved supply");
    assert.ok(cell.approvedFallbacks > 0, "there is an approved fallback");
    assert.ok(cell.readyDestinations > 0, "a destination is rehearsed");
    assert.equal(cell.weeks.length, 4, "all four weeks are reported");
    assert.equal(
      cell.backed,
      false,
      "one usable unit does not back twenty members",
    );
    assert.match(cell.evidence, /Week 1: 1 usable units backed for 20 required/);
  });
});

test("B · the evidence names the week and both numbers", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "mr-evidence");
    await planRemainingWeeks(db, fixture, "mr-evidence", 20);
    /* Week three is the thin one. The sentence has to name it, not the first
       week and not an aggregate. */
    await db.query(
      "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values($1,'mr-evidence-week-3',-6,'Synthetic stock adjustment.',$2)",
      [id(), fixture.actor.id],
    );

    const { backing } = await backingFor(db, fixture);
    assert.equal(backing.required, 20);
    assert.deepEqual(
      backing.weeks.map((w) => w.usable),
      [20, 20, 14, 20],
    );
    assert.equal(backing.weeks[2].short, 6);
    assert.equal(
      backing.evidence,
      "Week 3: 14 usable units backed for 20 required.",
    );
  });
});

test("C · every week is proved, not just the first: a later short week blocks", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "mr-later");
    const { backing } = await backingFor(db, fixture);

    /* The fixture commits only week one, so weeks two to four carry nothing.
       An aggregate "four weeks have commitments" check never looks at them. */
    assert.equal(backing.weeks[0].usable, 20);
    assert.deepEqual(
      backing.weeks.slice(1).map((w) => w.usable),
      [0, 0, 0],
    );
    assert.deepEqual(
      backing.weeks.map((w) => w.short),
      [0, 20, 20, 20],
    );
    assert.equal(
      backing.available,
      0,
      "the run can only serve what its worst outstanding week can serve",
    );
    assert.equal((await marketFor(db, fixture.marketId)).backed, false);
  });
});

test("D · before the cohort is frozen the requirement is the pilot's intention", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "mr-intent");
    const run = await loadPilotRun(db, fixture.runId);

    /* A run mid-enrolment owes what it set out to serve. Reading the current
       headcount instead would let a 150-member pilot with five admitted report
       every week fully backed right up to the moment it is not. */
    await planRemainingWeeks(db, fixture, "mr-intent", 20);
    const enrolling = { ...run, cohort_frozen_at: null, target_members: 150 };
    const backing = await pilotBacking(db, enrolling);
    assert.equal(backing.required, 150);
    assert.deepEqual(
      backing.weeks.map((w) => w.usable),
      [20, 20, 20, 20],
    );
    assert.match(backing.evidence, /20 usable units backed for 150 required/);
  });
});

test("E · once frozen the requirement is the operational cohort, not the raw roll", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "mr-frozen");
    const before = await backingFor(db, fixture);
    assert.ok(before.run.cohort_frozen_at, "the fixture run is live");
    assert.equal(before.backing.required, 20);

    /* A withdrawn member is not owed a benefit — `releaseWeeklyBenefits`
       refuses any release that does not match this exact set — so the week does
       not have to back them. */
    for (const member of fixture.members.slice(0, 5))
      await recordMemberServiceEvent(db, fixture.actor, {
        memberId: member.id,
        kind: "withdrawn",
        reason: "Synthetic member withdrew from the pilot before this week.",
        requestKey: `mr-frozen-withdraw-${member.id}`,
      });

    const after = await backingFor(db, fixture);
    assert.equal(
      after.backing.required,
      15,
      "fifteen people are still owed a benefit; five are not",
    );
  });
});

test("F · a released week is history and stops gating the weeks still to come", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "mr-released");
    const run = await loadPilotRun(db, fixture.runId);
    const weeks = pilotWeeks(run);

    const before = await pilotBacking(db, run);
    assert.equal(before.weeks[0].outstanding, true);
    assert.equal(before.weeks[0].released, false);

    await db.query(
      `insert into weekly_releases(id,run_id,market_id,week_key,state,data_kind,member_count,reviewed_by,request_key,request_fingerprint)
       values($1,$2,$3,$4,'published','synthetic',20,$5,$1,'synthetic')`,
      [
        "mr-released-week-one",
        fixture.runId,
        fixture.marketId,
        weeks[0],
        fixture.actor.id,
      ],
    );

    const after = await pilotBacking(db, run);
    assert.equal(after.weeks[0].released, true);
    assert.equal(
      after.weeks[0].outstanding,
      false,
      "a week already served cannot be made unready by a later reading",
    );
    assert.equal(
      after.weeks[0].usable,
      before.weeks[0].usable,
      "and its recorded capacity is not rewritten",
    );
  });
});

test("G · the readiness gate, the server blockers and the run-state gate agree", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "mr-agree");
    await planRemainingWeeks(db, fixture, "mr-agree", 20);
    await adjustInventory(db, fixture, -19); // one usable unit for twenty members

    /* The run-state gate refuses, naming the same proof. */
    await db.query("update pilot_runs set state='paused' where id=$1", [
      fixture.runId,
    ]);
    await assert.rejects(
      setPilotState(db, fixture.actor, {
        runId: fixture.runId,
        state: "live",
        checklist: {},
      }),
      (error: Error) => {
        assert.match(error.message, /Week 1: 1 usable units backed for 20/);
        return true;
      },
    );

    /* A real cell in pilot state, with an enrolling run — one that is actually
       accepting members — and nothing committed behind it.
       The server blocker and the operator's gate must both be that same
       sentence — not two independently derived opinions. */
    await db.query(
      "insert into market_cells(id,name,slug,timezone,state,data_kind) values('mr-real','Real Cell','mr-real-cell','America/New_York','pilot','real')",
    );
    await db.query(
      `insert into pilot_runs(
         id,market_id,name,starts_on,ends_on,state,data_kind,target_members,hard_cap,
         operator_owner,support_owner,backup_support_owner,checklist,created_by
       ) values('mr-real-run','mr-real','Real readiness run',
         date_trunc('week',current_date)::date,date_trunc('week',current_date)::date+28,
         'enrolling','real',150,150,$1,'support','backup','{}',$1)`,
      [fixture.actor.id],
    );

    const cell = (await marketReadiness(db)).find((m) => m.id === "mr-real")!;
    const run = await loadPilotRun(db, "mr-real-run");
    assert.equal(
      cell.evidence,
      (await pilotBacking(db, run)).evidence,
      "the gate quotes the proof rather than deriving its own",
    );
    assert.equal(cell.evidence, "Week 1: 0 usable units backed for 150 required.");
    assert.equal(cell.backed, false);

    const readiness = await releaseReadiness(db);
    const blockers = enrollmentBlockers(readiness).filter(
      (blocker) => blocker.gate === "market",
    );
    assert.ok(
      blockers.length,
      "an unbacked real Market Cell must block enrollment on the server",
    );
    assert.ok(blockers.some((b) => b.detail.includes(cell.evidence)));

    const gates = await readinessGates(db);
    const market = gates.find((gate) => gate.key === "market")!;
    assert.notEqual(market.state, "ready");
    assert.match(market.blocker, /0 usable units backed for 150 required/);
  });
});

test("H · a second obligated run in the same cell cannot be covered by the first", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "mr-two-runs");
    await planRemainingWeeks(db, fixture, "mr-two-runs", 20);
    const backed = await marketFor(db, fixture.marketId);
    assert.equal(backed.runs.length, 1);
    assert.equal(backed.backed, true, "the live run is fully backed");

    /* A paused run in the same cell is still an obligation to the people in it.
       `pilot_one_active_run` allows exactly one enrolling-or-live run per cell,
       so paused is the shape a second concurrent obligation actually takes. */
    await db.query(
      `insert into pilot_runs(
         id,market_id,name,starts_on,ends_on,state,data_kind,target_members,hard_cap,
         operator_owner,support_owner,backup_support_owner,checklist,created_by
       ) values('mr-two-runs-paused',$1,'Paused synthetic run',
         date_trunc('week',current_date)::date,date_trunc('week',current_date)::date+28,
         'paused','synthetic',20,20,$2,'support','backup','{}',$2)`,
      [fixture.marketId, fixture.actor.id],
    );

    const cell = await marketFor(db, fixture.marketId);
    assert.equal(cell.runs.length, 2, "both obligated runs are evaluated");
    assert.equal(
      cell.backed,
      false,
      "a backed run does not vouch for an unbacked one beside it",
    );
    assert.match(cell.evidence, /Paused synthetic run: Week 1: 0 usable units/);
  });
});
