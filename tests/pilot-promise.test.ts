import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb } from "../src/lib/db";
import {
  allocationView,
  claimMemberDrop,
  type Allocation,
} from "../src/lib/network";
import {
  issueIncidentRecovery,
  releaseWeeklyBenefits,
  reportMemberFulfillmentIncident,
} from "../src/lib/pilot-promise";
import { decrypt, encrypt, hash, token } from "../src/lib/security";
import { redeemAtPoint } from "../src/lib/tap";
import {
  seedSyntheticPilot,
  verifyPilotPostgres,
} from "../scripts/verify-postgres-pilot";

process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";

test("150 grants, competing release workers, final stock, claim and post-redemption recovery stay atomic", async () => {
  const db = await memoryDb();
  try {
    const fixture = await verifyPilotPostgres(db);
    const [counts] = await db.query<{
      releases: number;
      grants: number;
      claims: number;
      recovery_redemptions: number;
    }>(
      `select
        (select count(*)::int from weekly_releases) releases,
        (select count(*)::int from fulfillment_grants) grants,
        (select count(*)::int from claims) claims,
        (select count(*)::int from recovery_redemptions) recovery_redemptions`,
    );
    assert.deepEqual(counts, {
      releases: 1,
      grants: 150,
      claims: 1,
      recovery_redemptions: 1,
    });
    const [allocation] = await db.query<Allocation>(
      "select * from member_allocations where member_id=$1",
      [fixture.members[0].id],
    );
    const promised = await allocationView(db, allocation);
    assert.equal(
      new Date(promised.options[0].expires_at).toISOString(),
      new Date(promised.grant!.expires_at).toISOString(),
    );
    assert.equal(promised.options[0].qualification, "No purchase required");
  } finally {
    await db.close?.();
  }
});

test("a release rolls back the whole reviewed cohort when primary stock is short", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 3, "shortfall-pilot");
    await db.query(
      "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values('shortfall-adjustment',$1,-1,'Synthetic setup creates a deliberate shortfall.','test')",
      [fixture.supplyId],
    );
    await assert.rejects(
      releaseWeeklyBenefits(db, fixture.actor, {
        runId: fixture.runId,
        marketId: fixture.marketId,
        weekKey: fixture.weekKey,
        dataKind: "synthetic",
        requestKey: "shortfall-release-request",
        assignments: fixture.members.map((member) => ({
          memberId: member.id,
          supplyId: fixture.supplyId,
        })),
      }),
      /inventory cannot cover/,
    );
    assert.equal((await db.query("select * from weekly_releases")).length, 0);
    assert.equal(
      (await db.query("select * from member_allocations")).length,
      0,
    );
    assert.equal(
      (await db.query("select * from fulfillment_grants")).length,
      0,
    );
  } finally {
    await db.close?.();
  }
});

test("stale stock and future-dated completion evidence cannot publish a promise", async () => {
  for (const scenario of ["stale", "future"] as const) {
    const db = await memoryDb();
    try {
      const fixture = await seedSyntheticPilot(db, 1, `${scenario}-readiness`);
      if (scenario === "stale")
        await db.query(
          "update destination_readiness set stock_confirmed_at=now()-interval '73 hours' where supply_id=$1",
          [fixture.supplyId],
        );
      else
        await db.query(
          "update destination_readiness set qr_rehearsed_at=now()+interval '1 hour' where supply_id=$1",
          [fixture.supplyId],
        );
      await assert.rejects(
        releaseWeeklyBenefits(db, fixture.actor, {
          runId: fixture.runId,
          marketId: fixture.marketId,
          weekKey: fixture.weekKey,
          dataKind: "synthetic",
          requestKey: `${scenario}-readiness-release`,
          assignments: [
            { memberId: fixture.members[0].id, supplyId: fixture.supplyId },
          ],
        }),
        /fully rehearsed pilot promise/,
      );
      assert.equal(
        (await db.query("select * from fulfillment_grants")).length,
        0,
      );
    } finally {
      await db.close?.();
    }
  }
});

