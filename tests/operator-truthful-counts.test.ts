/* Three surfaces that said more than their data supported.

   All three are the same shape as the findings this repair pass began with: a
   number or a verdict presented as one thing while being computed from another.
   Each is pinned here so the shortcut cannot come back. */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import { pilotOperations } from "../src/lib/pilot-operations";
import { membershipMessagingOperations } from "../src/lib/network-operations";
import { recordMemberServiceEvent } from "../src/lib/member-service";
import { id } from "../src/lib/security";
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

test("the blocking supply alarm measures the cohort the run owes, not its original target", async () => {
  await withDatabase(async (db) => {
    const fixture = await seedSyntheticPilot(db, 20, "tc-alarm");
    /* Five members leave a frozen twenty-member run. `amendPilotSupply` would
       now accept fifteen units for the remaining weeks, so an alarm that still
       compares against twenty calls a valid plan blocked. */
    for (const member of fixture.members.slice(0, 5))
      await recordMemberServiceEvent(db, fixture.actor, {
        memberId: member.id,
        kind: "withdrawn",
        reason: "Synthetic member withdrew before this week.",
        requestKey: `tc-alarm-withdraw-${member.id}`,
      });
    await db.query(
      "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values($1,$2,-5,'Synthetic reduction to the remaining cohort.',$3)",
      [id(), fixture.supplyId, fixture.actor.id],
    );

    const operations = await pilotOperations(db, fixture.actor, fixture.runId);
    assert.ok(operations.detail);
    const supply = operations.detail.constraints.filter(
      (constraint) => constraint.category === "Supply",
    );
    const blocking = supply.filter((constraint) => constraint.urgency === "bad");
    assert.ok(
      !blocking.some((constraint) => /of 20 target members/.test(constraint.text)),
      `week one backs the fifteen members still owed a benefit: ${blocking.map((c) => c.text).join(" | ")}`,
    );
    assert.ok(
      !blocking.some((constraint) => /Week 1:/.test(constraint.text)),
      "week one is not the short week",
    );
  });
});

test("messaging is not called ready while STOP and HELP are not being received", async () => {
  await withDatabase(async (db) => {
    await seedSyntheticPilot(db, 2, "tc-messaging");
    const actor = {
      id: "tc-operator",
      role: "operator" as const,
      organizationId: "tc-messaging-merchant",
    };
    const data = await membershipMessagingOperations(db, actor);
    /* Development transport can send, so the transport-only answer is yes. The
       console's verdict must still be no: without a current signed inbound
       callback, a member's STOP is not reaching Uptick. */
    assert.equal(data.readiness.sendReady, true);
    assert.equal(
      data.readiness.ready,
      false,
      "no signed callback has been observed for this scope",
    );
    assert.ok(
      !data.callbacks.some((callback) => callback.current),
      "and none of them is current",
    );
  });
});

test("the support queue reports every waiting member, not the page it shows", async () => {
  await withDatabase(async (db) => {
    await seedSyntheticPilot(db, 2, "tc-support");
    for (let n = 0; n < 25; n++)
      await db.query(
        "insert into member_support_requests(id,origin,state) values($1,'member_web','queued')",
        [`tc-support-${n}`],
      );

    const data = await membershipMessagingOperations(db, {
      id: "tc-operator",
      role: "operator",
      organizationId: "tc-support-merchant",
    });
    assert.equal(data.support.length, 20, "the rendered list stays bounded");
    assert.equal(
      data.supportTotal,
      25,
      "twenty-five waiting members are not reported as twenty",
    );
  });
});
