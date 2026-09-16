/* What "backed" means on the command centre.

   The bug these pin down: destination pins reported `inventory - issued` and
   called it backed units. A store holding 100 of an item that committed 20 to
   this week and has issued 18 has 2 left to give. Reporting 82 tells the
   operator to do nothing, and the week fails at the counter on Saturday.

   The fix is not a different formula here — it is reusing pilotCapacity, the
   engine admission, release and the amendment guard already share. These tests
   therefore assert the numbers an operator sees, and separately that they agree
   with that engine. */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import { destinationPins, weekBacking } from "../src/lib/command-centre";
import {
  loadPilotRun,
  pilotCapacity,
  pilotWeeks,
  requiredCohort,
} from "../src/lib/pilot-operations";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import {
  operationalPilotAudience,
  recordMemberServiceEvent,
} from "../src/lib/member-service";
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

/** The audited path for changing physical stock. The supply row itself is
    immutable once approved. */
async function adjustInventory(
  db: DB,
  fixture: SyntheticPilotFixture,
  delta: number,
) {
  await db.query(
    "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values($1,$2,$3,$4,$5)",
    [id(), fixture.supplyId, delta, "Synthetic stock adjustment.", fixture.actor.id],
  );
}

/** A release must cover the entire operational cohort — that invariant is what
    preserves the denominator. The legitimate way to release to fewer people is
    for members to leave the cohort, so that is what this does. */
async function withdraw(
  db: DB,
  fixture: SyntheticPilotFixture,
  count: number,
  prefix: string,
) {
  for (const member of fixture.members.slice(0, count))
    await recordMemberServiceEvent(db, fixture.actor, {
      memberId: member.id,
      kind: "withdrawn",
      reason: "Synthetic member withdrew from the pilot before this release.",
      requestKey: `${prefix}-withdraw-${member.id}`,
    });
}

async function issue(db: DB, fixture: SyntheticPilotFixture, prefix: string) {
  const { included } = await operationalPilotAudience(db, fixture.runId);
  return releaseWeeklyBenefits(db, fixture.actor, {
    runId: fixture.runId,
    marketId: fixture.marketId,
    weekKey: fixture.weekKey,
    dataKind: "synthetic",
    requestKey: `${prefix}-release`,
    assignments: included.map((admission) => ({
      memberId: admission.member_id,
      supplyId: fixture.supplyId,
    })),
  });
}

async function pinFor(db: DB, fixture: SyntheticPilotFixture) {
  const run = await loadPilotRun(db, fixture.runId);
  const capacity = await pilotCapacity(db, run);
  const pins = await destinationPins(db, run, fixture.weekKey, capacity);
  return { run, capacity, pin: pins[0] };
}

test("A · plentiful stock does not become backed capacity: 100 held, 20 committed, 18 issued leaves 2", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "cc-plentiful");
    await adjustInventory(db, fixture, 80); // inventory 100, commitment still 20
    await withdraw(db, fixture, 2, "cc-plentiful"); // 18 members remain
    await issue(db, fixture, "cc-plentiful");

    const { pin } = await pinFor(db, fixture);
    assert.equal(pin.inventory, 100, "the store really does hold 100");
    assert.equal(pin.committed, 20);
    assert.equal(pin.backed, 20, "only the commitment backs this week");
    assert.equal(
      pin.remaining,
      2,
      "2 backed units remain — not 82, which is inventory minus issued",
    );
    assert.equal(pin.state, "low_supply");
    assert.match(pin.why, /Only 2 of 20 backed units remain/);
  });
});

test("B · commitment equal to stock: 20 committed, 5 issued leaves 15 and is not low", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "cc-equal");
    await withdraw(db, fixture, 15, "cc-equal"); // 5 members remain
    await issue(db, fixture, "cc-equal");

    const { pin } = await pinFor(db, fixture);
    assert.equal(pin.inventory, 20);
    assert.equal(pin.committed, 20);
    assert.equal(pin.backed, 20);
    assert.equal(pin.remaining, 15);
    assert.equal(pin.state, "active");
  });
});

test("C · a commitment larger than usable stock is capped by the stock", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "cc-overcommitted");
    await adjustInventory(db, fixture, -8); // 12 on hand against a 20 commitment

    const { pin } = await pinFor(db, fixture);
    assert.equal(pin.committed, 20);
    assert.equal(pin.inventory, 12);
    assert.equal(
      pin.backed,
      12,
      "promising 20 does not create 20; the shelf decides",
    );
    assert.equal(pin.remaining, 12);
  });
});

