import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import {
  loadPilotRun,
  pilotCapacity,
  pilotScorecard,
  setPilotState,
} from "../src/lib/pilot-operations";
import { recommendPilotAssignments } from "../src/lib/pilot-assignment";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import { exchangeMemberAccess, requestMemberAccess } from "../src/lib/network";
import { memberSession } from "../src/lib/member-session";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "../scripts/verify-postgres-pilot";

const launchChecklist = Object.fromEntries(
  [
    "ownerAgreements",
    "staffRehearsal",
    "recoveryFunded",
    "supportCoverage",
    "partnerDistribution",
    "privacyIdentity",
    "releaseVerified",
  ].map((key) => [key, true]),
);

function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

function useLocalTestEnvironment() {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  delete process.env.UPTICK_DEMO_MODE;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
}

async function addFutureWeekSupply(
  db: DB,
  fixture: SyntheticPilotFixture,
  weekIndex: number,
) {
  const supplyId = `${fixture.runId}-future-${weekIndex}`;
  const weekKey = addDays(fixture.weekKey, weekIndex * 7);
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
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Future resume item')",
    [supplyId, source.organization_id, source.location_id],
  );
  await db.query(
    `insert into offer_versions(
      offer_id,version,qualification,reward,terms,starts_at,expires_at,
      limit_mode,quantity
     ) values($1,1,'No purchase required','One free synthetic item',
      'One per admitted synthetic member. No purchase required.',$2,$3,'claim',1)`,
    [supplyId, source.starts_at, source.expires_at],
  );
  await db.query(
    `insert into network_drop_supplies(
      id,market_id,organization_id,location_id,offer_id,offer_version,state,
      starts_at,expires_at,inventory_policy,quantity,verification_mode,
      staff_instructions,fallback_plan,approved_by,data_kind
     ) values($1,$2,$3,$4,$1,1,'approved',$5,$6,'claim',1,'staff_tap',
      'Scan the staff QR and provide the free item.',
      'Use the independently backed substitute.',$7,'synthetic')`,
    [
      supplyId,
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
     ) values($1,'Future resume item',$2,'12 oz','Posted pilot hours',$3,
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
     ) values($1,$2,'Future sealed substitute',$3,'12 oz',$4,1,
      'Provide the independent substitute and scan the staff QR.',$5,
      'approved',$6,$6)`,
    [
      `${supplyId}-fallback`,
      supplyId,
      `${supplyId}-fallback-sku`,
      `${supplyId}-fallback-stock`,
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
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,1,$4)",
    [fixture.runId, weekKey, supplyId, fixture.actor.id],
  );
}

async function addPaidCurrentWeek(db: DB, fixture: SyntheticPilotFixture) {
  const programId = `${fixture.runId}-paid-program`;
  const organizationId = fixture.actor.organizationId!;
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
       ) values($1,1,'Frozen resume paid week','introduce_store',$2,$3,
        $4,$4,$4,10000,'agreed',1,
        'Release exactly one backed placement in the approved week.',
        'Preserve the issued placement when a frozen run resumes.',$5)`,
      [
        programId,
        fixture.weekKey,
        addDays(fixture.weekKey, 7),
        organizationId,
        fixture.actor.id,
      ],
    );
    await tx.query(
      "insert into growth_program_week_plans(program_id,program_version,week_key,planned_placements) values($1,1,$2,1)",
      [programId, fixture.weekKey],
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
        'Approved for one paid placement in the current pilot week.',$4)`,
      [`${programId}-approval`, programId, fixture.runId, fixture.actor.id],
    );
  });
}

async function addDistributionEvidence(db: DB, fixture: SyntheticPilotFixture) {
  await db.query(
    "insert into acquisition_partners(id,name,kind,data_kind) values($1,'Synthetic residents','residential','synthetic')",
    [`${fixture.runId}-partner`],
  );
  await db.query(
    "insert into partner_markets(partner_id,market_id) values($1,$2)",
    [`${fixture.runId}-partner`, fixture.marketId],
  );
  await db.query(
    `insert into acquisition_sources(
      id,partner_id,market_id,token,name,channel,campaign,data_kind
     ) values($1,$2,$3,$4,'Synthetic resident access','email',
      'Frozen resume regression','synthetic')`,
    [
      `${fixture.runId}-source`,
      `${fixture.runId}-partner`,
      fixture.marketId,
      `${fixture.runId}-source-token`,
    ],
  );
  await db.query(
    `insert into partner_commitments(
      id,run_id,partner_id,source_id,channel,planned_at,owner,
      intended_population
     ) values($1,$2,$3,$4,'resident_email',now(),'Property manager',1)`,
    [
      `${fixture.runId}-commitment`,
      fixture.runId,
      `${fixture.runId}-partner`,
      `${fixture.runId}-source`,
    ],
  );
}

test("a frozen pilot resumes from a pause using only unreleased operating weeks", async () => {
  useLocalTestEnvironment();
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "frozen-paid-resume");
    for (let weekIndex = 1; weekIndex <= 3; weekIndex++)
      await addFutureWeekSupply(db, fixture, weekIndex);
    await addPaidCurrentWeek(db, fixture);
    await addDistributionEvidence(db, fixture);

    const recommendation = await recommendPilotAssignments(
      db,
      fixture.runId,
      fixture.weekKey,
    );
    assert.equal(recommendation.assignments.length, 1);
    const published = await releaseWeeklyBenefits(db, fixture.actor, {
      runId: fixture.runId,
      marketId: fixture.marketId,
      weekKey: fixture.weekKey,
      dataKind: "synthetic",
      requestKey: "frozen-paid-resume-release",
      recommendationFingerprint: recommendation.fingerprint,
      assignments: recommendation.assignments.map(({ memberId, supplyId }) => ({
        memberId,
        supplyId,
      })),
    });
    const before = await loadPilotRun(db, fixture.runId);
    const originalFrozenAt = before.cohort_frozen_at;
    const originalDenominator = (
      await pilotScorecard(db, fixture.actor, fixture.runId)
    ).denominator;
    assert.ok(originalFrozenAt);
    assert.equal(originalDenominator, 1);

    await setPilotState(db, fixture.actor, {
      runId: fixture.runId,
      state: "paused",
    });
    await db.query(
      "update destination_readiness set valid_until=now()-interval '1 minute' where supply_id=$1",
      [fixture.supplyId],
    );

    const capacity = await pilotCapacity(
      db,
      await loadPilotRun(db, fixture.runId),
    );
    assert.deepEqual(
      capacity.weeks.map((week) => week.capacity),
      [0, 1, 1, 1],
      "the issued paid week is exhausted and expired while every unreleased week remains backed",
    );
    assert.equal(capacity.capacity, 0);

    await setPilotState(db, fixture.actor, {
      runId: fixture.runId,
      state: "live",
      checklist: launchChecklist,
    });

    const resumed = await loadPilotRun(db, fixture.runId);
    assert.equal(resumed.state, "live");
    assert.equal(
      new Date(resumed.cohort_frozen_at!).getTime(),
      new Date(originalFrozenAt).getTime(),
    );
    assert.equal(
      (await pilotScorecard(db, fixture.actor, fixture.runId)).denominator,
      originalDenominator,
    );
    assert.equal(
      (
        await db.query("select id from weekly_releases where run_id=$1", [
          fixture.runId,
        ])
      ).length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select id from fulfillment_grants where release_id=$1",
          [published.release.id],
        )
      ).length,
      1,
    );
  } finally {
    await db.close?.();
  }
});

test("an existing verified production member can sign in while new enrollment is disabled", async () => {
  process.env.UPTICK_ENV = "production";
  process.env.UPTICK_LOCAL_MODE = "false";
  process.env.APP_URL = "https://pilot.upticklocal.com";
  process.env.PILOT_ENROLLMENT_ENABLED = "false";
  process.env.LEGAL_APPROVED = "true";
  process.env.BUSINESS_LEGAL_NAME = "Uptick Local";
  process.env.SUPPORT_EMAIL = "support@upticklocal.com";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  delete process.env.UPTICK_DEMO_MODE;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;

  const db = await memoryDb();
  try {
    const phone = "+12125550199";
    await db.query(
      "insert into customers(id,phone) values('existing-customer',$1)",
      [phone],
    );
    await db.query(
      `insert into uptick_members(
        id,customer_id,home_zip,state,verified_at,age_confirmed_at,data_kind
       ) values('existing-member','existing-customer','10001','active',now(),
        now(),'real')`,
    );

    const requested = await requestMemberAccess(db, {
      phone,
      consentRequested: false,
      ageAttested: true,
    });
    assert.equal(requested.member.id, "existing-member");
    assert.equal(requested.member.data_kind, "real");

    const signedIn = await exchangeMemberAccess(
      db,
      requested.credential,
      false,
    );
    assert.equal(signedIn.member.id, "existing-member");
    assert.ok(await memberSession(db, signedIn.credential));
    assert.equal(
      (await db.query("select id from uptick_members")).length,
      1,
      "sign-in must reuse the verified account rather than start a new enrollment",
    );
  } finally {
    await db.close?.();
    useLocalTestEnvironment();
    delete process.env.PILOT_ENROLLMENT_ENABLED;
    delete process.env.LEGAL_APPROVED;
    delete process.env.BUSINESS_LEGAL_NAME;
    delete process.env.SUPPORT_EMAIL;
  }
});
