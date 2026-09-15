import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import { claimMemberDrop } from "../src/lib/network";
import {
  issueIncidentRecovery,
  releaseWeeklyBenefits,
  reportMemberFulfillmentIncident,
} from "../src/lib/pilot-promise";
import { decrypt, encrypt, hash, token } from "../src/lib/security";
import { redeemAtPoint } from "../src/lib/tap";
import { seedSyntheticPilot } from "../scripts/verify-postgres-pilot";

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

async function seedRecovery(db: DB, count: number, prefix: string) {
  const fixture = await seedSyntheticPilot(db, count, prefix);
  const published = await releaseWeeklyBenefits(db, fixture.actor, {
    runId: fixture.runId,
    marketId: fixture.marketId,
    weekKey: fixture.weekKey,
    dataKind: "synthetic",
    requestKey: `${prefix}-release`,
    assignments: fixture.members.map((member) => ({
      memberId: member.id,
      supplyId: fixture.supplyId,
    })),
  });
  const incidentId = await reportMemberFulfillmentIncident(
    db,
    fixture.members[0].id,
    {
      grantId: published.grants[0].id,
      incidentType: "out_of_stock",
      severity: "high",
      occurredAt: new Date().toISOString(),
      owner: "Uptick member support",
      note: "The promised item was unavailable at the staffed counter.",
      idempotencyKey: `${prefix}-incident`,
    },
  );
  const [readiness] = await db.query<{ valid_until: string | Date }>(
    "select valid_until from destination_readiness where supply_id=$1",
    [fixture.supplyId],
  );
  return {
    fixture,
    grant: published.grants[0],
    incidentId,
    validUntil: new Date(readiness.valid_until).getTime(),
  };
}

type Seeded = Awaited<ReturnType<typeof seedRecovery>>;

function recoveryRequest(
  seeded: Seeded,
  overrides: Partial<{
    expiresAt: string;
    supersedesRecoveryId: string | null;
    failureReason: string;
    physicalHandoff: "not_received" | "unknown";
  }> = {},
) {
  return {
    incidentId: seeded.incidentId,
    remedyType: "same_counter" as const,
    fallbackId: seeded.fixture.fallbackId,
    replacementSupplyId: null,
    payerOrganizationId: seeded.fixture.actor.organizationId,
    payerEvidence: "Synthetic prepaid fallback inventory ledger.",
    expiresAt: new Date(
      Math.min(Date.now() + 60 * 60 * 1000, seeded.validUntil - 60_000),
    ).toISOString(),
    ...overrides,
  };
}

async function claimRecovery(db: DB, seeded: Seeded) {
  const accessToken = token();
  await db.query(
    `insert into member_access(
      id,member_id,token_hash,token_encrypted,purpose,expires_at,confirmed_at,
      disclosure,home_zip,age_attested
     ) values($1,$2,$3,$4,'access',now()+interval '30 days',now(),
      'Synthetic recovery supersession verification','10001',true)`,
    [
      `${seeded.fixture.runId}-access`,
      seeded.fixture.members[0].id,
      hash(accessToken),
      encrypt(accessToken),
    ],
  );
  const claim = await claimMemberDrop(db, accessToken, seeded.fixture.supplyId);
  return { claim, privatePass: decrypt(claim.token_encrypted) };
}

function successorRequest(
  seeded: Seeded,
  predecessorId: string,
  overrides: Partial<ReturnType<typeof recoveryRequest>> = {},
) {
  return recoveryRequest(seeded, {
    supersedesRecoveryId: predecessorId,
    failureReason:
      "The member reached the counter but the physical substitute was not received.",
    physicalHandoff: "not_received",
    ...overrides,
  });
}

test("an unredeemed same-counter failure gets one backed successor and releases its old reservation", async () => {
  await withDatabase(async (db) => {
    const seeded = await seedRecovery(db, 1, "recover-successor");
    const firstId = await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      recoveryRequest(seeded),
    );
    const successorId = await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      successorRequest(seeded, firstId),
    );

    const rows = await db.query<{
      id: string;
      supersedes_recovery_id: string | null;
      superseded_at: string | null;
    }>(
      "select id,supersedes_recovery_id,superseded_at from recovery_grants order by issued_at,id",
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.find((row) => row.id === firstId)?.superseded_at);
    assert.equal(
      rows.find((row) => row.id === successorId)?.supersedes_recovery_id,
      firstId,
    );
    assert.deepEqual(
      await db.query(
        "select recovery_id,successor_id,physical_handoff,reason from recovery_failures",
      ),
      [
        {
          recovery_id: firstId,
          successor_id: successorId,
          physical_handoff: "not_received",
          reason:
            "The member reached the counter but the physical substitute was not received.",
        },
      ],
    );
    assert.equal(
      (
        await db.query<{ used: number }>(
          `select count(*)::int used from recovery_grants
           where fallback_id=$1 and (state='redeemed' or (superseded_at is null and expires_at>now()))`,
          [seeded.fixture.fallbackId],
        )
      )[0].used,
      1,
    );
  });
});

