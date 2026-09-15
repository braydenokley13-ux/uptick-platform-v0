import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import {
  createPilotRun,
  loadPilotRun,
  pilotCapacity,
} from "../src/lib/pilot-operations";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "../scripts/verify-postgres-pilot";

process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";

function weekAfter(firstWeek: string, index: number) {
  return new Date(Date.parse(`${firstWeek}T12:00:00Z`) + index * 7 * 86400000)
    .toISOString()
    .slice(0, 10);
}

async function addWeekSupply(
  db: DB,
  fixture: SyntheticPilotFixture,
  index: number,
  committedQuantity: number,
  physicalQuantity = committedQuantity,
) {
  const supplyId = `${fixture.runId}-week-${index}-supply`;
  const weekKey = weekAfter(fixture.weekKey, index);
  const [source] = await db.query<{
    organization_id: string;
    location_id: string;
    starts_at: string;
    expires_at: string;
  }>(
    "select organization_id,location_id,starts_at,expires_at from network_drop_supplies where id=$1",
    [fixture.supplyId],
  );
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Synthetic capacity item')",
    [supplyId, source.organization_id, source.location_id],
  );
  await db.query(
    `insert into offer_versions(
      offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity
     ) values($1,1,'No purchase required','One free synthetic item',
      'One per admitted synthetic member. No purchase required.',$2,$3,'claim',$4)`,
    [supplyId, source.starts_at, source.expires_at, physicalQuantity],
  );
  await db.query(
    `insert into network_drop_supplies(
      id,market_id,organization_id,location_id,offer_id,offer_version,state,
      starts_at,expires_at,inventory_policy,quantity,verification_mode,
      staff_instructions,fallback_plan,approved_by,data_kind
     ) values($1,$2,$3,$4,$1,1,'approved',$5,$6,'claim',$7,'staff_tap',
      'Scan the staff QR and hand over the named item.',
      'Use an independently backed substitute.',$8,'synthetic')`,
    [
      supplyId,
      fixture.marketId,
      source.organization_id,
      source.location_id,
      source.starts_at,
      source.expires_at,
      physicalQuantity,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_terms(
      supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
      funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values($1,'Synthetic capacity item',$2,'12 oz','Posted pilot hours',$3,
      $4,$4,'synthetic',$5)`,
    [
      supplyId,
      `${supplyId}-sku`,
      `${supplyId}-primary-stock`,
      source.organization_id,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_fallbacks(
      id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
      usable_capacity,instructions,payer_organization_id,state,approved_by,
      created_by
     ) values($1,$2,'Synthetic sealed substitute',$3,'12 oz',$4,$5,
      'Provide the independent substitute and scan the staff QR.',$6,
      'approved',$7,$7)`,
    [
      `${supplyId}-fallback`,
      supplyId,
      `${supplyId}-fallback-sku`,
      `${supplyId}-fallback-stock`,
      physicalQuantity,
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
     ) values($1,$2,$3,'ready',$4,'Synthetic Manager',
      'manager@example.test','backup@example.test',now(),true,true,now(),true,
      now(),'Escalate immediately to the synthetic support owner.',$5,$4)`,
    [
      supplyId,
      source.organization_id,
      source.location_id,
      fixture.actor.id,
      source.expires_at,
    ],
  );
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,$4,$5)",
    [fixture.runId, weekKey, supplyId, committedQuantity, fixture.actor.id],
  );
  return { supplyId, weekKey };
}

async function addAdjustment(
  db: DB,
  supplyId: string,
  delta: number,
  suffix: string,
) {
  await db.query(
    "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values($1,$2,$3,$4,'capacity-test')",
    [
      `${supplyId}-${suffix}`,
      supplyId,
      delta,
      "Synthetic reconciliation fact for capacity regression coverage.",
    ],
  );
}

async function addExternalActiveClaims(
  db: DB,
  fixture: SyntheticPilotFixture,
  supplyId: string,
  count: number,
) {
  const [supply] = await db.query<{
    offer_id: string;
    organization_id: string;
  }>("select offer_id,organization_id from network_drop_supplies where id=$1", [
    supplyId,
  ]);
  for (let index = 0; index < count; index++) {
    const stem = `${fixture.runId}-outside-${index}`;
    const customerId = `${stem}-customer`;
    const memberId = `${stem}-member`;
    const allocationId = `${stem}-allocation`;
    const claimId = `${stem}-claim`;
    await db.query("insert into customers(id,phone) values($1,$2)", [
      customerId,
      `+1917555${String(index).padStart(4, "0")}`,
    ]);
    await db.query(
      "insert into uptick_members(id,customer_id,home_zip,market_id,state,verified_at,data_kind,age_confirmed_at) values($1,$2,'10001',$3,'active',now(),'synthetic',now())",
      [memberId, customerId, fixture.marketId],
    );
    await db.query(
      "insert into member_allocations(id,member_id,market_id,week_key) values($1,$2,$3,$4)",
      [allocationId, memberId, fixture.marketId, fixture.weekKey],
    );
    await db.query(
      "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values($1,$2,$3,1,'{}')",
      [allocationId, supplyId, fixture.marketId],
    );
    await db.query(
      `insert into claims(
        id,customer_id,organization_id,offer_id,offer_version,token_hash,
        token_encrypted,snapshot,state
       ) values($1,$2,$3,$4,1,$5,$5,
        jsonb_build_object('expires_at',now()+interval '7 days'),'active')`,
      [
        claimId,
        customerId,
        supply.organization_id,
        supply.offer_id,
        `${stem}-token`,
      ],
    );
    await db.query(
      `insert into member_claims(
        claim_id,member_id,customer_id,organization_id,supply_id,offer_id,
        allocation_id,reserved_until
       ) values($1,$2,$3,$4,$5,$6,$7,now()+interval '7 days')`,
      [
        claimId,
        memberId,
        customerId,
        supply.organization_id,
        supplyId,
        supply.offer_id,
        allocationId,
      ],
    );
  }
}

async function addReplacementRecovery(
  db: DB,
  fixture: SyntheticPilotFixture,
  replacementSupplyId: string,
) {
  const member = fixture.members[0];
  const [source] = await db.query<{
    organization_id: string;
    location_id: string;
    offer_id: string;
  }>(
    "select organization_id,location_id,offer_id from network_drop_supplies where id=$1",
    [fixture.supplyId],
  );
  const [replacement] = await db.query<{
    organization_id: string;
    location_id: string;
  }>(
    "select organization_id,location_id from network_drop_supplies where id=$1",
    [replacementSupplyId],
  );
  const allocationId = `${fixture.runId}-recovery-source-allocation`;
  const releaseId = `${fixture.runId}-recovery-source-release`;
  const grantId = `${fixture.runId}-recovery-source-grant`;
  const incidentId = `${fixture.runId}-recovery-incident`;
  await db.query(
    `insert into weekly_releases(
      id,run_id,market_id,week_key,state,data_kind,member_count,reviewed_by,
      request_key,request_fingerprint
     ) values($1,$2,$3,$4,'published','synthetic',1,$5,$1,$1)`,
    [
      releaseId,
      fixture.runId,
      fixture.marketId,
      fixture.weekKey,
      fixture.actor.id,
    ],
  );
  await db.query(
    "insert into member_allocations(id,member_id,market_id,week_key) values($1,$2,$3,$4)",
    [allocationId, member.id, fixture.marketId, fixture.weekKey],
  );
  await db.query(
    "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values($1,$2,$3,1,'{}')",
    [allocationId, fixture.supplyId, fixture.marketId],
  );
  await db.query(
    `insert into fulfillment_grants(
      id,release_id,allocation_id,member_id,market_id,week_key,supply_id,
      organization_id,location_id,offer_id,offer_version,member_snapshot,
      expires_at,data_kind
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'{}',now()+interval '7 days','synthetic')`,
    [
      grantId,
      releaseId,
      allocationId,
      member.id,
      fixture.marketId,
      fixture.weekKey,
      fixture.supplyId,
      source.organization_id,
      source.location_id,
      source.offer_id,
    ],
  );
  await db.query(
    `insert into fulfillment_incidents(
      id,grant_id,member_id,supply_id,location_id,incident_type,severity,
      occurred_at,owner,report_note,idempotency_key,created_by
     ) values($1,$2,$3,$4,$5,'out_of_stock','high',now(),'Support',
      'Synthetic external recovery obligation.',$1,$6)`,
    [
      incidentId,
      grantId,
      member.id,
      fixture.supplyId,
      source.location_id,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into recovery_grants(
      id,incident_id,original_grant_id,member_id,remedy_type,
      replacement_supply_id,target_organization_id,target_location_id,
      payer_organization_id,payer_evidence,member_snapshot,expires_at,
      data_kind,issued_by
     ) values($1,$2,$3,$4,'replacement_supply',$5,$6,$7,$6,
      'Synthetic recovery funding evidence.','{}',now()+interval '1 day',
      'synthetic',$8)`,
    [
      `${fixture.runId}-replacement-recovery`,
      incidentId,
      grantId,
      member.id,
      replacementSupplyId,
      replacement.organization_id,
      replacement.location_id,
      fixture.actor.id,
    ],
  );
}

test("four-week capacity uses physical stock and outside obligations without double counting commitments", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 150, "capacity-backing");
    const supplies = [
      { supplyId: fixture.supplyId, weekKey: fixture.weekKey },
      await addWeekSupply(db, fixture, 1, 150),
      await addWeekSupply(db, fixture, 2, 150),
      await addWeekSupply(db, fixture, 3, 150),
    ];
    const run = await loadPilotRun(db, fixture.runId);

    for (const supply of supplies)
      await addAdjustment(db, supply.supplyId, -50, "physical-shortfall");
    let result = await pilotCapacity(db, run);
    assert.deepEqual(
      result.weeks.map((week) => week.capacity),
      [100, 100, 100, 100],
      "150 committed units backed by only 100 physical units must support 100 members in every week",
    );
    assert.equal(result.capacity, 100);

    for (const supply of supplies)
      await addAdjustment(db, supply.supplyId, 100, "stock-increase");
    result = await pilotCapacity(db, run);
    assert.deepEqual(
      result.weeks.map((week) => week.capacity),
      [150, 150, 150, 150],
      "additional physical stock cannot expand a 150-unit pilot commitment",
    );

    for (const supply of supplies)
      await addAdjustment(db, supply.supplyId, -50, "return-to-commitment");
    await addExternalActiveClaims(db, fixture, supplies[1].supplyId, 20);
    await addReplacementRecovery(db, fixture, supplies[2].supplyId);
    result = await pilotCapacity(db, run);
    assert.deepEqual(
      result.weeks.map((week) => week.capacity),
      [150, 130, 149, 150],
      "active outside claims and replacement recoveries must consume physical backing while an issued pilot grant remains protected inside its commitment",
    );
    assert.equal(result.capacity, 130);
  } finally {
    await db.close?.();
  }
});

