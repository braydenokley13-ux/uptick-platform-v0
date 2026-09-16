/* The member Places tab.

   `/your-uptick?view=places` was in the bottom bar and led nowhere: it fell
   through to Home and Home stayed lit, so the one tab that changed nothing
   also looked like it had not been pressed.

   These tests are about what the surface is now allowed to say. It answers one
   question — "where does Uptick work around me?" — from the member's real
   Market Cell and their own backed pilot week. It is not an offer feed: no
   item, no terms, nothing claimable, and no counter belonging to a run this
   member is not in. And the counter states come from the same `pilotCapacity`
   engine the operator reads, so a member is never told a place is open while
   the operator is told it is not. */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import { memberPlaces } from "../src/lib/member-experience";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import { hash, id, token, encrypt } from "../src/lib/security";
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

/** A confirmed private link for one member, the way the member page reads. */
async function credentialFor(db: DB, memberId: string) {
  const credential = token();
  const [member] = await db.query<{ home_zip: string }>(
    "select home_zip from uptick_members where id=$1",
    [memberId],
  );
  await db.query(
    `insert into member_access(
       id,member_id,token_hash,token_encrypted,purpose,expires_at,
       age_attested,disclosure,home_zip,confirmed_at
     ) values($1,$2,$3,$4,'access',now()+interval '30 days',true,
       'Synthetic membership disclosure for this test.',$5,now())`,
    [id(), memberId, hash(credential), encrypt(credential), member.home_zip],
  );
  return credential;
}

async function placesFor(db: DB, fixture: SyntheticPilotFixture, index = 0) {
  return memberPlaces(
    db,
    await credentialFor(db, fixture.members[index].id),
  );
}

test("an admitted member sees their own Market Cell and the counters backing their week", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mp-backed");
    const data = await placesFor(db, fixture);

    assert.equal(data.market?.name, "Synthetic Pilot");
    assert.deepEqual(data.coverage, ["10001"], "the real defined neighbourhood");
    assert.equal(data.inCoverage, true);
    assert.equal(data.admitted, true);
    assert.equal(data.week, fixture.weekKey);
    assert.equal(data.places.length, 1);

    const place = data.places[0];
    assert.equal(place.name, "Synthetic Pilot Merchant");
    assert.equal(place.address, "1 Test Way");
    assert.equal(place.driveMinutes, 5);
    assert.equal(place.state, "ready");
    assert.equal(place.why, "Open this week.");
  });
});

test("a place is never described with the operator's unit counts", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mp-no-counts");
    const data = await placesFor(db, fixture);
    for (const place of data.places) {
      assert.ok(
        !/\d+\s*(of|backed|units|remain)/i.test(place.why),
        `a member is told whether to walk there, not how much stock is left: "${place.why}"`,
      );
      assert.ok(
        !Object.keys(place).some((key) =>
          ["backed", "committed", "inventory", "remaining", "issued"].includes(
            key,
          ),
        ),
        "no operational quantity reaches this surface at all",
      );
    }
  });
});

test("a counter that is not ready says so rather than being hidden", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mp-not-ready");
    await db.query(
      "update destination_readiness set state='suspended' where supply_id=$1",
      [fixture.supplyId],
    );
    const data = await placesFor(db, fixture);
    assert.equal(data.places[0].state, "not_ready");
    assert.equal(data.places[0].why, "Not handing out Uptick this week.");
  });
});

test("a closed location reads as closed, not as quietly missing", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mp-outage");
    const [supply] = await db.query<{ location_id: string }>(
      "select location_id from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    await db.query(
      "insert into location_outages(id,location_id,reason,owner,opened_by,request_key) values($1,$2,$3,$4,$4,$1)",
      [
        id(),
        supply.location_id,
        "Synthetic counter closed for the day.",
        fixture.actor.id,
      ],
    );
    const data = await placesFor(db, fixture);
    assert.equal(data.places[0].state, "closed");
    assert.match(data.places[0].why, /Closed right now/);
    assert.ok(
      !data.places[0].why.includes("Synthetic counter closed for the day"),
      "the operator's internal outage note is not member copy",
    );
  });
});