test("D · a competing obligation on the same supply reduces what this week can serve", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "cc-competing");
    const before = await pinFor(db, fixture);
    assert.equal(before.pin.backed, 20);

    /* A grant on the same supply belonging to a different week is a real claim
       on the same shelf, and pilotCapacity counts it as competing. */
    const otherWeek = pilotWeeks(before.run)[1];
    await db.query(
      `insert into weekly_releases(id,run_id,market_id,week_key,state,data_kind,member_count,reviewed_by,request_key,request_fingerprint)
       values($1,$2,$3,$4,'published','synthetic',1,$5,$1,'synthetic')`,
      [
        "cc-competing-other-release",
        fixture.runId,
        fixture.marketId,
        otherWeek,
        fixture.actor.id,
      ],
    );
    await db.query(
      `insert into member_allocations(id,member_id,market_id,week_key)
       values('cc-competing-alloc',$1,$2,$3)`,
      [fixture.members[0].id, fixture.marketId, otherWeek],
    );
    await db.query(
      "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values('cc-competing-alloc',$1,$2,1,'{}')",
      [fixture.supplyId, fixture.marketId],
    );
    await db.query(
      `insert into fulfillment_grants(
         id,release_id,allocation_id,member_id,market_id,week_key,supply_id,
         organization_id,location_id,offer_id,offer_version,member_snapshot,
         expires_at,data_kind
       ) select 'cc-competing-grant','cc-competing-other-release','cc-competing-alloc',
         $1,$2,$3,s.id,s.organization_id,s.location_id,s.offer_id,s.offer_version,
         '{}'::jsonb, now()+interval '7 days','synthetic'
         from network_drop_supplies s where s.id=$4`,
      [fixture.members[0].id, fixture.marketId, otherWeek, fixture.supplyId],
    );

    const after = await pinFor(db, fixture);
    assert.equal(
      after.pin.backed,
      19,
      "a unit owed to another week is not available to this one",
    );
    assert.equal(after.pin.remaining, 19);
  });
});

test("E · an exhausted commitment reports nothing remaining, not remaining stock", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 10, "cc-exhausted");
    await adjustInventory(db, fixture, 90); // 100 on the shelf, 10 committed
    await issue(db, fixture, "cc-exhausted");

    const { pin } = await pinFor(db, fixture);
    assert.equal(pin.inventory, 100);
    assert.equal(pin.backed, 10);
    assert.equal(
      pin.remaining,
      0,
      "the commitment is spent even though the shelf is full",
    );
    assert.equal(pin.state, "low_supply");
  });
});

test("F · a later week's commitment does not change this week's capacity", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "cc-future");
    const before = await pinFor(db, fixture);
    assert.equal(before.pin.backed, 20);

    /* Commit a second counter to week two. It must not reach back into week
       one: pilotCapacity reads effective_pilot_week_supplies, which resolves
       each week's chain on its own, so week one keeps the number it was
       planned with and week two carries only its own. */
    const weeks = pilotWeeks(before.run);
    await addEligibleCounter(db, fixture, "cc-future-week-two", 5, weeks[1]);

    const after = await pinFor(db, fixture);
    assert.equal(
      after.pin.backed,
      20,
      "week one is unchanged by a commitment made for week two",
    );
    assert.equal(
      after.capacity.weeks.find((w) => w.week === weeks[0])?.capacity,
      20,
    );
    assert.equal(
      after.capacity.weeks.find((w) => w.week === weeks[1])?.capacity,
      5,
      "week two carries its own smaller commitment, and only its own",
    );
  });
});

test("the requirement is the pilot's intention until the cohort is frozen", async () => {
  await withDatabase(async (db) => {
    /* The fixture takes its run live, which freezes the cohort, so the
       enrolling case is expressed by varying the run record rather than the
       database: the rule under test is a function of those three fields. */
    const fixture = await seedSyntheticPilot(db, 20, "cc-cohort");
    const run = await loadPilotRun(db, fixture.runId);
    assert.ok(run.cohort_frozen_at, "the fixture run is live, so it is frozen");
    assert.equal(run.target_members, 20);
    assert.equal(await requiredCohort(db, run), 20);

    assert.equal(
      await requiredCohort(db, {
        ...run,
        cohort_frozen_at: null,
        target_members: 150,
      }),
      150,
      "a 150-member pilot with 20 admitted still owes 150 while it enrols",
    );
    assert.equal(
      await requiredCohort(db, { ...run, target_members: 150 }),
      20,
      "once frozen the admitted cohort is the whole obligation, not the target",
    );
  });
});

