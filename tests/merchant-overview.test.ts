/* What a merchant is allowed to be told.

   These tests exist because the previous version of this surface made three
   claims the data did not support: that a recorded redemption was a physical
   handoff, that a make-good which merely existed had made the member whole,
   and that the newest supply row was this week's counter instruction. Each
   test below pins one of those down. */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import { merchantOverview } from "../src/lib/merchant-overview";
import { amendPilotSupply } from "../src/lib/pilot-supply-amendments";
import {
  issueIncidentRecovery,
  releaseWeeklyBenefits,
  reportMemberFulfillmentIncident,
} from "../src/lib/pilot-promise";
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

/** Releases week one and returns the grants it issued. */
async function releaseWeekOne(
  db: DB,
  fixture: SyntheticPilotFixture,
  prefix: string,
  dataKind: "synthetic" | "internal" | "demo" = "synthetic",
) {
  return releaseWeeklyBenefits(db, fixture.actor, {
    runId: fixture.runId,
    marketId: fixture.marketId,
    weekKey: fixture.weekKey,
    dataKind,
    requestKey: `${prefix}-release`,
    assignments: fixture.members.map((member) => ({
      memberId: member.id,
      supplyId: fixture.supplyId,
    })),
  });
}

/** Marks a grant redeemed the way the counter flow does, without the QR
    machinery — these tests are about what the merchant is told, not about how
    the redemption was captured. */
async function markRedeemed(db: DB, grantId: string) {
  await db.query(
    `update fulfillment_grants
        set state='redeemed',claimed_at=coalesce(claimed_at,now()),redeemed_at=now()
      where id=$1`,
    [grantId],
  );
}

async function overviewFor(db: DB, fixture: SyntheticPilotFixture) {
  return merchantOverview(db, fixture.actor);
}

test("merchant redemption figures are named for the recording, never for a handoff", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 2, "mo-recorded");
    const released = await releaseWeekOne(db, fixture, "mo-recorded");
    await markRedeemed(db, released.grants[0].id);

    const data = await overviewFor(db, fixture);
    assert.equal(data.totals?.issued, 2);
    assert.equal(data.totals?.recorded, 1);
    /* Nothing was scanned at a staff-held device, so the stronger figure stays
       at zero rather than inheriting the weaker one. */
    assert.equal(data.totals?.staffVerified, 0);
    assert.equal(data.totals?.redemptionRate, 50);
    /* The shape itself must not carry a field that invites the old claim. */
    assert.ok(!("redeemed" in (data.totals as object)));
  });
});

test("a merchant's numbers never mix two classifications", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 2, "mo-classified");
    const released = await releaseWeekOne(db, fixture, "mo-classified");
    await markRedeemed(db, released.grants[0].id);

    /* This run is synthetic, so the synthetic activity under it is exactly
       what it should report — a rehearsal is supposed to show its own numbers. */
    const data = await overviewFor(db, fixture);
    assert.equal(data.run?.data_kind, "synthetic");
    assert.equal(data.totals?.issued, 2);
    assert.equal(data.totals?.recorded, 1);

    /* The protection that matters: a release cannot introduce a different
       classification into an existing run, so an internal commissioning record
       can never land inside a real pilot's merchant totals. */
    await assert.rejects(
      releaseWeeklyBenefits(db, fixture.actor, {
        runId: fixture.runId,
        marketId: fixture.marketId,
        weekKey: addDays(fixture.weekKey, 7),
        dataKind: "internal",
        requestKey: "mo-classified-internal",
        assignments: [
          { memberId: fixture.members[0].id, supplyId: fixture.supplyId },
        ],
      }),
    );
  });
});

