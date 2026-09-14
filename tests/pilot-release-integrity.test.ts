import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { memoryDb } from "../src/lib/db";
import {
  issueIncidentRecovery,
  releaseWeeklyBenefits,
  reportMemberFulfillmentIncident,
} from "../src/lib/pilot-promise";
import { seedSyntheticPilot } from "../scripts/verify-postgres-pilot";

process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";

type Fixture = Awaited<ReturnType<typeof seedSyntheticPilot>>;

function releaseFor(fixture: Fixture, requestKey: string) {
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

// --- Defect B: frozen obligations are independent of mutable geography ------

test("a frozen cohort still releases after an admitted member changes ZIP or loses a resolved market", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 3, "geo-change");
    // One member moves out of the cell, another has no resolved market at all.
    await db.query(
      "update uptick_members set home_zip='07030',market_id=null where id=$1",
      [fixture.members[0].id],
    );
    await db.query("update uptick_members set work_zip='07030' where id=$1", [
      fixture.members[1].id,
    ]);
    const published = await releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseFor(fixture, "geo-change-release"),
    );
    assert.equal(
      published.grants.length,
      3,
      "every admitted member keeps the week their frozen cohort committed",
    );
  } finally {
    await db.close?.();
  }
});

test("without a frozen run the release still resolves its audience by current market", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 2, "geo-nofreeze");
    await db.query("update uptick_members set market_id=null where id=$1", [
      fixture.members[0].id,
    ]);
    await assert.rejects(
      releaseWeeklyBenefits(db, fixture.actor, {
        ...releaseFor(fixture, "geo-nofreeze-release"),
        runId: undefined as unknown as string,
      }),
      /active, verified, adult-confirmed/,
    );
  } finally {
    await db.close?.();
  }
});

// --- Defect C: pending paid supply is never misclassified as organic -------

async function linkProgram(
  db: Awaited<ReturnType<typeof memoryDb>>,
  fixture: Fixture,
  opts: {
    status: string;
    currentVersion: number;
    pendingVersion: number | null;
    approvedVersion: number | null;
    linkVersion: number;
  },
) {
  const programId = "pending-program";
  const org = fixture.actor.organizationId as string;
  // The version foreign keys are deferrable and initially deferred, so the
  // program row and its versions have to land in one transaction.
  await db.transaction(async (tx) => {
    await tx.query(
      "insert into growth_programs(id,buyer_organization_id,market_id,status,current_version,pending_version,approved_version,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        programId,
        org,
        fixture.marketId,
        opts.status,
        opts.currentVersion,
        opts.pendingVersion,
        opts.approvedVersion,
        fixture.actor.id,
      ],
    );
    for (let version = 1; version <= opts.currentVersion; version++) {
      await tx.query(
        `insert into growth_program_versions(
        program_id,version,name,objective,starts_on,ends_on,buyer_organization_id,
        funder_organization_id,fulfiller_organization_id,negotiated_fee_cents,
        commercial_status,benefit_ceiling,operating_constraints,evaluation_plan,proposed_by
       ) values($1,$2,'Synthetic paid program','introduce_store',$3,$3,$4,$4,$4,25000,
        'agreed',50,'Synthetic operating constraints for the test.',
        'Synthetic evaluation plan for the test.',$5)`,
        [programId, version, fixture.weekKey, org, fixture.actor.id],
      );
      await tx.query(
        "insert into growth_program_week_plans(program_id,program_version,week_key,planned_placements) values($1,$2,$3,5)",
        [programId, version, fixture.weekKey],
      );
    }
    await tx.query(
      "insert into program_supply_links(program_id,program_version,supply_id,week_key,linked_by) values($1,$2,$3,$4,$5)",
      [
        programId,
        opts.linkVersion,
        fixture.supplyId,
        fixture.weekKey,
        fixture.actor.id,
      ],
    );
  });
}

test("supply linked to a pending, unapproved Program is rejected rather than released as organic", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "pending-link");
    await linkProgram(db, fixture, {
      status: "review",
      currentVersion: 1,
      pendingVersion: 1,
      approvedVersion: null,
      linkVersion: 1,
    });
    await assert.rejects(
      releaseWeeklyBenefits(
        db,
        fixture.actor,
        releaseFor(fixture, "pending-link-release"),
      ),
      /approved Program version for this pilot run/,
    );
    assert.equal(
      (await db.query("select * from fulfillment_grants")).length,
      0,
      "a pending commercial link must not quietly produce an organic grant",
    );
  } finally {
    await db.close?.();
  }
});