test("week backing compares capacity against that requirement, and names the shortfall", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "cc-backing");
    await adjustInventory(db, fixture, -15); // 5 usable against a 20-member pilot
    const run = await loadPilotRun(db, fixture.runId);
    const capacity = await pilotCapacity(db, run);
    const owed = await requiredCohort(db, run);
    const backing = weekBacking(run, capacity, [], owed, fixture.weekKey);

    const first = backing[0];
    assert.equal(first.required, 20);
    assert.equal(first.capacity, 5);
    assert.equal(first.short, 15, "a short week says how short");
  });
});

test("G · a pin explains the week the operator is looking at, not today", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "cc-week-label");
    const run = await loadPilotRun(db, fixture.runId);
    const weeks = pilotWeeks(run);
    await addEligibleCounter(db, fixture, "cc-week-label-three", 6, weeks[2]);

    const capacity = await pilotCapacity(db, run);
    const current = await destinationPins(db, run, weeks[0], capacity);
    assert.match(current[0].why, /remain this week/);

    /* The operator can page to another week. Its figures are that week's, and
       dating them to today would have staff act on the wrong week's capacity. */
    const later = await destinationPins(db, run, weeks[2], capacity);
    const backed = later.find((pin) => pin.backed > 0)!;
    assert.match(backed.why, /remain in week 3/);
    assert.ok(!/this week/.test(backed.why));
  });
});

test("H · a commercial counter's remaining units are not subtracted twice", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "cc-program");
    const [source] = await db.query<{
      organization_id: string;
      starts_at: string;
      expires_at: string;
    }>(
      "select organization_id,starts_at,expires_at from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    const org = source.organization_id;
    /* A Growth Program planning twenty placements for this week. Its
       `remaining_capacity` is already net of grants issued, so once eighteen
       are out the placeable figure is two — and a display that subtracts the
       eighteen again shows nobody anything left. */
    /* The program and its version reference each other, and the program's
       version FK is deferrable, so both rows go in one transaction. */
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into growth_programs(id,buyer_organization_id,market_id,status,current_version,approved_version,created_by)
         values('cc-program-p',$1,$2,'active',1,1,$3)`,
        [org, fixture.marketId, fixture.actor.id],
      );
      await tx.query(
        `insert into growth_program_versions(
           program_id,version,name,objective,starts_on,ends_on,buyer_organization_id,
           funder_organization_id,fulfiller_organization_id,negotiated_fee_cents,
           commercial_status,benefit_ceiling,operating_constraints,evaluation_plan,proposed_by
         ) values('cc-program-p',1,'Synthetic program','introduce_store',$1::date,$1::date+28,$2,$2,$2,
           0,'agreed',80,'Synthetic operating constraints for this test.',
           'Synthetic evaluation plan for this test.',$3)`,
        [fixture.weekKey, org, fixture.actor.id],
      );
    });
    await db.query(
      "insert into growth_program_week_plans(program_id,program_version,week_key,planned_placements) values('cc-program-p',1,$1,20)",
      [fixture.weekKey],
    );
    await db.query(
      `insert into growth_program_approvals(id,program_id,program_version,run_id,decision,capacity_snapshot,note,decided_by)
       values('cc-program-approval','cc-program-p',1,$1,'approved','{}','Synthetic approval.',$2)`,
      [fixture.runId, fixture.actor.id],
    );
    await db.query(
      "insert into program_supply_links(program_id,program_version,supply_id,week_key,linked_by) values('cc-program-p',1,$1,$2,$3)",
      [fixture.supplyId, fixture.weekKey, fixture.actor.id],
    );

    await withdraw(db, fixture, 2, "cc-program"); // eighteen members remain
    await issue(db, fixture, "cc-program");

    const run = await loadPilotRun(db, fixture.runId);
    const capacity = await pilotCapacity(db, run);
    const plan = capacity.supplies.find(
      (supply) => supply.supply_id === fixture.supplyId,
    )!;
    assert.equal(plan.issued, 18);
    assert.equal(
      plan.quantity,
      2,
      "two placements are still available under the program",
    );
    assert.equal(
      plan.weekTotal,
      20,
      "and twenty is what the week was planned to back",
    );

    const pin = (await destinationPins(db, run, fixture.weekKey, capacity))[0];
    assert.equal(pin.backed, 20);
    assert.equal(
      pin.remaining,
      2,
      "the eighteen issued grants are subtracted once, not twice",
    );
    assert.match(pin.why, /Only 2 of 20 backed units remain this week/);
  });
});

test("a supply outside any programme reports the same total it can place", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "cc-organic");
    const run = await loadPilotRun(db, fixture.runId);
    const capacity = await pilotCapacity(db, run);
    for (const supply of capacity.supplies)
      assert.equal(
        supply.weekTotal,
        supply.quantity,
        "with no commercial limit the placeable figure is already the total",
      );
  });
});