test("the smallest backed week controls enrollment and pilot runs cannot exceed 200 members", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 200, "capacity-smallest");
    const supplies = [
      { supplyId: fixture.supplyId, weekKey: fixture.weekKey },
      await addWeekSupply(db, fixture, 1, 160),
      await addWeekSupply(db, fixture, 2, 149),
      await addWeekSupply(db, fixture, 3, 170),
    ];
    await addAdjustment(db, supplies[0].supplyId, -20, "smallest-week-shape");

    const result = await pilotCapacity(
      db,
      await loadPilotRun(db, fixture.runId),
    );
    assert.deepEqual(
      result.weeks.map((week) => week.capacity),
      [180, 160, 149, 170],
    );
    assert.equal(
      result.capacity,
      149,
      "the 149-unit week sets cohort capacity",
    );

    await assert.rejects(
      createPilotRun(db, fixture.actor, {
        marketId: fixture.marketId,
        name: "Invalid 201-member pilot",
        startsOn: weekAfter(fixture.weekKey, 8),
        dataKind: "synthetic",
        targetMembers: 201,
        hardCap: 201,
        operatorOwner: "Operator",
        supportOwner: "Support",
        backupSupportOwner: "Backup",
        budget: 0,
      }),
      "the public pilot-run boundary must reject a 201-member cohort",
    );
  } finally {
    await db.close?.();
  }
});