test("an unclaimed failed grant can recover without recording a false original redemption", async () => {
  const db = await memoryDb();
  try {
    const fixture = await seedSyntheticPilot(db, 1, "preclaim-recovery");
    const published = await releaseWeeklyBenefits(db, fixture.actor, {
      runId: fixture.runId,
      marketId: fixture.marketId,
      weekKey: fixture.weekKey,
      dataKind: "synthetic",
      requestKey: "preclaim-recovery-release",
      assignments: [
        { memberId: fixture.members[0].id, supplyId: fixture.supplyId },
      ],
    });
    const grant = published.grants[0];
    const incidentId = await reportMemberFulfillmentIncident(
      db,
      fixture.members[0].id,
      {
        grantId: grant.id,
        incidentType: "out_of_stock",
        severity: "high",
        occurredAt: new Date().toISOString(),
        owner: "Uptick member support",
        note: "The exact promised item was unavailable before pass redemption.",
        idempotencyKey: "preclaim-recovery-incident",
      },
    );
    const recoveryId = await issueIncidentRecovery(db, fixture.actor, {
      incidentId,
      remedyType: "same_counter",
      fallbackId: fixture.fallbackId,
      replacementSupplyId: null,
      payerOrganizationId: fixture.actor.organizationId,
      payerEvidence: "Synthetic prepaid fallback inventory ledger.",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    assert.equal(
      (
        await db.query<{ original_claim_id: string | null }>(
          "select original_claim_id from recovery_grants where id=$1",
          [recoveryId],
        )
      )[0].original_claim_id,
      null,
    );
    const accessToken = token();
    await db.query(
      `insert into member_access(
        id,member_id,token_hash,token_encrypted,purpose,expires_at,confirmed_at,
        disclosure,home_zip,age_attested
       ) values('preclaim-recovery-access',$1,$2,$3,'access',now()+interval '30 days',
        now(),'Synthetic isolated verification','10001',true)`,
      [fixture.members[0].id, hash(accessToken), encrypt(accessToken)],
    );
    const claim = await claimMemberDrop(db, accessToken, fixture.supplyId);
    assert.equal(
      (
        await db.query<{ original_claim_id: string | null }>(
          "select original_claim_id from recovery_grants where id=$1",
          [recoveryId],
        )
      )[0].original_claim_id,
      claim.id,
    );
    const result = await redeemAtPoint(db, decrypt(claim.token_encrypted), {
      pointToken: fixture.pointToken,
    });
    assert.ok("recovery" in result);
    const repeated = await redeemAtPoint(db, decrypt(claim.token_encrypted), {
      pointToken: fixture.pointToken,
    });
    assert.equal(repeated.repeated, true);
    const [truth] = await db.query<{
      claim_state: string;
      original_redemptions: number;
      original_evidence: number;
      recovery_redemptions: number;
    }>(
      `select c.state claim_state,
        (select count(*)::int from redemptions where claim_id=c.id) original_redemptions,
        (select count(*)::int from redemption_evidence where claim_id=c.id) original_evidence,
        (select count(*)::int from recovery_redemptions where original_claim_id=c.id) recovery_redemptions
       from claims c where c.id=$1`,
      [claim.id],
    );
    assert.deepEqual(truth, {
      claim_state: "invalidated",
      original_redemptions: 0,
      original_evidence: 0,
      recovery_redemptions: 1,
    });
  } finally {
    await db.close?.();
  }
});

test("same-counter recovery requires a current ready destination, active QR and coverage through its expiry", async () => {
  for (const scenario of ["revoked-qr", "past-readiness"] as const) {
    const db = await memoryDb();
    try {
      const fixture = await seedSyntheticPilot(db, 1, scenario);
      const published = await releaseWeeklyBenefits(db, fixture.actor, {
        runId: fixture.runId,
        marketId: fixture.marketId,
        weekKey: fixture.weekKey,
        dataKind: "synthetic",
        requestKey: `${scenario}-release`,
        assignments: [
          { memberId: fixture.members[0].id, supplyId: fixture.supplyId },
        ],
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
          note: "Readiness rejection regression fixture.",
          idempotencyKey: `${scenario}-incident`,
        },
      );
      if (scenario === "revoked-qr")
        await db.query(
          "update redemption_credentials set state='revoked',revoked_at=now() where public_token=$1",
          [fixture.pointToken],
        );
      await assert.rejects(
        issueIncidentRecovery(db, fixture.actor, {
          incidentId,
          remedyType: "same_counter",
          fallbackId: fixture.fallbackId,
          replacementSupplyId: null,
          payerOrganizationId: fixture.actor.organizationId,
          payerEvidence: "Synthetic prepaid fallback inventory ledger.",
          expiresAt: new Date(
            Date.now() +
              (scenario === "past-readiness" ? 3 * 86400000 : 3600000),
          ).toISOString(),
        }),
        /not independently ready and funded/,
      );
      assert.equal((await db.query("select * from recovery_grants")).length, 0);
    } finally {
      await db.close?.();
    }
  }
});