test("a failed recovery after digital use can be replaced and both physical-use records remain", async () => {
  await withDatabase(async (db) => {
    const seeded = await seedRecovery(db, 2, "recover-after-use");
    const firstId = await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      recoveryRequest(seeded),
    );
    const { claim, privatePass } = await claimRecovery(db, seeded);
    const firstUse = await redeemAtPoint(db, privatePass, {
      pointToken: seeded.fixture.pointToken,
    });
    assert.ok("recovery" in firstUse);

    const successorId = await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      successorRequest(seeded, firstId, { physicalHandoff: "unknown" }),
    );
    const secondUse = await redeemAtPoint(db, privatePass, {
      pointToken: seeded.fixture.pointToken,
    });
    assert.ok("recovery" in secondUse);
    assert.equal(secondUse.recovery.id, successorId);
    assert.equal(secondUse.repeated, false);

    const evidence = await db.query<{
      recovery_grant_id: string;
      original_claim_id: string;
    }>(
      "select recovery_grant_id,original_claim_id from recovery_redemptions order by created_at,id",
    );
    assert.deepEqual(evidence, [
      { recovery_grant_id: firstId, original_claim_id: claim.id },
      { recovery_grant_id: successorId, original_claim_id: claim.id },
    ]);
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from claims where id=$1",
          [claim.id],
        )
      )[0].state,
      "invalidated",
    );
    assert.equal(
      (
        await db.query<{ used: number }>(
          "select count(*)::int used from recovery_grants where fallback_id=$1 and (state='redeemed' or (superseded_at is null and expires_at>now()))",
          [seeded.fixture.fallbackId],
        )
      )[0].used,
      2,
      "the redeemed predecessor still consumes physical capacity",
    );
  });
});

test("an invalidated original claim needs prior immutable recovery evidence", async () => {
  await withDatabase(async (db) => {
    const seeded = await seedRecovery(db, 2, "recover-no-evidence");
    const firstId = await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      recoveryRequest(seeded),
    );
    const { claim, privatePass } = await claimRecovery(db, seeded);
    await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      successorRequest(seeded, firstId),
    );
    await db.query("update claims set state='invalidated' where id=$1", [
      claim.id,
    ]);

    await assert.rejects(
      redeemAtPoint(db, privatePass, {
        pointToken: seeded.fixture.pointToken,
      }),
      /original pass can no longer use its recovery/i,
    );
    assert.equal(
      (await db.query("select * from recovery_redemptions")).length,
      0,
    );
  });
});

test("concurrent successor requests and exact retries converge while mismatched evidence is rejected", async () => {
  await withDatabase(async (db) => {
    const seeded = await seedRecovery(db, 1, "recover-concurrent");
    const firstId = await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      recoveryRequest(seeded),
    );
    const request = successorRequest(seeded, firstId);
    const [first, second] = await Promise.all([
      issueIncidentRecovery(db, seeded.fixture.actor, request),
      issueIncidentRecovery(db, seeded.fixture.actor, request),
    ]);
    assert.equal(first, second);
    assert.equal(
      await issueIncidentRecovery(db, seeded.fixture.actor, request),
      first,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from recovery_grants where original_grant_id=$1 and superseded_at is null",
          [seeded.grant.id],
        )
      )[0].count,
      1,
    );
    assert.equal((await db.query("select * from recovery_failures")).length, 1);

    await assert.rejects(
      issueIncidentRecovery(db, seeded.fixture.actor, {
        ...request,
        failureReason:
          "A different replayed description says the substitute was unavailable.",
      }),
      /different failure evidence/i,
    );
    await assert.rejects(
      issueIncidentRecovery(db, seeded.fixture.actor, {
        ...request,
        physicalHandoff: "unknown",
      }),
      /different failure evidence/i,
    );
  });
});

test("an underbacked successor rolls back and leaves the old recovery active", async () => {
  await withDatabase(async (db) => {
    const seeded = await seedRecovery(db, 1, "recover-rollback");
    const firstId = await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      recoveryRequest(seeded),
    );

    await assert.rejects(
      issueIncidentRecovery(
        db,
        seeded.fixture.actor,
        successorRequest(seeded, firstId, {
          expiresAt: new Date(seeded.validUntil + 60_000).toISOString(),
        }),
      ),
      /not independently ready and funded/i,
    );
    assert.deepEqual(
      await db.query(
        "select id,superseded_at from recovery_grants order by issued_at,id",
      ),
      [{ id: firstId, superseded_at: null }],
    );
    assert.equal((await db.query("select * from recovery_failures")).length, 0);

    const successorId = await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      successorRequest(seeded, firstId),
    );
    assert.notEqual(successorId, firstId);
  });
});

test("a funded recovery may remain valid across its release week and the pilot end", async () => {
  await withDatabase(async (db) => {
    const seeded = await seedRecovery(db, 1, "recover-cross-pilot");
    const [bounds] = await db.query<{
      ends_on: string | Date;
      supply_expires_at: string | Date;
    }>(
      `select p.ends_on,s.expires_at supply_expires_at
       from pilot_runs p join network_drop_supplies s on s.market_id=p.market_id
       where p.id=$1 and s.id=$2`,
      [seeded.fixture.runId, seeded.fixture.supplyId],
    );
    const pilotEnd = new Date(bounds.ends_on).getTime();
    const supplyEnd = new Date(bounds.supply_expires_at).getTime();
    const expiresAt = new Date(pilotEnd + 24 * 60 * 60 * 1000);
    assert.ok(expiresAt.getTime() < supplyEnd);
    await db.query(
      "update destination_readiness set valid_until=$2 where supply_id=$1",
      [seeded.fixture.supplyId, new Date(supplyEnd).toISOString()],
    );

    const recoveryId = await issueIncidentRecovery(
      db,
      seeded.fixture.actor,
      recoveryRequest(seeded, { expiresAt: expiresAt.toISOString() }),
    );
    const [recovery] = await db.query<{ expires_at: string | Date }>(
      "select expires_at from recovery_grants where id=$1",
      [recoveryId],
    );
    assert.equal(
      new Date(recovery.expires_at).toISOString(),
      expiresAt.toISOString(),
    );
    assert.ok(new Date(recovery.expires_at).getTime() > pilotEnd);
  });
});