test("supply linked to a superseded Program version is rejected rather than released as organic", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "superseded-link");
    // Version 2 is the approved one; the supply is still linked to version 1.
    await linkProgram(db, fixture, {
      status: "approved",
      currentVersion: 2,
      pendingVersion: null,
      approvedVersion: 2,
      linkVersion: 1,
    });
    await assert.rejects(
      releaseWeeklyBenefits(
        db,
        fixture.actor,
        releaseFor(fixture, "superseded-link-release"),
      ),
      /approved Program version for this pilot run/,
    );
    assert.equal(
      (await db.query("select * from fulfillment_grants")).length,
      0,
    );
  } finally {
    await db.close?.();
  }
});

test("supply linked to a terminated Program is rejected rather than released as organic", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "terminated-link");
    await linkProgram(db, fixture, {
      status: "terminated",
      currentVersion: 1,
      pendingVersion: null,
      approvedVersion: 1,
      linkVersion: 1,
    });
    await assert.rejects(
      releaseWeeklyBenefits(
        db,
        fixture.actor,
        releaseFor(fixture, "terminated-link-release"),
      ),
      /approved Program version for this pilot run/,
    );
    assert.equal(
      (await db.query("select * from fulfillment_grants")).length,
      0,
    );
  } finally {
    await db.close?.();
  }
});

test("genuinely unlinked supply is still released as organic", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "organic-link");
    const published = await releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseFor(fixture, "organic-link-release"),
    );
    assert.equal(published.grants.length, 1);
    const [grant] = await db.query<{ source_program_id: string | null }>(
      "select source_program_id from fulfillment_grants",
    );
    assert.equal(
      grant.source_program_id,
      null,
      "unlinked supply carries no commercial attribution",
    );
  } finally {
    await db.close?.();
  }
});

// --- Defect F: approved status is not the same as available capacity ------

test("a stale exhausted flag does not permanently disable a fallback that has capacity", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 2, "fallback-reclaim");
    const published = await releaseWeeklyBenefits(
      db,
      fixture.actor,
      releaseFor(fixture, "fallback-reclaim-release"),
    );
    const [readiness] = await db.query<{ valid_until: string | Date }>(
      "select valid_until from destination_readiness where supply_id=$1",
      [fixture.supplyId],
    );
    const expiresAt = new Date(
      new Date(readiness.valid_until).getTime() - 60000,
    ).toISOString();

    const recover = async (index: number, key: string) => {
      const incidentId = await reportMemberFulfillmentIncident(
        db,
        fixture.members[index].id,
        {
          grantId: published.grants[index].id,
          incidentType: "out_of_stock",
          severity: "high",
          occurredAt: new Date().toISOString(),
          owner: "Uptick member support",
          note: "Fallback reclaim regression fixture.",
          idempotencyKey: key,
        },
      );
      return issueIncidentRecovery(db, fixture.actor, {
        incidentId,
        remedyType: "same_counter",
        fallbackId: fixture.fallbackId,
        replacementSupplyId: null,
        payerOrganizationId: fixture.actor.organizationId,
        payerEvidence: "Synthetic prepaid fallback inventory ledger.",
        expiresAt,
      });
    };

    await recover(0, "fallback-reclaim-incident-0");
    // Simulate the terminal flag left behind by an earlier reservation that
    // was never consumed. Real capacity is 2 and only one unit is reserved.
    await db.query(
      "update pilot_supply_fallbacks set state='exhausted' where id=$1",
      [fixture.fallbackId],
    );
    await recover(1, "fallback-reclaim-incident-1");
    assert.equal(
      (await db.query("select * from recovery_grants")).length,
      2,
      "available capacity, not a stale status flag, decides recovery",
    );
    const [fallback] = await db.query<{ state: string }>(
      "select state from pilot_supply_fallbacks where id=$1",
      [fixture.fallbackId],
    );
    assert.equal(
      fallback.state,
      "exhausted",
      "capacity is now genuinely consumed, which is recorded for the operator",
    );
  } finally {
    await db.close?.();
  }
});

// --- Defect G: historical STOP survives a sender rotation ------------------

