import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import { growthProgramWorkspace } from "../src/lib/growth-programs";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "../scripts/verify-postgres-pilot";

process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";

function nextWeek(weekKey: string) {
  return new Date(Date.parse(`${weekKey}T12:00:00Z`) + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
}

function releaseInput(fixture: SyntheticPilotFixture, requestKey: string) {
  return {
    runId: fixture.runId,
    marketId: fixture.marketId,
    weekKey: fixture.weekKey,
    dataKind: "synthetic" as const,
    requestKey,
    assignments: fixture.members.map((member) => ({
      memberId: member.id,
      supplyId: fixture.supplyId,
    })),
  };
}

async function addProgram(
  db: DB,
  fixture: SyntheticPilotFixture,
  options: {
    status: "review" | "approved" | "active" | "terminated";
    currentVersion: 1 | 2;
    pendingVersion: number | null;
    approvedVersion: number | null;
    linkVersions: number[];
    linkWeek?: string;
    approvalRunId?: string;
  },
) {
  const programId = `${fixture.runId}-program`;
  const organizationId = fixture.actor.organizationId as string;
  const linkWeek = options.linkWeek ?? fixture.weekKey;
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into growth_programs(
        id,buyer_organization_id,market_id,status,current_version,
        pending_version,approved_version,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        programId,
        organizationId,
        fixture.marketId,
        options.status,
        options.currentVersion,
        options.pendingVersion,
        options.approvedVersion,
        fixture.actor.id,
      ],
    );
    for (let version = 1; version <= options.currentVersion; version++) {
      await tx.query(
        `insert into growth_program_versions(
          program_id,version,name,objective,starts_on,ends_on,
          buyer_organization_id,funder_organization_id,
          fulfiller_organization_id,negotiated_fee_cents,commercial_status,
          benefit_ceiling,operating_constraints,evaluation_plan,proposed_by
         ) values($1,$2,'Synthetic retained-link Program','introduce_store',
          $3,$4,$5,$5,$5,25000,'agreed',200,
          'Release only backed supply under the approved version.',
          'Verify immutable links and grant attribution.',$6)`,
        [
          programId,
          version,
          fixture.weekKey,
          nextWeek(fixture.weekKey),
          organizationId,
          fixture.actor.id,
        ],
      );
      await tx.query(
        "insert into growth_program_week_plans(program_id,program_version,week_key,planned_placements) values($1,$2,$3,200)",
        [programId, version, linkWeek],
      );
    }
    for (const version of options.linkVersions)
      await tx.query(
        "insert into program_supply_links(program_id,program_version,supply_id,week_key,linked_by) values($1,$2,$3,$4,$5)",
        [programId, version, fixture.supplyId, linkWeek, fixture.actor.id],
      );
    if (options.approvedVersion !== null && options.approvalRunId)
      await tx.query(
        `insert into growth_program_approvals(
          id,program_id,program_version,run_id,decision,capacity_snapshot,note,decided_by
         ) values($1,$2,$3,$4,'approved','{}',
          'Synthetic run-specific approval for effective-version regression coverage.',$5)`,
        [
          `${programId}-approval-${options.approvedVersion}`,
          programId,
          options.approvedVersion,
          options.approvalRunId,
          fixture.actor.id,
        ],
      );
  });
  return programId;
}

test("retained v1 and approved v2 links release with v2 attribution", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 2, "effective-v2");
    const programId = await addProgram(db, fixture, {
      status: "approved",
      currentVersion: 2,
      pendingVersion: null,
      approvedVersion: 2,
      linkVersions: [1, 2],
      approvalRunId: fixture.runId,
    });

    const published = await releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseInput(fixture, "effective-v2-release"),
    );
    assert.equal(published.grants.length, 2);
    const grants = await db.query<{
      source_program_id: string | null;
      source_program_version: number | null;
    }>(
      "select source_program_id,source_program_version from fulfillment_grants order by member_id",
    );
    assert.deepEqual(
      grants,
      fixture.members.map(() => ({
        source_program_id: programId,
        source_program_version: 2,
      })),
      "every new grant must use the run-approved effective version",
    );
    const links = await db.query<{ program_version: number }>(
      "select program_version from program_supply_links where program_id=$1 and supply_id=$2 order by program_version",
      [programId, fixture.supplyId],
    );
    assert.deepEqual(
      links.map((link) => link.program_version),
      [1, 2],
      "selecting v2 must retain the immutable v1 link history",
    );
  } finally {
    await db.close?.();
  }
});

