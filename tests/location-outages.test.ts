import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import {
  assertLocationAvailable,
  closeLocationOutage,
  locationAvailable,
  openLocationOutage,
} from "../src/lib/location-outages";
import { claimMemberDrop, networkPass } from "../src/lib/network";
import { recommendPilotAssignments } from "../src/lib/pilot-assignment";
import { loadPilotRun, pilotCapacity } from "../src/lib/pilot-operations";
import {
  issueIncidentRecovery,
  releaseWeeklyBenefits,
  reportMemberFulfillmentIncident,
} from "../src/lib/pilot-promise";
import { decrypt, encrypt, hash, token } from "../src/lib/security";
import { redeemAtPoint } from "../src/lib/tap";
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

async function addDestination(
  db: DB,
  fixture: SyntheticPilotFixture,
  id: string,
) {
  const [source] = await db.query<{
    organization_id: string;
    starts_at: string;
    expires_at: string;
  }>(
    "select organization_id,starts_at,expires_at from network_drop_supplies where id=$1",
    [fixture.supplyId],
  );
  const locationId = `${id}-location`;
  const fallbackId = `${id}-fallback`;
  const pointToken = token();
  await db.query(
    "insert into locations(id,organization_id,name,address,postal_code) values($1,$2,$3,'2 Test Way','10001')",
    [locationId, source.organization_id, `${id} counter`],
  );
  await db.query(
    "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values($1,$2,$3,8)",
    [fixture.marketId, locationId, source.organization_id],
  );
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Synthetic outage item')",
    [id, source.organization_id, locationId],
  );
  await db.query(
    `insert into offer_versions(
      offer_id,version,qualification,reward,terms,starts_at,expires_at,
      limit_mode,quantity
     ) values($1,1,'No purchase required','One free synthetic item',
      'One per admitted member. No purchase required.',$2,$3,'claim',5)`,
    [id, source.starts_at, source.expires_at],
  );
  await db.query(
    `insert into network_drop_supplies(
      id,market_id,organization_id,location_id,offer_id,offer_version,state,
      starts_at,expires_at,inventory_policy,quantity,verification_mode,
      staff_instructions,fallback_plan,approved_by,data_kind
     ) values($1,$2,$3,$4,$1,1,'approved',$5,$6,'claim',5,'staff_tap',
      'Scan the staff QR and hand over the named item.',
      'Use the independently reserved substitute.',$7,'synthetic')`,
    [
      id,
      fixture.marketId,
      source.organization_id,
      locationId,
      source.starts_at,
      source.expires_at,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_terms(
      supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
      funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values($1,'Synthetic outage item',$2,'12 oz','Posted pilot hours',$3,
      $4,$4,'synthetic',$5)`,
    [
      id,
      `${id}-sku`,
      `${id}-primary-stock`,
      source.organization_id,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_fallbacks(
      id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
      usable_capacity,instructions,payer_organization_id,state,approved_by,
      created_by
     ) values($1,$2,'Synthetic sealed substitute',$3,'12 oz',$4,5,
      'Provide the independent substitute and scan the same staff QR.',$5,
      'approved',$6,$6)`,
    [
      fallbackId,
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
      valid_hours_confirmed,qr_rehearsed_at,support_escalation,valid_until,
      updated_by
     ) values($1,$2,$3,'ready',$4,'Synthetic Manager','manager@example.test',
      'backup@example.test',now(),true,true,now(),true,now(),
      'Escalate immediately to the synthetic support owner.',$5,$4)`,
    [
      id,
      source.organization_id,
      locationId,
      fixture.actor.id,
      source.expires_at,
    ],
  );
  await db.query(
    "insert into redemption_points(id,organization_id,location_id,name,exposure,created_by) values($1,$2,$3,'Synthetic outage register','staff',$4)",
    [`${id}-point`, source.organization_id, locationId, fixture.actor.id],
  );
  await db.query(
    "insert into redemption_credentials(id,point_id,public_token,credential_type,version,created_by) values($1,$2,$3,'qr',1,$4)",
    [`${id}-credential`, `${id}-point`, pointToken, fixture.actor.id],
  );
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,1,$4)",
    [fixture.runId, fixture.weekKey, id, fixture.actor.id],
  );
  return { supplyId: id, locationId, fallbackId, pointToken };
}

function releaseInput(
  fixture: SyntheticPilotFixture,
  assignments: { memberId: string; supplyId: string }[],
  requestKey: string,
) {
  return {
    runId: fixture.runId,
    marketId: fixture.marketId,
    weekKey: fixture.weekKey,
    dataKind: "synthetic" as const,
    requestKey,
    overrideReason:
      "Synthetic outage verification fixes the assignment locations explicitly.",
    assignments,
  };
}

async function reportIncident(
  db: DB,
  fixture: SyntheticPilotFixture,
  grantId: string,
  memberId: string,
  key: string,
) {
  return reportMemberFulfillmentIncident(db, memberId, {
    grantId,
    incidentType: "unexpected_closure",
    severity: "high",
    occurredAt: new Date().toISOString(),
    owner: "Uptick member support",
    note: "The staffed destination is unavailable and needs a backed recovery.",
    idempotencyKey: key,
  });
}

function recoveryInput(
  fixture: SyntheticPilotFixture,
  incidentId: string,
  destination: Awaited<ReturnType<typeof addDestination>>,
  remedyType: "same_counter" | "replacement_supply",
) {
  return {
    incidentId,
    remedyType,
    fallbackId: remedyType === "same_counter" ? destination.fallbackId : null,
    replacementSupplyId:
      remedyType === "replacement_supply" ? destination.supplyId : null,
    payerOrganizationId: fixture.actor.organizationId,
    payerEvidence: "Synthetic prepaid outage recovery inventory ledger.",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

async function claimGrant(
  db: DB,
  fixture: SyntheticPilotFixture,
  supplyId: string,
  memberIndex: number,
) {
  const accessToken = token();
  const member = fixture.members[memberIndex];
  await db.query(
    `insert into member_access(
      id,member_id,token_hash,token_encrypted,purpose,expires_at,confirmed_at,
      disclosure,home_zip,age_attested
     ) values($1,$2,$3,$4,'access',now()+interval '30 days',now(),
      'Synthetic location outage verification','10001',true)`,
    [
      `${fixture.runId}-access-${memberIndex}`,
      member.id,
      hash(accessToken),
      encrypt(accessToken),
    ],
  );
  const claim = await claimMemberDrop(db, accessToken, supplyId);
  return decrypt(claim.token_encrypted);
}

test("an outage pauses the destination and queues each affected original grant exactly once", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 3, "location-impact");
    const destination = await addDestination(db, fixture, "location-impact-b");
    const published = await releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseInput(
        fixture,
        [
          { memberId: fixture.members[0].id, supplyId: fixture.supplyId },
          { memberId: fixture.members[1].id, supplyId: destination.supplyId },
          { memberId: fixture.members[2].id, supplyId: fixture.supplyId },
        ],
        "location-impact-release",
      ),
    );
    const grants = new Map(
      published.grants.map((grant) => [grant.member_id, grant]),
    );
    const recoveryIncident = await reportIncident(
      db,
      fixture,
      grants.get(fixture.members[0].id)!.id,
      fixture.members[0].id,
      "location-impact-recovery-incident",
    );
    await issueIncidentRecovery(
      db,
      fixture.actor,
      recoveryInput(
        fixture,
        recoveryIncident,
        destination,
        "replacement_supply",
      ),
    );
    const directPass = await claimGrant(db, fixture, destination.supplyId, 1);

    const outageRequest = {
      locationId: destination.locationId,
      reason: "The entire staffed destination is temporarily unavailable.",
      owner: "Uptick outage support",
      requestKey: "location-impact-outage",
    };
    const outageId = await openLocationOutage(db, fixture.actor, outageRequest);
    assert.equal(
      await openLocationOutage(db, fixture.actor, outageRequest),
      outageId,
    );
    await assert.rejects(
      openLocationOutage(db, fixture.actor, {
        ...outageRequest,
        reason: "A replay tried to replace the original outage evidence.",
      }),
      /different details/i,
    );

    assert.deepEqual(
      (
        await db.query<{ grant_id: string }>(
          "select grant_id from location_outage_obligations where outage_id=$1 order by grant_id",
          [outageId],
        )
      ).map((row) => row.grant_id),
      [
        grants.get(fixture.members[0].id)!.id,
        grants.get(fixture.members[1].id)!.id,
      ].sort(),
    );
    assert.deepEqual(
      await db.query(
        `select s.state supply_state,d.state readiness_state,ml.active
         from network_drop_supplies s
         join destination_readiness d on d.supply_id=s.id
         join market_locations ml on ml.market_id=s.market_id and ml.location_id=s.location_id
         where s.id=$1`,
        [destination.supplyId],
      ),
      [{ supply_state: "paused", readiness_state: "suspended", active: false }],
    );
    assert.equal(await locationAvailable(db, destination.locationId), false);
    await assert.rejects(
      assertLocationAvailable(db, destination.locationId),
      /do not travel there/i,
    );
    assert.equal(
      (await networkPass(db, directPass))?.destinationAvailable,
      false,
    );
    await assert.rejects(
      redeemAtPoint(db, directPass, { pointToken: destination.pointToken }),
      /destination is unavailable/i,
    );

    const plan = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );
    assert.equal(
      plan.members.every(
        (member) =>
          member.candidates.find(
            (candidate) => candidate.supplyId === destination.supplyId,
          )?.reason.suitable === false,
      ),
      true,
    );
    assert.equal(
      plan.assignments.some(
        (assignment) => assignment.supplyId === destination.supplyId,
      ),
      false,
    );
    const run = await loadPilotRun(db, fixture.runId);
    assert.equal(
      (await pilotCapacity(db, run)).supplies.find(
        (supply) => supply.supply_id === destination.supplyId,
      )?.quantity,
      0,
    );

    const sameCounterIncident = await reportIncident(
      db,
      fixture,
      grants.get(fixture.members[1].id)!.id,
      fixture.members[1].id,
      "location-impact-same-counter-incident",
    );
    await assert.rejects(
      issueIncidentRecovery(
        db,
        fixture.actor,
        recoveryInput(
          fixture,
          sameCounterIncident,
          destination,
          "same_counter",
        ),
      ),
      /not independently ready and funded/i,
    );
    const replacementIncident = await reportIncident(
      db,
      fixture,
      grants.get(fixture.members[2].id)!.id,
      fixture.members[2].id,
      "location-impact-replacement-incident",
    );
    await assert.rejects(
      issueIncidentRecovery(
        db,
        fixture.actor,
        recoveryInput(
          fixture,
          replacementIncident,
          destination,
          "replacement_supply",
        ),
      ),
      /ready replacement supply/i,
    );
    assert.equal((await db.query("select * from recovery_grants")).length, 1);

    await closeLocationOutage(db, fixture.actor, {
      outageId,
      evidence:
        "The outage review is closed; stock and staff readiness still require reapproval.",
    });
    assert.equal(await locationAvailable(db, destination.locationId), false);
    assert.deepEqual(
      await db.query(
        `select s.state supply_state,d.state readiness_state,ml.active
         from network_drop_supplies s
         join destination_readiness d on d.supply_id=s.id
         join market_locations ml on ml.market_id=s.market_id and ml.location_id=s.location_id
         where s.id=$1`,
        [destination.supplyId],
      ),
      [{ supply_state: "paused", readiness_state: "suspended", active: false }],
    );
  });
});

test("an unavailable location has zero capacity and cannot receive a new weekly release", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 1, "location-before-release");
    const [supply] = await db.query<{ location_id: string }>(
      "select location_id from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    const outageId = await openLocationOutage(db, fixture.actor, {
      locationId: supply.location_id,
      reason: "The destination closed before the reviewed weekly release.",
      owner: "Uptick outage support",
      requestKey: "location-before-release-outage",
    });
    const run = await loadPilotRun(db, fixture.runId);
    const capacity = await pilotCapacity(db, run);
    assert.equal(
      capacity.supplies.find((row) => row.supply_id === fixture.supplyId)
        ?.quantity,
      0,
    );
    const plan = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );
    assert.deepEqual(plan.assignments, []);
    assert.deepEqual(plan.unassigned, [fixture.members[0].id]);
    await assert.rejects(
      releaseWeeklyBenefits(
        db,
        fixture.actor,
        releaseInput(
          fixture,
          [
            {
              memberId: fixture.members[0].id,
              supplyId: fixture.supplyId,
            },
          ],
          "location-before-release-attempt",
        ),
      ),
      /suitable backed destination|fully rehearsed pilot promise/i,
    );
    assert.equal((await db.query("select * from weekly_releases")).length, 0);
    assert.equal(
      (await db.query("select * from fulfillment_grants")).length,
      0,
    );

    await closeLocationOutage(db, fixture.actor, {
      outageId,
      evidence:
        "The closure ended, but readiness and supply approval need fresh evidence.",
    });
    assert.equal(await locationAvailable(db, supply.location_id), false);
  });
});

test("release and outage transactions serialize to a fully queued or fully blocked final state", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 1, "location-race");
    const [supply] = await db.query<{ location_id: string }>(
      "select location_id from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    const release = releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseInput(
        fixture,
        [
          {
            memberId: fixture.members[0].id,
            supplyId: fixture.supplyId,
          },
        ],
        "location-race-release",
      ),
    );
    const outage = openLocationOutage(db, fixture.actor, {
      locationId: supply.location_id,
      reason: "A destination outage raced the reviewed release transaction.",
      owner: "Uptick outage support",
      requestKey: "location-race-outage",
    });
    const [releaseResult, outageResult] = await Promise.allSettled([
      release,
      outage,
    ]);
    assert.equal(outageResult.status, "fulfilled");
    const [{ outages, releases, grants, obligations }] = await db.query<{
      outages: number;
      releases: number;
      grants: number;
      obligations: number;
    }>(
      `select
        (select count(*)::int from location_outages where closed_at is null) outages,
        (select count(*)::int from weekly_releases) releases,
        (select count(*)::int from fulfillment_grants) grants,
        (select count(*)::int from location_outage_obligations) obligations`,
    );
    assert.equal(outages, 1);
    assert.equal(releases, grants);
    assert.equal(obligations, grants);
    assert.ok(
      (releaseResult.status === "fulfilled" && grants === 1) ||
        (releaseResult.status === "rejected" && grants === 0),
    );
    assert.deepEqual(
      await db.query(
        `select s.state supply_state,d.state readiness_state,ml.active
         from network_drop_supplies s
         join destination_readiness d on d.supply_id=s.id
         join market_locations ml on ml.market_id=s.market_id and ml.location_id=s.location_id
         where s.id=$1`,
        [fixture.supplyId],
      ),
      [{ supply_state: "paused", readiness_state: "suspended", active: false }],
    );
  });
});
