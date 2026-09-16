/* A merchant can owe more than one thing in a week.

   The bug these pin down: the overview asked for this week's commitment with
   `limit 1` and no `order by`. A merchant running two locations, or backing one
   week with two benefits, was shown whichever row the query planner returned
   first — and the other obligation disappeared from the page their staff work
   from. Plural is not an edge case here; `pilot_week_supplies` is keyed on
   (run, week, supply), so a week holds as many supplies as were committed to
   it, and the schema has always allowed that.

   Each commitment must keep its own identity: which supply, which location and
   address, which item, which size and terms, which usable hours, how much was
   effectively committed, and which fallback stands behind it. */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import { merchantOverview } from "../src/lib/merchant-overview";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "../scripts/verify-postgres-pilot";

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

function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

type Extra = {
  /** Supply id, also used as the offer id and the fallback id prefix. */
  supplyId: string;
  item: string;
  quantity: number;
  /** A second address for this merchant, or undefined to reuse the first. */
  address?: string;
  /** Leave unapproved to prove draft supply never reaches the counter. */
  state?: "draft" | "approved";
  withFallback?: boolean;
  weekKey?: string;
};

/** Another approved commitment for the same merchant, optionally at a second
    location of theirs. Only the columns merchantOverview reads are set up;
    this surface is a read of what was agreed, not of what is usable. */