async function reconcileSuppressions(db: Awaited<ReturnType<typeof memoryDb>>) {
  const sql = await readFile(
    "db/migrations/022_suppression_reconciliation.sql",
    "utf8",
  );
  await db.query(sql);
}

async function seedSenders(db: Awaited<ReturnType<typeof memoryDb>>) {
  await db.query(
    "insert into member_senders(id,service_sid,phone,approved,active) values('old-sender',$1,'+12125550001',true,false)",
    ["MG" + "a".repeat(32)],
  );
  await db.query(
    "insert into member_senders(id,service_sid,phone,approved,active) values('new-sender',$1,'+12125550002',true,true)",
    ["MG" + "b".repeat(32)],
  );
}

test("a pre-014 sender-level STOP becomes a program-wide suppression", async () => {
  const db = await memoryDb();
  try {
    await seedSenders(db);
    await db.query(
      "insert into member_suppressions(phone,sender_id,suppressed,updated_at) values('+12125559001','old-sender',true,now()-interval '30 days')",
    );
    await db.query("delete from member_global_suppressions");
    await reconcileSuppressions(db);
    const [row] = await db.query<{ suppressed: boolean }>(
      "select suppressed from member_global_suppressions where phone='+12125559001'",
    );
    assert.equal(
      row?.suppressed,
      true,
      "rotating the sender must not resurrect a stopped member",
    );
  } finally {
    await db.close?.();
  }
});

test("a later START recorded against the same sender is preserved, not re-suppressed", async () => {
  const db = await memoryDb();
  try {
    await seedSenders(db);
    await db.query(
      "insert into member_suppressions(phone,sender_id,suppressed,updated_at) values('+12125559002','old-sender',false,now()-interval '5 days')",
    );
    await db.query("delete from member_global_suppressions");
    await reconcileSuppressions(db);
    const [row] = await db.query<{ suppressed: boolean }>(
      "select suppressed from member_global_suppressions where phone='+12125559002'",
    );
    assert.equal(row?.suppressed, false);
  } finally {
    await db.close?.();
  }
});

test("a newer global record is never overwritten by older sender-level history", async () => {
  const db = await memoryDb();
  try {
    await seedSenders(db);
    await db.query(
      "insert into member_suppressions(phone,sender_id,suppressed,updated_at) values('+12125559003','old-sender',true,now()-interval '30 days')",
    );
    await db.query(
      "insert into member_global_suppressions(phone,suppressed,source_sender_id,updated_at) values('+12125559003',false,'new-sender',now())",
    );
    await reconcileSuppressions(db);
    const [row] = await db.query<{ suppressed: boolean }>(
      "select suppressed from member_global_suppressions where phone='+12125559003'",
    );
    assert.equal(
      row?.suppressed,
      false,
      "the more recent program-wide decision stands",
    );
  } finally {
    await db.close?.();
  }
});

test("conflicting sender-level rows at the same instant resolve conservatively to STOP", async () => {
  const db = await memoryDb();
  try {
    await seedSenders(db);
    await db.query(
      "insert into member_suppressions(phone,sender_id,suppressed,updated_at) values('+12125559004','old-sender',false,'2026-01-01T00:00:00Z')",
    );
    await db.query(
      "insert into member_suppressions(phone,sender_id,suppressed,updated_at) values('+12125559004','new-sender',true,'2026-01-01T00:00:00Z')",
    );
    await db.query("delete from member_global_suppressions");
    await reconcileSuppressions(db);
    const [row] = await db.query<{ suppressed: boolean }>(
      "select suppressed from member_global_suppressions where phone='+12125559004'",
    );
    assert.equal(row?.suppressed, true, "ambiguity never discards an opt-out");
  } finally {
    await db.close?.();
  }
});

test("the reconciliation is idempotent", async () => {
  const db = await memoryDb();
  try {
    await seedSenders(db);
    await db.query(
      "insert into member_suppressions(phone,sender_id,suppressed,updated_at) values('+12125559005','old-sender',true,now()-interval '9 days')",
    );
    await db.query("delete from member_global_suppressions");
    await reconcileSuppressions(db);
    await reconcileSuppressions(db);
    await reconcileSuppressions(db);
    const rows = await db.query(
      "select * from member_global_suppressions where phone='+12125559005'",
    );
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as { suppressed: boolean }).suppressed, true);
  } finally {
    await db.close?.();
  }
});