test("growth reporting keeps v1-issued history after v2 approval", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "reported-v1-history");
    const programId = await addProgram(db, fixture, {
      status: "approved",
      currentVersion: 2,
      pendingVersion: 2,
      approvedVersion: 1,
      linkVersions: [1, 2],
      approvalRunId: fixture.runId,
    });

    const publishedV1 = await releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseInput(fixture, "reported-v1-history-release"),
    );
    assert.equal(publishedV1.grants[0].source_program_version, 1);

    await db.transaction(async (tx) => {
      await tx.query(
        `insert into growth_program_approvals(
          id,program_id,program_version,run_id,decision,capacity_snapshot,note,
          decided_by
         ) values($1,$2,2,$3,'approved','{}',
          'Synthetic v2 approval after the v1 release was already issued.',$4)`,
        [`${programId}-approval-2`, programId, fixture.runId, fixture.actor.id],
      );
      await tx.query(
        "update growth_programs set approved_version=2,pending_version=null where id=$1",
        [programId],
      );
    });

    const workspace = await growthProgramWorkspace(db, fixture.actor);
    const history = workspace.executions
      .filter((row) => row.program_id === programId)
      .map((row) => ({
        version: Number(row.program_version),
        issued: Number(row.issued),
      }));
    assert.deepEqual(history, [
      { version: 1, issued: 1 },
      { version: 2, issued: 0 },
    ]);
  } finally {
    await db.close?.();
  }
});

test("a supply linked commercially for another week cannot release as organic", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "wrong-week-program");
    await addProgram(db, fixture, {
      status: "approved",
      currentVersion: 1,
      pendingVersion: null,
      approvedVersion: 1,
      linkVersions: [1],
      linkWeek: nextWeek(fixture.weekKey),
      approvalRunId: fixture.runId,
    });
    await assert.rejects(
      releaseWeeklyBenefits(
        db,
        fixture.actor,
        releaseInput(fixture, "wrong-week-program-release"),
      ),
      /Program|commercial|attribution/i,
    );
    assert.equal(
      (await db.query("select id from fulfillment_grants")).length,
      0,
      "a wrong-week paid link must fail closed instead of becoming organic",
    );
  } finally {
    await db.close?.();
  }
});

for (const scenario of [
  {
    name: "pending",
    status: "review" as const,
    pendingVersion: 1,
    approvedVersion: null,
    approvalRunId: undefined,
  },
  {
    name: "terminated",
    status: "terminated" as const,
    pendingVersion: null,
    approvedVersion: 1,
    approvalRunId: "CURRENT_RUN",
  },
  {
    name: "approved for a different run",
    status: "approved" as const,
    pendingVersion: null,
    approvedVersion: 1,
    approvalRunId: "another-pilot-run",
  },
]) {
  test(`${scenario.name} commercial context rejects the release`, async () => {
    const db = await memoryDb();
    try {
      const prefix = `program-${scenario.name.replaceAll(" ", "-")}`;
      const fixture = await seedSyntheticPilot(db, 1, prefix);
      await addProgram(db, fixture, {
        status: scenario.status,
        currentVersion: 1,
        pendingVersion: scenario.pendingVersion,
        approvedVersion: scenario.approvedVersion,
        linkVersions: [1],
        approvalRunId:
          scenario.approvalRunId === "CURRENT_RUN"
            ? fixture.runId
            : scenario.approvalRunId,
      });
      await assert.rejects(
        releaseWeeklyBenefits(
          db,
          fixture.actor,
          releaseInput(fixture, `${prefix}-release`),
        ),
        /approved Program version|commercial|attribution/i,
      );
      assert.equal(
        (await db.query("select id from fulfillment_grants")).length,
        0,
        "invalid commercial context must never be recorded as organic",
      );
    } finally {
      await db.close?.();
    }
  });
}
