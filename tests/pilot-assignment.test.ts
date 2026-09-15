import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import {
  matchPilotDestinations,
  recommendPilotAssignments,
  saveAssignmentReview,
  type AssignmentReason,
} from "../src/lib/pilot-assignment";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import { marketWeekWindow } from "../src/lib/network";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "../scripts/verify-postgres-pilot";

process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";

function reason(suitable: boolean, label: string): AssignmentReason {
  return {
    suitable,
    unknownSuitability: false,
    explanation: label,
    homeZipMatch: false,
    workZipMatch: false,
    driveMinutes: 5,
    recentDestinationCount: 0,
    acquisitionPartner: null,
    reviewId: null,
    policyId: null,
    rotationKey: label,
  };
}

function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

async function addDestination(
  db: DB,
  fixture: SyntheticPilotFixture,
  options: {
    id: string;
    weekKey?: string;
    quantity?: number;
    postalCode?: string | null;
    driveMinutes?: number | null;
    existingLocation?: boolean;
  },
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
  const locationId = options.existingLocation
    ? source.location_id
    : `${options.id}-location`;
  const quantity = options.quantity ?? fixture.members.length;
  if (!options.existingLocation) {
    await db.query(
      "insert into locations(id,organization_id,name,address,postal_code) values($1,$2,$3,'2 Test Way',$4)",
      [
        locationId,
        source.organization_id,
        `${options.id} counter`,
        options.postalCode === undefined ? "10002" : options.postalCode,
      ],
    );
    await db.query(
      "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values($1,$2,$3,$4)",
      [
        fixture.marketId,
        locationId,
        source.organization_id,
        options.driveMinutes === undefined ? 8 : options.driveMinutes,
      ],
    );
  }
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Synthetic assignment item')",
    [options.id, source.organization_id, locationId],
  );
  await db.query(
    `insert into offer_versions(
      offer_id,version,qualification,reward,terms,starts_at,expires_at,
      limit_mode,quantity
     ) values($1,1,'No purchase required','One free synthetic item',
      'One per admitted member. No purchase required.',$2,$3,'claim',$4)`,
    [options.id, source.starts_at, source.expires_at, quantity],
  );
  await db.query(
    `insert into network_drop_supplies(
      id,market_id,organization_id,location_id,offer_id,offer_version,state,
      starts_at,expires_at,inventory_policy,quantity,verification_mode,
      staff_instructions,fallback_plan,approved_by,data_kind
     ) values($1,$2,$3,$4,$1,1,'approved',$5,$6,'claim',$7,'staff_tap',
      'Scan the staff QR and hand over the named item.',
      'Use the independently reserved substitute.',$8,'synthetic')`,
    [
      options.id,
      fixture.marketId,
      source.organization_id,
      locationId,
      source.starts_at,
      source.expires_at,
      quantity,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_terms(
      supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
      funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values($1,'Synthetic assignment item',$2,'12 oz','Posted pilot hours',$3,
      $4,$4,'synthetic',$5)`,
    [
      options.id,
      `${options.id}-sku`,
      `${options.id}-primary-stock`,
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
      'Provide the independent substitute and scan the same staff QR.',$6,
      'approved',$7,$7)`,
    [
      `${options.id}-fallback`,
      options.id,
      `${options.id}-fallback-sku`,
      `${options.id}-sealed-stock`,
      quantity,
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
      options.id,
      source.organization_id,
      locationId,
      fixture.actor.id,
      source.expires_at,
    ],
  );
  if (!options.existingLocation) {
    const pointId = `${options.id}-point`;
    await db.query(
      "insert into redemption_points(id,organization_id,location_id,name,exposure,created_by) values($1,$2,$3,'Synthetic assignment register','staff',$4)",
      [pointId, source.organization_id, locationId, fixture.actor.id],
    );
    await db.query(
      "insert into redemption_credentials(id,point_id,public_token,credential_type,version,created_by) values($1,$2,$3,'qr',1,$4)",
      [
        `${options.id}-credential`,
        pointId,
        `${options.id}-token`,
        fixture.actor.id,
      ],
    );
  }
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,$4,$5)",
    [
      fixture.runId,
      options.weekKey ?? fixture.weekKey,
      options.id,
      quantity,
      fixture.actor.id,
    ],
  );
  return { supplyId: options.id, locationId };
}