test("a make-good that expired unused is not made good and leaves the incident open", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 1, "mo-expired");
    const released = await releaseWeekOne(db, fixture, "mo-expired");
    const grant = released.grants[0];
    const incidentId = await reportMemberFulfillmentIncident(
      db,
      fixture.members[0].id,
      {
        grantId: grant.id,
        incidentType: "out_of_stock",
        severity: "high",
        occurredAt: new Date().toISOString(),
        owner: "Uptick member support",
        note: "The promised item was unavailable at the staffed counter.",
        idempotencyKey: "mo-expired-incident",
      },
    );

    /* An expiry in the past cannot be produced through the issuing API, and
       an issued recovery is immutable by trigger, so the lapsed window is
       written directly. Everything else matches a real make-good. */
    await db.query(
      `insert into recovery_grants(
        id,incident_id,original_grant_id,member_id,remedy_type,fallback_id,
        target_organization_id,target_location_id,payer_organization_id,
        payer_evidence,member_snapshot,issued_at,expires_at,data_kind,issued_by
       ) select $1,$2,$3,$4,'same_counter',$5,g.organization_id,g.location_id,
         g.organization_id,'Synthetic prepaid fallback inventory ledger.',
         '{}'::jsonb,now()-interval '2 hours',now()-interval '1 hour','synthetic',$6
         from fulfillment_grants g where g.id=$3`,
      [
        "mo-expired-recovery",
        incidentId,
        grant.id,
        fixture.members[0].id,
        fixture.fallbackId,
        fixture.actor.id,
      ],
    );

    const data = await overviewFor(db, fixture);
    const [incident] = data.incidents;
    assert.equal(incident.recoveryState, "expired");
    assert.equal(
      incident.madeGood,
      false,
      "an expired make-good must never read as made good",
    );
    assert.equal(
      incident.unresolved,
      true,
      "an expired make-good leaves the member's problem open",
    );
    assert.equal(data.totals?.recoveriesCompleted, 0);
    assert.equal(data.totals?.recoveriesExpired, 1);
    assert.equal(data.totals?.unresolvedIncidents, 1);
  });
});

test("only a redeemed make-good counts as completed", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 1, "mo-completed");
    const released = await releaseWeekOne(db, fixture, "mo-completed");
    const incidentId = await reportMemberFulfillmentIncident(
      db,
      fixture.members[0].id,
      {
        grantId: released.grants[0].id,
        incidentType: "out_of_stock",
        severity: "high",
        occurredAt: new Date().toISOString(),
        owner: "Uptick member support",
        note: "The promised item was unavailable at the staffed counter.",
        idempotencyKey: "mo-completed-incident",
      },
    );
    const [readiness] = await db.query<{ valid_until: string | Date }>(
      "select valid_until from destination_readiness where supply_id=$1",
      [fixture.supplyId],
    );
    const recoveryId = await issueIncidentRecovery(db, fixture.actor, {
      incidentId,
      remedyType: "same_counter",
      fallbackId: fixture.fallbackId,
      replacementSupplyId: null,
      payerOrganizationId: fixture.actor.organizationId,
      payerEvidence: "Synthetic prepaid fallback inventory ledger.",
      expiresAt: new Date(
        Math.min(
          Date.now() + 60 * 60 * 1000,
          new Date(readiness.valid_until).getTime() - 60_000,
        ),
      ).toISOString(),
    });

    /* Live but unused is not yet made good. */
    const pending = await overviewFor(db, fixture);
    assert.equal(pending.incidents[0].recoveryState, "active");
    assert.equal(pending.incidents[0].madeGood, false);
    assert.equal(pending.totals?.recoveriesActive, 1);
    assert.equal(pending.totals?.recoveriesCompleted, 0);
    assert.equal(pending.totals?.unresolvedIncidents, 1);

    /* Redeeming it is the single event that makes the claim true. */
    await db.query(
      "update recovery_grants set state='redeemed',redeemed_at=now() where id=$1",
      [recoveryId],
    );
    const done = await overviewFor(db, fixture);
    assert.equal(done.incidents[0].recoveryState, "completed");
    assert.equal(done.incidents[0].madeGood, true);
    assert.equal(done.totals?.recoveriesCompleted, 1);
    assert.equal(done.totals?.unresolvedIncidents, 0);
  });
});