async function addCommitment(
  db: DB,
  fixture: SyntheticPilotFixture,
  extra: Extra,
) {
  const [source] = await db.query<{
    organization_id: string;
    location_id: string;
    starts_at: string;
    expires_at: string;
  }>(
    "select organization_id,location_id,starts_at,expires_at from network_drop_supplies where id=$1",
    [fixture.supplyId],
  );
  const org = source.organization_id;
  let locationId = source.location_id;
  if (extra.address) {
    locationId = `${extra.supplyId}-location`;
    await db.query(
      "insert into locations(id,organization_id,name,address,postal_code) values($1,$2,$3,$4,'10001')",
      [locationId, org, `${extra.item} counter`, extra.address],
    );
    await db.query(
      "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values($1,$2,$3,7)",
      [fixture.marketId, locationId, org],
    );
  }
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live',$4)",
    [extra.supplyId, org, locationId, extra.item],
  );
  await db.query(
    `insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity)
     values($1,1,'No purchase required',$2,'One per admitted synthetic member.',$3,$4,'claim',$5)`,
    [
      extra.supplyId,
      `One free ${extra.item}`,
      source.starts_at,
      source.expires_at,
      extra.quantity,
    ],
  );
  await db.query(
    `insert into network_drop_supplies(
       id,market_id,organization_id,location_id,offer_id,offer_version,state,
       starts_at,expires_at,inventory_policy,quantity,verification_mode,
       staff_instructions,fallback_plan,approved_by,data_kind
     ) values($1,$2,$3,$4,$1,1,$5,$6,$7,'claim',$8,'staff_tap',
      'Scan the staff QR and hand over the named item.',
      'Use the independently reserved substitute at this counter.',$9,'synthetic')`,
    [
      extra.supplyId,
      fixture.marketId,
      org,
      locationId,
      extra.state || "approved",
      source.starts_at,
      source.expires_at,
      extra.quantity,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_terms(
       supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
       funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values($1,$2,$3,'16 oz','Current pilot week during posted store hours',$4,$5,$5,'synthetic',$6)`,
    [
      extra.supplyId,
      extra.item,
      `${extra.supplyId}-sku`,
      `${extra.supplyId}-stock`,
      org,
      fixture.actor.id,
    ],
  );
  if (extra.withFallback)
    await db.query(
      `insert into pilot_supply_fallbacks(
         id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
         usable_capacity,instructions,payer_organization_id,state,approved_by,created_by
       ) values($1||'-fallback',$1,$2,$1||'-btl','16 oz',$1||'-sealed',$3,
        'Hand over one sealed substitute and scan the same staff QR.',$4,'approved',$5,$5)`,
      [
        extra.supplyId,
        `Sealed ${extra.item}`,
        extra.quantity,
        org,
        fixture.actor.id,
      ],
    );
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,$4,$5)",
    [
      fixture.runId,
      extra.weekKey || fixture.weekKey,
      extra.supplyId,
      extra.quantity,
      fixture.actor.id,
    ],
  );
}

test("A · two locations in one week are both shown, each with its own address", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mc-two-sites");
    await addCommitment(db, fixture, {
      supplyId: "mc-two-sites-second",
      item: "Synthetic pastry",
      quantity: 4,
      address: "2 Second Way",
      withFallback: true,
    });

    const data = await merchantOverview(db, fixture.actor);
    assert.equal(
      data.commitments.length,
      2,
      "both counters this merchant agreed to back must appear",
    );
    const addresses = data.commitments.map((c) => c.address);
    assert.ok(addresses.includes("1 Test Way"));
    assert.ok(addresses.includes("2 Second Way"));
    assert.equal(
      new Set(data.commitments.map((c) => c.locationId)).size,
      2,
      "each commitment keeps the location it belongs to",
    );
    assert.equal(
      data.location,
      null,
      "with two counters there is no single 'where this happens'",
    );
  });
});

test("B · two benefits at the same counter in one week are both shown", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mc-two-items");
    await addCommitment(db, fixture, {
      supplyId: "mc-two-items-second",
      item: "Synthetic pastry",
      quantity: 3,
      withFallback: true,
    });

    const data = await merchantOverview(db, fixture.actor);
    assert.equal(data.commitments.length, 2);
    assert.equal(
      new Set(data.commitments.map((c) => c.locationId)).size,
      1,
      "same counter",
    );
    assert.deepEqual(
      data.commitments.map((c) => c.exactItem).sort(),
      ["Synthetic 12 oz drink", "Synthetic pastry"],
      "a second benefit at one counter is a second obligation, not a replacement",
    );
    assert.equal(
      data.location,
      "1 Test Way",
      "one address is still one address",
    );
  });
});

test("C · each commitment keeps its own quantity, terms, hours and fallback", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mc-fields");
    await addCommitment(db, fixture, {
      supplyId: "mc-fields-second",
      item: "Synthetic pastry",
      quantity: 3,
      address: "2 Second Way",
      withFallback: true,
    });
    /* A third with no approved fallback: "0 substitutes reserved" and "no
       fallback at all" are different facts and must not be conflated. */
    await addCommitment(db, fixture, {
      supplyId: "mc-fields-third",
      item: "Synthetic cookie",
      quantity: 2,
      address: "3 Third Way",
    });

    const data = await merchantOverview(db, fixture.actor);
    assert.equal(data.commitments.length, 3);
    const pastry = data.commitments.find(
      (c) => c.exactItem === "Synthetic pastry",
    )!;
    assert.equal(pastry.supplyId, "mc-fields-second");
    assert.equal(pastry.committedQuantity, 3);
    assert.equal(pastry.sizeLabel, "16 oz");
    assert.equal(pastry.qualification, "No purchase required");
    assert.equal(
      pastry.usableHours,
      "Current pilot week during posted store hours",
    );
    assert.equal(pastry.substituteItem, "Sealed Synthetic pastry");
    assert.equal(pastry.fallbackAvailable, 3);
    assert.equal(pastry.weekKey, fixture.weekKey);

    const cookie = data.commitments.find(
      (c) => c.exactItem === "Synthetic cookie",
    )!;
    assert.equal(cookie.committedQuantity, 2);
    assert.equal(cookie.substituteItem, null);
    assert.equal(
      cookie.fallbackAvailable,
      null,
      "no approved fallback is null, never a reassuring zero",
    );

    const drink = data.commitments.find(
      (c) => c.exactItem === "Synthetic 12 oz drink",
    )!;
    assert.equal(drink.committedQuantity, 4);
    assert.equal(drink.address, "1 Test Way");
  });
});

test("D · the order is deterministic, not whatever the planner returns", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mc-order");
    await addCommitment(db, fixture, {
      supplyId: "mc-order-b",
      item: "Synthetic pastry",
      quantity: 3,
      address: "4 Zulu Way",
    });
    await addCommitment(db, fixture, {
      supplyId: "mc-order-a",
      item: "Synthetic cookie",
      quantity: 2,
      address: "0 Alpha Way",
    });

    const first = await merchantOverview(db, fixture.actor);
    const second = await merchantOverview(db, fixture.actor);
    assert.deepEqual(
      first.commitments.map((c) => c.supplyId),
      second.commitments.map((c) => c.supplyId),
      "two reads of the same week must not reorder the counter list",
    );
    assert.deepEqual(
      first.commitments.map((c) => c.address),
      ["0 Alpha Way", "1 Test Way", "4 Zulu Way"],
      "ordered by address, so staff read the same list every morning",
    );
  });
});

test("E · a later week and an unapproved supply stay off this week's list", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mc-scope");
    await addCommitment(db, fixture, {
      supplyId: "mc-scope-next-week",
      item: "NEXT WEEK ITEM",
      quantity: 4,
      weekKey: addDays(fixture.weekKey, 7),
    });
    await addCommitment(db, fixture, {
      supplyId: "mc-scope-draft",
      item: "UNAPPROVED ITEM",
      quantity: 4,
      state: "draft",
    });

    const data = await merchantOverview(db, fixture.actor);
    assert.deepEqual(
      data.commitments.map((c) => c.exactItem),
      ["Synthetic 12 oz drink"],
      "plural must not become permissive: only this week's approved supply",
    );
  });
});

test("F · a week that has not started is not labelled as this week", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mc-upcoming");
    /* Reading the same data five days early is the position of a merchant whose
       run has been planned but has not begun. The commitments are real and
       should be shown; calling them "this week" would put staff instructions on
       the counter before fulfilment starts. */
    const early = new Date(
      Date.parse(`${fixture.weekKey}T12:00:00Z`) - 5 * 86400000,
    );
    const data = await merchantOverview(db, fixture.actor, early);
    assert.equal(data.commitmentWeekState, "upcoming");
    assert.equal(data.commitmentWeekIndex, 1);
    assert.equal(data.commitmentWeek, fixture.weekKey);
    assert.equal(data.commitments.length, 1, "the plan is still shown");
  });
});

test("G · the current week is still reported as current", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mc-current");
    const data = await merchantOverview(db, fixture.actor);
    assert.equal(data.commitmentWeekState, "current");
    assert.equal(data.commitmentWeek, fixture.weekKey);
  });
});