async function reviewMember(
  db: DB,
  fixture: SyntheticPilotFixture,
  memberId: string,
  locationId: string,
  suitable: boolean,
  driveMinutes: number | null,
) {
  return saveAssignmentReview(db, fixture.actor, {
    scope: "member",
    memberId,
    locationId,
    suitable,
    driveMinutes,
    evidence: suitable
      ? "Operator verified that this destination is practical for the member."
      : "Operator verified that this destination is not practical for the member.",
  });
}

async function addApprovedProgramLimit(
  db: DB,
  fixture: SyntheticPilotFixture,
  limit: number,
) {
  const programId = `${fixture.runId}-program`;
  const organizationId = fixture.actor.organizationId!;
  const endsOn = addDays(fixture.weekKey, 7);
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into growth_programs(
        id,buyer_organization_id,market_id,status,current_version,
        pending_version,approved_version,created_by
       ) values($1,$2,$3,'approved',1,null,1,$4)`,
      [programId, organizationId, fixture.marketId, fixture.actor.id],
    );
    await tx.query(
      `insert into growth_program_versions(
        program_id,version,name,objective,starts_on,ends_on,
        buyer_organization_id,funder_organization_id,fulfiller_organization_id,
        negotiated_fee_cents,commercial_status,benefit_ceiling,
        operating_constraints,evaluation_plan,proposed_by
       ) values($1,1,'Assignment ceiling regression','introduce_store',$2,$3,
        $4,$4,$4,10000,'agreed',$5,
        'Use only the approved number of paid placements.',
        'Verify assignment and release against the approved commercial ceiling.',$6)`,
      [
        programId,
        fixture.weekKey,
        endsOn,
        organizationId,
        limit,
        fixture.actor.id,
      ],
    );
    await tx.query(
      "insert into growth_program_week_plans(program_id,program_version,week_key,planned_placements) values($1,1,$2,$3)",
      [programId, fixture.weekKey, limit],
    );
    await tx.query(
      "insert into program_supply_links(program_id,program_version,supply_id,week_key,linked_by) values($1,1,$2,$3,$4)",
      [programId, fixture.supplyId, fixture.weekKey, fixture.actor.id],
    );
    await tx.query(
      `insert into growth_program_approvals(
        id,program_id,program_version,run_id,decision,capacity_snapshot,note,
        decided_by
       ) values($1,$2,1,$3,'approved','{}',
        'Approved for the exact bounded paid placement count.',$4)`,
      [`${programId}-approval`, programId, fixture.runId, fixture.actor.id],
    );
  });
  return programId;
}

test("capacity matching moves a flexible member so a constrained member is not stranded", () => {
  const assignments = matchPilotDestinations(
    [
      {
        memberId: "member-flexible",
        candidates: [
          { supplyId: "a", reason: reason(true, "flex-a"), cost: 1 },
          { supplyId: "b", reason: reason(true, "flex-b"), cost: 5 },
        ],
      },
      {
        memberId: "member-constrained",
        candidates: [
          { supplyId: "a", reason: reason(true, "only-a"), cost: 2 },
        ],
      },
    ],
    [
      { supplyId: "a", capacity: 1 },
      { supplyId: "b", capacity: 1 },
    ],
  );
  assert.deepEqual(
    assignments.map(({ memberId, supplyId }) => ({ memberId, supplyId })),
    [
      { memberId: "member-flexible", supplyId: "b" },
      { memberId: "member-constrained", supplyId: "a" },
    ],
    "the augmenting path must move the earlier flexible member to complete the matching",
  );
});

test("assignment excludes supplies that are not ready for the complete release week", async () => {
  const cases: {
    prefix: string;
    invalidate: (db: DB, fixture: SyntheticPilotFixture) => Promise<unknown>;
  }[] = [
    {
      prefix: "assignment-short-readiness",
      invalidate: (db, fixture) =>
        db.query(
          "update destination_readiness set valid_until=now()+interval '1 hour' where supply_id=$1",
          [fixture.supplyId],
        ),
    },
    {
      prefix: "assignment-paused-fallback",
      invalidate: (db, fixture) =>
        db.query(
          "update pilot_supply_fallbacks set state='paused' where id=$1",
          [fixture.fallbackId],
        ),
    },
    {
      prefix: "assignment-revoked-qr",
      invalidate: (db, fixture) =>
        db.query(
          "update redemption_credentials set state='revoked' where public_token=$1",
          [fixture.pointToken],
        ),
    },
  ];

  for (const scenario of cases) {
    const db = await memoryDb();
    try {
      const fixture = await seedSyntheticPilot(db, 1, scenario.prefix);
      await scenario.invalidate(db, fixture);
      const plan = await recommendPilotAssignments(
        db,
        fixture.runId,
        fixture.weekKey,
      );
      assert.equal(
        plan.assignments.length,
        0,
        `${scenario.prefix} must not produce an unreleasable assignment`,
      );
      assert.deepEqual(plan.unassigned, [fixture.members[0].id]);
    } finally {
      await db.close?.();
    }
  }
});

test("paid assignments stop at the approved Program weekly and lifetime ceiling", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 2, "assignment-ceiling");
    await addApprovedProgramLimit(db, fixture, 1);
    const plan = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );

    assert.equal(plan.destinations[0].paid, true);
    assert.equal(plan.assignments.length, 1);
    assert.equal(plan.destinations[0].assigned, 1);
    assert.equal(plan.unassigned.length, 1);
  } finally {
    await db.close?.();
  }
});

test("member suitability decides assignments even when member IDs sort in the opposite order", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 2, "assignment-suitability");
    await db.query(
      "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values('assignment-primary-one',$1,-1,'Shape one unit of test capacity.',$2)",
      [fixture.supplyId, fixture.actor.id],
    );
    const [primary] = await db.query<{ location_id: string }>(
      "select location_id from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    const second = await addDestination(db, fixture, {
      id: "assignment-suitability-second",
      quantity: 1,
      driveMinutes: 7,
    });
    const [firstMember, secondMember] = fixture.members;
    await reviewMember(
      db,
      fixture,
      firstMember.id,
      primary.location_id,
      false,
      5,
    );
    await reviewMember(db, fixture, firstMember.id, second.locationId, true, 7);
    await reviewMember(
      db,
      fixture,
      secondMember.id,
      primary.location_id,
      true,
      5,
    );
    await reviewMember(
      db,
      fixture,
      secondMember.id,
      second.locationId,
      false,
      7,
    );

    const plan = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );
    assert.deepEqual(
      plan.assignments.map(({ memberId, supplyId }) => ({
        memberId,
        supplyId,
      })),
      [
        { memberId: firstMember.id, supplyId: second.supplyId },
        { memberId: secondMember.id, supplyId: fixture.supplyId },
      ],
      "explicit suitability must determine the result rather than consecutive ID slicing",
    );
    assert.equal(plan.unassigned.length, 0);
    assert.deepEqual(
      plan.destinations.map(({ assigned, capacity }) => ({
        assigned,
        capacity,
      })),
      [
        { assigned: 1, capacity: 1 },
        { assigned: 1, capacity: 1 },
      ],
    );
  } finally {
    await db.close?.();
  }
});

test("recent destination history rotates a member to another suitable location", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "assignment-rotation");
    const current = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );
    await releaseWeeklyBenefits(db, fixture.actor, {
      runId: fixture.runId,
      marketId: fixture.marketId,
      weekKey: fixture.weekKey,
      dataKind: "synthetic",
      requestKey: "assignment-rotation-current-release",
      recommendationFingerprint: current.fingerprint,
      assignments: current.assignments.map(({ memberId, supplyId }) => ({
        memberId,
        supplyId,
      })),
    });

    const futureWeek = addDays(fixture.weekKey, 7);
    const sameLocation = await addDestination(db, fixture, {
      id: "assignment-rotation-same-location",
      weekKey: futureWeek,
      quantity: 1,
      existingLocation: true,
    });
    const otherLocation = await addDestination(db, fixture, {
      id: "assignment-rotation-other-location",
      weekKey: futureWeek,
      quantity: 1,
      postalCode: "10001",
      driveMinutes: 5,
    });
    const plan = await recommendPilotAssignments(db, fixture.runId, futureWeek);
    const member = plan.members[0];
    assert.equal(
      member.candidates.find(
        (candidate) => candidate.supplyId === sameLocation.supplyId,
      )?.reason.recentDestinationCount,
      1,
    );
    assert.equal(plan.assignments[0].supplyId, otherLocation.supplyId);
    assert.equal(
      plan.assignments[0].reason.recentDestinationCount,
      0,
      "rotation should prefer the equally suitable location without recent exposure",
    );
  } finally {
    await db.close?.();
  }
});

test("an explicit unsuitable review overrides an all-destinations-fit policy", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "assignment-policy");
    const second = await addDestination(db, fixture, {
      id: "assignment-policy-second",
      quantity: 1,
    });
    const policyId = await saveAssignmentReview(db, fixture.actor, {
      scope: "pilot",
      runId: fixture.runId,
      allDestinationsFit: true,
      maxDriveMinutes: 20,
      evidence:
        "Operator verified that every destination generally fits this compact pilot cell.",
    });
    const reviewId = await reviewMember(
      db,
      fixture,
      fixture.members[0].id,
      second.locationId,
      false,
      8,
    );
    const plan = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );
    const rejected = plan.members[0].candidates.find(
      (candidate) => candidate.supplyId === second.supplyId,
    )!;
    assert.equal(plan.policy?.id, policyId);
    assert.equal(rejected.reason.suitable, false);
    assert.equal(rejected.reason.reviewId, reviewId);
    assert.equal(
      plan.assignments[0].supplyId,
      fixture.supplyId,
      "the general cell policy cannot erase a member-specific unsuitable finding",
    );
    await assert.rejects(
      releaseWeeklyBenefits(db, fixture.actor, {
        runId: fixture.runId,
        marketId: fixture.marketId,
        weekKey: fixture.weekKey,
        dataKind: "synthetic",
        requestKey: "assignment-policy-unsuitable-override",
        recommendationFingerprint: plan.fingerprint,
        overrideReason:
          "Operator requested the alternate destination despite the recorded review.",
        assignments: [
          {
            memberId: fixture.members[0].id,
            supplyId: second.supplyId,
          },
        ],
      }),
      /unsuitable|unreviewed|cannot bypass/i,
    );
    assert.equal(
      (await db.query("select id from fulfillment_grants")).length,
      0,
      "a written override reason cannot bypass an explicit unsuitable review",
    );
  } finally {
    await db.close?.();
  }
});

async function seedUnknownRealPilot(db: DB) {
  const window = marketWeekWindow(new Date(), "America/New_York");
  const weekKey = window.weekKey;
  const endsOn = addDays(weekKey, 28);
  const supplyEnd = new Date(
    window.start.getTime() + 35 * 86400000,
  ).toISOString();
  const actor = {
    id: "real-assignment-operator",
    role: "operator" as const,
    organizationId: "real-assignment-merchant",
  };
  await db.query(
    "insert into organizations(id,name) values($1,'Real assignment merchant')",
    [actor.organizationId],
  );
  await db.query(
    "insert into locations(id,organization_id,name,address) values('real-assignment-location',$1,'Real counter','1 Real Way')",
    [actor.organizationId],
  );
  await db.query(
    "insert into market_cells(id,name,slug,timezone,state,data_kind) values('real-assignment-market','Real assignment market','real-assignment-market','America/New_York','pilot','real')",
  );
  await db.query(
    "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values('real-assignment-market','real-assignment-location',$1,null)",
    [actor.organizationId],
  );
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values('real-assignment-offer',$1,'real-assignment-location','drop','live','Real free item')",
    [actor.organizationId],
  );
  await db.query(
    `insert into offer_versions(
      offer_id,version,qualification,reward,terms,starts_at,expires_at,
      limit_mode,quantity
     ) values('real-assignment-offer',1,'No purchase required','One free item',
      'One per admitted member. No purchase required.',$1,$2,'claim',1)`,
    [window.start.toISOString(), supplyEnd],
  );
  await db.query(
    `insert into network_drop_supplies(
      id,market_id,organization_id,location_id,offer_id,offer_version,state,
      starts_at,expires_at,inventory_policy,quantity,verification_mode,
      staff_instructions,fallback_plan,approved_by,data_kind
     ) values('real-assignment-supply','real-assignment-market',$1,
      'real-assignment-location','real-assignment-offer',1,'approved',$2,$3,
      'claim',1,'staff_tap','Scan the staff QR and provide the free item.',
      'Use the independently backed substitute.',$4,'real')`,
    [actor.organizationId, window.start.toISOString(), supplyEnd, actor.id],
  );
  await db.query(
    `insert into pilot_supply_terms(
      supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
      funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values('real-assignment-supply','Real assignment item','REAL-1','12 oz',
      'Posted pilot hours','real-primary-stock',$1,$1,'real',$2)`,
    [actor.organizationId, actor.id],
  );
  await db.query(
    `insert into pilot_supply_fallbacks(
      id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
      usable_capacity,instructions,payer_organization_id,state,approved_by,
      created_by
     ) values('real-assignment-fallback','real-assignment-supply',
      'Real sealed substitute','REAL-FALLBACK','12 oz','real-sealed-stock',1,
      'Provide the independent substitute and scan the staff QR.',$1,
      'approved',$2,$2)`,
    [actor.organizationId, actor.id],
  );
  await db.query(
    `insert into destination_readiness(
      supply_id,organization_id,location_id,state,owner_approved_by,
      primary_manager,primary_contact,backup_contact,stock_confirmed_at,
      exact_item_confirmed,staff_instructions_confirmed,shifts_briefed_at,
      valid_hours_confirmed,qr_rehearsed_at,support_escalation,valid_until,
      updated_by
     ) values('real-assignment-supply',$1,'real-assignment-location','ready',$2,
      'Real Manager','manager@example.com','backup@example.com',now(),true,true,
      now(),true,now(),'Escalate immediately to the real support owner.',$3,$2)`,
    [actor.organizationId, actor.id, supplyEnd],
  );
  await db.query(
    "insert into redemption_points(id,organization_id,location_id,name,exposure,created_by) values('real-assignment-point',$1,'real-assignment-location','Real register','staff',$2)",
    [actor.organizationId, actor.id],
  );
  await db.query(
    "insert into redemption_credentials(id,point_id,public_token,credential_type,version,created_by) values('real-assignment-credential','real-assignment-point','real-assignment-token','qr',1,$1)",
    [actor.id],
  );
  await db.query(
    `insert into pilot_runs(
      id,market_id,name,starts_on,ends_on,state,data_kind,target_members,hard_cap,
      operator_owner,support_owner,backup_support_owner,created_by
     ) values('real-assignment-run','real-assignment-market','Real assignment run',
      $1,$2,'enrolling','real',1,1,'Operator','Support','Backup',$3)`,
    [weekKey, endsOn, actor.id],
  );
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values('real-assignment-run',$1,'real-assignment-supply',1,$2)",
    [weekKey, actor.id],
  );
  await db.query(
    "insert into customers(id,phone) values('real-assignment-customer','+12125550199')",
  );
  await db.query(
    `insert into uptick_members(
      id,customer_id,home_zip,market_id,state,verified_at,data_kind,
      age_confirmed_at
     ) values('real-assignment-member','real-assignment-customer','99999',
      'real-assignment-market','active',now(),'real',now())`,
  );
  await db.query(
    "insert into pilot_admissions(run_id,member_id,data_kind) values('real-assignment-run','real-assignment-member','real')",
  );
  await db.query(
    "update pilot_runs set state='live' where id='real-assignment-run'",
  );
  return { actor, weekKey };
}

test("unknown suitability stays visible and blocks a real release", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedUnknownRealPilot(db);
    const plan = await recommendPilotAssignments(
      db,
      "real-assignment-run",
      fixture.weekKey,
    );
    const candidate = plan.members[0].candidates[0];
    assert.equal(candidate.reason.unknownSuitability, true);
    assert.equal(candidate.reason.suitable, false);
    assert.deepEqual(plan.unassigned, ["real-assignment-member"]);
    await assert.rejects(
      releaseWeeklyBenefits(db, fixture.actor, {
        runId: "real-assignment-run",
        marketId: "real-assignment-market",
        weekKey: fixture.weekKey,
        dataKind: "real",
        requestKey: "real-assignment-release",
        recommendationFingerprint: plan.fingerprint,
        assignments: [
          {
            memberId: "real-assignment-member",
            supplyId: "real-assignment-supply",
          },
        ],
      }),
      /lack a suitable|unsuitable|unreviewed/i,
    );
    assert.equal(
      (await db.query("select id from fulfillment_grants")).length,
      0,
    );
  } finally {
    await db.close?.();
  }
});

test("release rejects stale recommendations and requires a reason for a suitable override", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "assignment-release");
    const second = await addDestination(db, fixture, {
      id: "assignment-release-second",
      quantity: 1,
      postalCode: "10001",
      driveMinutes: 5,
    });
    const plan = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );
    const recommended = plan.assignments[0].supplyId;
    const alternate = [fixture.supplyId, second.supplyId].find(
      (supplyId) => supplyId !== recommended,
    )!;
    const assignments = [
      { memberId: fixture.members[0].id, supplyId: alternate },
    ];
    await assert.rejects(
      releaseWeeklyBenefits(db, fixture.actor, {
        runId: fixture.runId,
        marketId: fixture.marketId,
        weekKey: fixture.weekKey,
        dataKind: "synthetic",
        requestKey: "assignment-release-no-reason",
        recommendationFingerprint: plan.fingerprint,
        assignments,
      }),
      /reason.*recommended assignment/i,
    );

    const [alternateLocation] = await db.query<{ location_id: string }>(
      "select location_id from network_drop_supplies where id=$1",
      [alternate],
    );
    await reviewMember(
      db,
      fixture,
      fixture.members[0].id,
      alternateLocation.location_id,
      true,
      4,
    );
    await assert.rejects(
      releaseWeeklyBenefits(db, fixture.actor, {
        runId: fixture.runId,
        marketId: fixture.marketId,
        weekKey: fixture.weekKey,
        dataKind: "synthetic",
        requestKey: "assignment-release-stale-plan",
        recommendationFingerprint: plan.fingerprint,
        overrideReason:
          "Operator selected the alternate reviewed destination for this member.",
        assignments,
      }),
      /facts changed|recommendation again/i,
    );

    const refreshed = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );
    const published = await releaseWeeklyBenefits(db, fixture.actor, {
      runId: fixture.runId,
      marketId: fixture.marketId,
      weekKey: fixture.weekKey,
      dataKind: "synthetic",
      requestKey: "assignment-release-reviewed-override",
      recommendationFingerprint: refreshed.fingerprint,
      overrideReason:
        "Operator selected the alternate reviewed destination for this member.",
      assignments,
    });
    assert.equal(published.grants.length, 1);
    const [saved] = await db.query<{ reason: Record<string, unknown> }>(
      "select reason from allocation_options",
    );
    assert.equal(
      saved.reason.overrideReason,
      "Operator selected the alternate reviewed destination for this member.",
    );
    assert.equal(saved.reason.recommendationFingerprint, refreshed.fingerprint);
    assert.equal((saved.reason.suitability as AssignmentReason).suitable, true);
  } finally {
    await db.close?.();
  }
});