test("this week's commitment is the week's effective supply, not the newest row", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 2, "mo-effective");
    const [source] = await db.query<{
      organization_id: string;
      location_id: string;
      starts_at: string;
      expires_at: string;
    }>(
      "select organization_id,location_id,starts_at,expires_at from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    const futureSupplyId = "mo-effective-future";
    const futureWeek = addDays(fixture.weekKey, 7);

    /* A supply created later, committed to a later week. Ordering supply rows
       by creation date would surface this one as today's instruction. */
    await db.query(
      "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Synthetic future-week item')",
      [futureSupplyId, source.organization_id, source.location_id],
    );
    await db.query(
      `insert into offer_versions(
        offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity
       ) values($1,1,'No purchase required','One free synthetic future item',
        'One per admitted member. No purchase required.',$2,$3,'claim',2)`,
      [futureSupplyId, source.starts_at, source.expires_at],
    );
    await db.query(
      `insert into network_drop_supplies(
        id,market_id,organization_id,location_id,offer_id,offer_version,state,
        starts_at,expires_at,inventory_policy,quantity,verification_mode,
        staff_instructions,fallback_plan,approved_by,data_kind
       ) values($1,$2,$3,$4,$1,1,'approved',$5,$6,'claim',2,'staff_tap',
        'Scan the staff QR and hand over the named item.',
        'Use the independently reserved substitute.',$7,'synthetic')`,
      [
        futureSupplyId,
        fixture.marketId,
        source.organization_id,
        source.location_id,
        source.starts_at,
        source.expires_at,
        fixture.actor.id,
      ],
    );
    await db.query(
      `insert into pilot_supply_terms(
        supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
        funder_organization_id,fulfiller_organization_id,data_kind,created_by
       ) values($1,'NEXT WEEK ITEM',$2,'16 oz','Posted pilot hours',$3,$4,$4,'synthetic',$5)`,
      [
        futureSupplyId,
        `${futureSupplyId}-sku`,
        `${futureSupplyId}-primary-stock`,
        source.organization_id,
        fixture.actor.id,
      ],
    );
    await db.query(
      "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,2,$4)",
      [fixture.runId, futureWeek, futureSupplyId, fixture.actor.id],
    );

    const data = await overviewFor(db, fixture);
    assert.equal(
      data.commitment?.week_key,
      fixture.weekKey,
      "the commitment shown must be scoped to the week being shown",
    );
    assert.notEqual(
      data.commitment?.exact_item,
      "NEXT WEEK ITEM",
      "a future week's item must never become today's counter instruction",
    );
  });
});

