import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import {
  approveGrowthProgramVersion,
  createGrowthProgram,
  linkProgramSupply,
  proposeGrowthProgramAmendment,
} from "../src/lib/growth-programs";
import { pilotCapacity, loadPilotRun } from "../src/lib/pilot-operations";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import { amendPilotSupply } from "../src/lib/pilot-supply-amendments";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "../scripts/verify-postgres-pilot";

process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";

function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

function amendmentInput(
  fixture: SyntheticPilotFixture,
  options: {
    weekKey: string;
    previousSupplyId: string;
    replacementSupplyId: string;
    quantity: number;
    requestKey: string;
  },
) {
  return {
    runId: fixture.runId,
    weekKey: options.weekKey,
    previousSupplyId: options.previousSupplyId,
    replacementSupplyId: options.replacementSupplyId,
    quantity: options.quantity,
    reason:
      "The original future-week item is no longer operationally available.",
    payerOrganizationId: fixture.actor.organizationId!,
    financialEvidence:
      "The existing synthetic payer remains accountable and no invoice is rewritten.",
    programImplications:
      "This fixture has no paid Program, so attribution remains explicitly organic.",
    protectionReview:
      "No paid placement protection applies to this synthetic amendment.",
    requestKey: options.requestKey,
  };
}

async function createSupply(
  db: DB,
  fixture: SyntheticPilotFixture,
  options: {
    id: string;
    quantity: number;
    dataKind?: "synthetic" | "internal";
    ready?: boolean;
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
  const dataKind = options.dataKind ?? "synthetic";
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Synthetic future-week item')",
    [options.id, source.organization_id, source.location_id],
  );
  await db.query(
    `insert into offer_versions(
      offer_id,version,qualification,reward,terms,starts_at,expires_at,
      limit_mode,quantity
     ) values($1,1,'No purchase required','One free synthetic item',
      'One per admitted member. No purchase required.',$2,$3,'claim',$4)`,
    [options.id, source.starts_at, source.expires_at, options.quantity],
  );
  await db.query(
    `insert into network_drop_supplies(
      id,market_id,organization_id,location_id,offer_id,offer_version,state,
      starts_at,expires_at,inventory_policy,quantity,verification_mode,
      staff_instructions,fallback_plan,approved_by,data_kind
     ) values($1,$2,$3,$4,$1,1,'approved',$5,$6,'claim',$7,'staff_tap',
      'Scan the staff QR and hand over the named item.',
      'Use the independently reserved substitute.',$8,$9)`,
    [
      options.id,
      fixture.marketId,
      source.organization_id,
      source.location_id,
      source.starts_at,
      source.expires_at,
      options.quantity,
      fixture.actor.id,
      dataKind,
    ],
  );
  await db.query(
    `insert into pilot_supply_terms(
      supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
      funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values($1,'Synthetic future item',$2,'12 oz','Posted pilot hours',$3,
      $4,$4,$5,$6)`,
    [
      options.id,
      `${options.id}-sku`,
      `${options.id}-primary-stock`,
      source.organization_id,
      dataKind,
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
      options.quantity,
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
     ) values($1,$2,$3,$4,$5,'Synthetic Manager','manager@example.test',
      'backup@example.test',now(),true,true,now(),true,now(),
      'Escalate immediately to the synthetic support owner.',$6,$5)`,
    [
      options.id,
      source.organization_id,
      source.location_id,
      options.ready === false ? "not_ready" : "ready",
      fixture.actor.id,
      source.expires_at,
    ],
  );
  return options.id;
}

async function commitFutureSupply(
  db: DB,
  fixture: SyntheticPilotFixture,
  weekKey: string,
  supplyId: string,
  quantity: number,
) {
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,$4,$5)",
    [fixture.runId, weekKey, supplyId, quantity, fixture.actor.id],
  );
}

test("successive future-week amendments preserve immutable history and expose only the backed leaf", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 2, "future-chain");
    const weekKey = addDays(fixture.weekKey, 7);
    const original = await createSupply(db, fixture, {
      id: "future-chain-original",
      quantity: 5,
    });
    const replacementOne = await createSupply(db, fixture, {
      id: "future-chain-replacement-one",
      quantity: 3,
    });
    const replacementTwo = await createSupply(db, fixture, {
      id: "future-chain-replacement-two",
      quantity: 2,
    });
    await commitFutureSupply(db, fixture, weekKey, original, 5);

    const firstInput = amendmentInput(fixture, {
      weekKey,
      previousSupplyId: original,
      replacementSupplyId: replacementOne,
      quantity: 3,
      requestKey: "future-chain-first-request",
    });
    const firstId = await amendPilotSupply(db, fixture.actor, firstInput);
    assert.equal(
      await amendPilotSupply(db, fixture.actor, firstInput),
      firstId,
      "an exact retry must return the original amendment",
    );
    await assert.rejects(
      amendPilotSupply(db, fixture.actor, {
        ...firstInput,
        quantity: 2,
      }),
      /different supply amendment/i,
    );

    const secondId = await amendPilotSupply(
      db,
      fixture.actor,
      amendmentInput(fixture, {
        weekKey,
        previousSupplyId: replacementOne,
        replacementSupplyId: replacementTwo,
        quantity: 2,
        requestKey: "future-chain-second-request",
      }),
    );
    const [originalCommitment] = await db.query<{
      supply_id: string;
      committed_quantity: number;
    }>(
      "select supply_id,committed_quantity from pilot_week_supplies where run_id=$1 and week_key=$2",
      [fixture.runId, weekKey],
    );
    assert.deepEqual(originalCommitment, {
      supply_id: original,
      committed_quantity: 5,
    });
    const effective = await db.query<{
      supply_id: string;
      committed_quantity: number;
      amendment_id: string | null;
    }>(
      "select supply_id,committed_quantity,amendment_id from effective_pilot_week_supplies where run_id=$1 and week_key=$2",
      [fixture.runId, weekKey],
    );
    assert.deepEqual(effective, [
      {
        supply_id: replacementTwo,
        committed_quantity: 2,
        amendment_id: secondId,
      },
    ]);
    const capacity = await pilotCapacity(
      db,
      await loadPilotRun(db, fixture.runId),
    );
    assert.equal(
      capacity.weeks.find((week) => week.week === weekKey)?.capacity,
      2,
      "capacity must use the final replacement once and ignore superseded stock",
    );
    assert.equal(
      (
        await db.query(
          "select id from pilot_supply_amendments where run_id=$1",
          [fixture.runId],
        )
      ).length,
      2,
    );
    await assert.rejects(
      db.query(
        "update pilot_supply_amendments set reason='Attempted history rewrite' where id=$1",
        [firstId],
      ),
      /append-only|immutable/i,
    );
    await assert.rejects(
      db.query("delete from pilot_supply_amendments where id=$1", [firstId]),
      /append-only|immutable/i,
    );
  } finally {
    await db.close?.();
  }
});

test("current and already-released weeks require recovery instead of amendment", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "future-boundary");
    const currentReplacement = await createSupply(db, fixture, {
      id: "future-boundary-current-replacement",
      quantity: 1,
    });
    await assert.rejects(
      amendPilotSupply(
        db,
        fixture.actor,
        amendmentInput(fixture, {
          weekKey: fixture.weekKey,
          previousSupplyId: fixture.supplyId,
          replacementSupplyId: currentReplacement,
          quantity: 1,
          requestKey: "future-boundary-current-request",
        }),
      ),
      /future week|recovery/i,
    );

    const futureWeek = addDays(fixture.weekKey, 7);
    const futureOriginal = await createSupply(db, fixture, {
      id: "future-boundary-released-original",
      quantity: 1,
    });
    const futureReplacement = await createSupply(db, fixture, {
      id: "future-boundary-released-replacement",
      quantity: 1,
    });
    await commitFutureSupply(db, fixture, futureWeek, futureOriginal, 1);
    await db.query(
      `insert into weekly_releases(
        id,run_id,market_id,week_key,state,data_kind,member_count,reviewed_by,
        request_key,request_fingerprint
       ) values('future-boundary-release',$1,$2,$3,'published','synthetic',1,
        $4,'future-boundary-release','future-boundary-release')`,
      [fixture.runId, fixture.marketId, futureWeek, fixture.actor.id],
    );
    await assert.rejects(
      amendPilotSupply(
        db,
        fixture.actor,
        amendmentInput(fixture, {
          weekKey: futureWeek,
          previousSupplyId: futureOriginal,
          replacementSupplyId: futureReplacement,
          quantity: 1,
          requestKey: "future-boundary-released-request",
        }),
      ),
      /already released|history/i,
    );
    assert.equal(
      (await db.query("select id from pilot_supply_amendments")).length,
      0,
    );
  } finally {
    await db.close?.();
  }
});

test("an under-backed replacement rolls back without changing the effective commitment", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 3, "future-underbacked");
    const weekKey = addDays(fixture.weekKey, 7);
    const original = await createSupply(db, fixture, {
      id: "future-underbacked-original",
      quantity: 3,
    });
    const replacement = await createSupply(db, fixture, {
      id: "future-underbacked-replacement",
      quantity: 2,
    });
    await commitFutureSupply(db, fixture, weekKey, original, 3);
    await assert.rejects(
      amendPilotSupply(
        db,
        fixture.actor,
        amendmentInput(fixture, {
          weekKey,
          previousSupplyId: original,
          replacementSupplyId: replacement,
          quantity: 2,
          requestKey: "future-underbacked-request",
        }),
      ),
      /back.*3 members|required.*3/i,
    );
    assert.equal(
      (await db.query("select id from pilot_supply_amendments")).length,
      0,
    );
    const [effective] = await db.query<{ supply_id: string }>(
      "select supply_id from effective_pilot_week_supplies where run_id=$1 and week_key=$2",
      [fixture.runId, weekKey],
    );
    assert.equal(effective.supply_id, original);
  } finally {
    await db.close?.();
  }
});

test("wrong-run, wrong-classification and unready replacements fail without history", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "future-validation");
    const weekKey = addDays(fixture.weekKey, 7);
    const original = await createSupply(db, fixture, {
      id: "future-validation-original",
      quantity: 1,
    });
    await commitFutureSupply(db, fixture, weekKey, original, 1);
    const wrongType = await createSupply(db, fixture, {
      id: "future-validation-wrong-type",
      quantity: 1,
      dataKind: "internal",
    });
    const unready = await createSupply(db, fixture, {
      id: "future-validation-unready",
      quantity: 1,
      ready: false,
    });
    const otherOriginal = await createSupply(db, fixture, {
      id: "future-validation-other-run-original",
      quantity: 1,
    });
    await db.query(
      `insert into pilot_runs(
        id,market_id,name,starts_on,ends_on,state,data_kind,target_members,
        hard_cap,operator_owner,support_owner,backup_support_owner,created_by
       ) values('future-validation-other-run',$1,'Other synthetic run',$2,
        $2::date+28,'draft','synthetic',1,1,'Operator','Support','Backup',$3)`,
      [fixture.marketId, fixture.weekKey, fixture.actor.id],
    );
    await db.query(
      "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values('future-validation-other-run',$1,$2,1,$3)",
      [weekKey, otherOriginal, fixture.actor.id],
    );
    const validReplacement = await createSupply(db, fixture, {
      id: "future-validation-valid-replacement",
      quantity: 1,
    });

    for (const scenario of [
      {
        name: "wrong run",
        previousSupplyId: otherOriginal,
        replacementSupplyId: validReplacement,
      },
      {
        name: "wrong classification",
        previousSupplyId: original,
        replacementSupplyId: wrongType,
      },
      {
        name: "unready replacement",
        previousSupplyId: original,
        replacementSupplyId: unready,
      },
    ]) {
      await assert.rejects(
        amendPilotSupply(
          db,
          fixture.actor,
          amendmentInput(fixture, {
            weekKey,
            previousSupplyId: scenario.previousSupplyId,
            replacementSupplyId: scenario.replacementSupplyId,
            quantity: 1,
            requestKey: `future-validation-${scenario.name.replaceAll(" ", "-")}`,
          }),
        ),
        /current supply commitment|matching free terms|readiness|classification/i,
      );
    }
    assert.equal(
      (await db.query("select id from pilot_supply_amendments")).length,
      0,
    );
  } finally {
    await db.close?.();
  }
});

test("a prospective v2 can be approved after a v1 grant without rewriting that grant", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "future-program-v2");
    const organizationId = fixture.actor.organizationId!;
    const [supply] = await db.query<{ location_id: string }>(
      "select location_id from network_drop_supplies where id=$1",
      [fixture.supplyId],
    );
    const programInput = (
      weekKey: string,
      endsOn: string,
      benefitCeiling: number,
    ) => ({
      buyerOrganizationId: organizationId,
      marketId: fixture.marketId,
      name: "Synthetic prospective Program",
      objective: "introduce_store" as const,
      objectiveNote: "Exercise prospective paid placement history.",
      placementCategory: "synthetic cafe",
      startsOn: weekKey,
      endsOn,
      funderOrganizationId: organizationId,
      fulfillerOrganizationId: organizationId,
      negotiatedFeeCents: 1000,
      commercialStatus: "agreed" as const,
      benefitCeiling,
      operatingConstraints:
        "Use only effective pilot supply with complete readiness evidence.",
      evaluationPlan:
        "Verify each grant against its immutable source Program version.",
      locationIds: [supply.location_id],
      weekPlans: [{ weekKey, plannedPlacements: 1 }],
      protection: null,
    });
    const programId = await createGrowthProgram(
      db,
      fixture.actor,
      programInput(fixture.weekKey, addDays(fixture.weekKey, 6), 1),
    );
    await linkProgramSupply(db, fixture.actor, {
      programId,
      programVersion: 1,
      supplyId: fixture.supplyId,
      weekKey: fixture.weekKey,
    });
    await approveGrowthProgramVersion(db, fixture.actor, {
      programId,
      programVersion: 1,
      runId: fixture.runId,
      note: "Approve the current-week synthetic Program execution.",
      attentionExceptionReason:
        "The one-member fixture intentionally exercises one paid placement.",
    });
    const released = await releaseWeeklyBenefits(db, fixture.actor, {
      runId: fixture.runId,
      marketId: fixture.marketId,
      weekKey: fixture.weekKey,
      dataKind: "synthetic",
      requestKey: "future-program-v1-release",
      assignments: [
        {
          memberId: fixture.members[0].id,
          supplyId: fixture.supplyId,
        },
      ],
    });
    const v1GrantId = released.grants[0].id;

    const futureWeek = addDays(fixture.weekKey, 7);
    const futureSupply = await createSupply(db, fixture, {
      id: "future-program-v2-week-two-supply",
      quantity: 1,
    });
    await commitFutureSupply(db, fixture, futureWeek, futureSupply, 1);
    assert.equal(
      await proposeGrowthProgramAmendment(
        db,
        fixture.actor,
        programId,
        programInput(futureWeek, addDays(futureWeek, 6), 2),
      ),
      2,
    );
    await linkProgramSupply(db, fixture.actor, {
      programId,
      programVersion: 2,
      supplyId: futureSupply,
      weekKey: futureWeek,
    });
    await approveGrowthProgramVersion(db, fixture.actor, {
      programId,
      programVersion: 2,
      runId: fixture.runId,
      note: "Approve only the future week after preserving issued v1 history.",
      attentionExceptionReason:
        "The one-member fixture intentionally exercises one paid placement.",
    });
    const [program] = await db.query<{
      approved_version: number;
      pending_version: number | null;
    }>(
      "select approved_version,pending_version from growth_programs where id=$1",
      [programId],
    );
    assert.deepEqual(program, { approved_version: 2, pending_version: null });
    const [oldGrant] = await db.query<{
      source_program_id: string;
      source_program_version: number;
    }>(
      "select source_program_id,source_program_version from fulfillment_grants where id=$1",
      [v1GrantId],
    );
    assert.deepEqual(oldGrant, {
      source_program_id: programId,
      source_program_version: 1,
    });
  } finally {
    await db.close?.();
  }
});