test("a member who is not admitted is shown no counter at all", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mp-waitlist");
    /* Admissions are immutable, so this member is created outside the cohort —
       which is exactly the waitlisted member's position. */
    await db.query("insert into customers(id,phone) values($1,'+12125559999')", [
      "mp-waitlist-outsider-customer",
    ]);
    await db.query(
      `insert into uptick_members(
         id,customer_id,home_zip,market_id,state,verified_at,data_kind,age_confirmed_at
       ) values('mp-waitlist-outsider',$1,'10001',$2,'active',now(),'synthetic',now())`,
      ["mp-waitlist-outsider-customer", fixture.marketId],
    );

    const data = await memberPlaces(
      db,
      await credentialFor(db, "mp-waitlist-outsider"),
    );
    assert.equal(data.market?.name, "Synthetic Pilot");
    assert.equal(data.admitted, false);
    assert.deepEqual(
      data.places,
      [],
      "a counter nobody has backed for this member is not theirs to see",
    );
  });
});

test("a member with no Market Cell gets the unavailable state, not an empty map", async () => {
  await withDatabase(async (db) => {
    await db.query("insert into customers(id,phone) values($1,'+12125558888')", [
      "mp-nowhere-customer",
    ]);
    await db.query(
      `insert into uptick_members(
         id,customer_id,home_zip,state,verified_at,data_kind,age_confirmed_at
       ) values('mp-nowhere',$1,'99999','active',now(),'synthetic',now())`,
      ["mp-nowhere-customer"],
    );

    const data = await memberPlaces(
      db,
      await credentialFor(db, "mp-nowhere"),
    );
    assert.equal(data.market, null);
    assert.deepEqual(data.coverage, []);
    assert.equal(data.admitted, false);
    assert.deepEqual(data.places, []);
  });
});

test("a week that has not started is never described as open now", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mp-upcoming");
    /* The fixture starts its run in the current week. Reading the same data a
       week early is exactly the position of a member admitted into an enrolling
       run whose first week is still ahead. */
    const early = new Date(Date.parse(`${fixture.weekKey}T12:00:00Z`) - 5 * 86400000);
    const data = await memberPlaces(
      db,
      await credentialFor(db, fixture.members[0].id),
      early,
    );
    assert.equal(data.weekState, "upcoming");
    assert.equal(data.weekIndex, 1);
    assert.equal(data.places.length, 1);
    assert.ok(
      !data.places.some((place) => /open this week/i.test(place.why)),
      "a counter backing a week that has not begun is not open today",
    );
    assert.match(data.places[0].why, /Backing week 1, which starts/);
  });
});

test("a week that has already passed is not described as open now", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mp-ended");
    const late = new Date(
      Date.parse(`${fixture.weekKey}T12:00:00Z`) + 40 * 86400000,
    );
    const data = await memberPlaces(
      db,
      await credentialFor(db, fixture.members[0].id),
      late,
    );
    assert.equal(data.weekState, "ended");
    assert.ok(!data.places.some((place) => /open this week/i.test(place.why)));
  });
});

test("issued grants are never told to a member as having been picked up", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mp-issued");
    /* Four grants issued against a commitment of four, and nothing redeemed.
       The low-supply state is computed from issue, not redemption, so the
       member copy must not claim anything physically changed hands — Uptick
       cannot prove that, and `redemption_evidence` forbids the column that
       would. */
    await releaseWeeklyBenefits(db, fixture.actor, {
      runId: fixture.runId,
      marketId: fixture.marketId,
      weekKey: fixture.weekKey,
      dataKind: "synthetic",
      requestKey: "mp-issued-release",
      assignments: fixture.members.map((member) => ({
        memberId: member.id,
        supplyId: fixture.supplyId,
      })),
    });
    const [{ n }] = await db.query<{ n: number }>(
      "select count(*)::int n from fulfillment_grants where state='redeemed'",
    );
    assert.equal(n, 0, "nothing has been redeemed");

    const data = await memberPlaces(
      db,
      await credentialFor(db, fixture.members[0].id),
    );
    const why = data.places.map((place) => place.why).join(" ");
    assert.match(why, /reserved for other members/);
    for (const claim of [/picked up/i, /handed over/i, /collected/i])
      assert.ok(
        !claim.test(why),
        `a member must not be told a benefit was ${claim} when only a grant was issued`,
      );
  });
});

test("a home ZIP outside the cell's coverage is stated, not silently ignored", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 4, "mp-coverage");
    await db.query(
      "update uptick_members set home_zip='11222' where id=$1",
      [fixture.members[0].id],
    );
    const data = await placesFor(db, fixture);
    assert.equal(data.homeZip, "11222");
    assert.equal(data.inCoverage, false);
    assert.deepEqual(data.coverage, ["10001"]);
  });
});