test("a future-week amendment does not rewrite this week's counter instruction", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 2, "mo-amended");
    const before = await overviewFor(db, fixture);
    const originalItem = before.commitment?.exact_item;
    assert.ok(originalItem);

    const futureWeek = addDays(fixture.weekKey, 7);
    const [source] = await db.query<{
      organization_id: string;
      location_id: string;
      starts_at: string;
      expires_at: string;
    }>(
      "select organization_id,location_id,starts_at,expires_at from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    for (const id of ["mo-amended-first", "mo-amended-replacement"]) {
      await db.query(
        "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Synthetic future-week item')",
        [id, source.organization_id, source.location_id],
      );
      await db.query(
        `insert into offer_versions(
          offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity
         ) values($1,1,'No purchase required','One free synthetic future item',
          'One per admitted member. No purchase required.',$2,$3,'claim',2)`,
        [id, source.starts_at, source.expires_at],
      );
      await db.query(
        `insert into network_drop_supplies(
          id,market_id,organization_id,location_id,offer_id,offer_version,state,
          starts_at,expires_at,inventory_policy,quantity,verification_mode,
          staff_instructions,fallback_plan,approved_by,data_kind
         ) values($1,$2,$3,$4,$1,1,'approved',$5,$6,'claim',2,'staff_tap',
          'Scan the staff QR and hand over the named item.',
          'Use the independently reserved substitute.',$7,'synthetic')`,
        [
          id,
          fixture.marketId,
          source.organization_id,
          source.location_id,
          source.starts_at,
          source.expires_at,
          fixture.actor.id,
        ],
      );
      await db.query(
        `insert into pilot_supply_terms(
          supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
          funder_organization_id,fulfiller_organization_id,data_kind,created_by
         ) values($1,$2,$3,'16 oz','Posted pilot hours',$4,$5,$5,'synthetic',$6)`,
        [
          id,
          `AMENDED ${id}`,
          `${id}-sku`,
          `${id}-primary-stock`,
          source.organization_id,
          fixture.actor.id,
        ],
      );
      await db.query(
        `insert into pilot_supply_fallbacks(
          id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
          usable_capacity,instructions,payer_organization_id,state,approved_by,created_by
         ) values($1,$2,'Synthetic sealed substitute',$3,'16 oz',$4,2,
          'Provide the independent substitute and scan the same staff QR.',$5,
          'approved',$6,$6)`,
        [
          `${id}-fallback`,
          id,
          `${id}-fallback-sku`,
          `${id}-sealed-stock`,
          source.organization_id,
          fixture.actor.id,
        ],
      );
      await db.query(
        `insert into destination_readiness(
          supply_id,organization_id,location_id,state,owner_approved_by,
          primary_manager,primary_contact,backup_contact,stock_confirmed_at,
          exact_item_confirmed,staff_instructions_confirmed,shifts_briefed_at,
          valid_hours_confirmed,qr_rehearsed_at,support_escalation,valid_until,updated_by
         ) values($1,$2,$3,'ready',$4,'Synthetic Manager','manager@example.test',
          'backup@example.test',now(),true,true,now(),true,now(),
          'Escalate immediately to the synthetic support owner.',$5,$4)`,
        [
          id,
          source.organization_id,
          source.location_id,
          fixture.actor.id,
          source.expires_at,
        ],
      );
    }
    await db.query(
      "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,2,$4)",
      [fixture.runId, futureWeek, "mo-amended-first", fixture.actor.id],
    );
    await amendPilotSupply(db, fixture.actor, {
      runId: fixture.runId,
      weekKey: futureWeek,
      previousSupplyId: "mo-amended-first",
      replacementSupplyId: "mo-amended-replacement",
      quantity: 2,
      reason:
        "The original future-week item is no longer operationally available.",
      payerOrganizationId: fixture.actor.organizationId,
      financialEvidence:
        "The existing synthetic payer remains accountable and no invoice is rewritten.",
      programImplications:
        "No paid placement protection applies to this synthetic amendment.",
      protectionReview:
        "No commercial exclusivity or protection term is affected by this synthetic amendment.",
      requestKey: "mo-amended-amendment",
    });

    const after = await overviewFor(db, fixture);
    assert.equal(
      after.commitment?.exact_item,
      originalItem,
      "amending a later week must not change what the counter does today",
    );
    assert.equal(after.commitment?.week_key, fixture.weekKey);
  });
});

test("a completed pilot still shows the merchant their final results", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 2, "mo-complete");
    const released = await releaseWeekOne(db, fixture, "mo-complete");
    await markRedeemed(db, released.grants[0].id);

    await db.query("update pilot_runs set state='complete' where id=$1", [
      fixture.runId,
    ]);

    const data = await overviewFor(db, fixture);
    assert.ok(
      data.run,
      "a finished pilot must not disappear from the merchant's dashboard",
    );
    assert.equal(data.completed, true);
    assert.equal(data.totals?.issued, 2);
    assert.equal(data.totals?.recorded, 1);
    assert.equal(
      data.activeWeek,
      null,
      "a finished pilot has no current week to keep a counter ready for",
    );
  });
});
