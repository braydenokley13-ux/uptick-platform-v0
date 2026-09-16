/* One readiness truth, two surfaces.

   The failure this prevents: the operator map reading "Real enrollment is held
   closed deliberately. Nothing technical is blocking it" while the server
   refuses every signup with a 503. That was possible because the map derived
   its own answer from the same data the server gate read — encoding four of
   the nine conditions the server actually enforces, and silently omitting job
   health, access messaging, privacy policy currency, the suppression key and
   operator MFA.

   These tests assert the relationship rather than any particular gate: if the
   server would refuse, some gate must say so. */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";
import { readinessGates } from "../src/lib/operator-readiness";
import {
  assertRealEnrollmentCommissioned,
  enrollmentBlockers,
  releaseReadiness,
} from "../src/lib/release-readiness";

function localEnvironment() {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
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

test("no gate reads ready while the server would refuse enrollment", async () => {
  await withDatabase(async (db) => {
    const readiness = await releaseReadiness(db);
    const blockers = enrollmentBlockers(readiness);
    const gates = await readinessGates(db);
    const upstream = gates.filter((gate) => gate.key !== "enrollment");

    assert.ok(
      blockers.length > 0,
      "a bare database is not commissioned; this fixture is meaningless otherwise",
    );
    await assert.rejects(assertRealEnrollmentCommissioned(db));

    assert.ok(
      upstream.some((gate) => gate.state !== "ready"),
      "the server refuses, so the map must not be all-green",
    );

    /* Every blocker has a gate that owns it, and that gate is not ready. */
    for (const blocker of blockers) {
      const owner = upstream.find((gate) => gate.key === blocker.gate);
      assert.ok(owner, `no gate owns blocker ${blocker.key} (${blocker.gate})`);
      assert.notEqual(
        owner.state,
        "ready",
        `${owner.label} reads ready while "${blocker.detail}" blocks enrollment`,
      );
    }
  });
});

test("every server condition is owned by a gate the map renders", async () => {
  await withDatabase(async (db) => {
    const gates = await readinessGates(db);
    const keys = new Set(gates.map((gate) => gate.key));
    const blockers = enrollmentBlockers(await releaseReadiness(db));
    const orphans = [
      ...new Set(blockers.filter((b) => !keys.has(b.gate)).map((b) => b.gate)),
    ];
    assert.deepEqual(
      orphans,
      [],
      "a condition the server enforces with no gate to show it is invisible to the operator",
    );
  });
});

test("the enrollment gate names the gates that are actually blocking", async () => {
  await withDatabase(async (db) => {
    const gates = await readinessGates(db);
    const enrollment = gates.find((gate) => gate.key === "enrollment")!;
    const blocking = gates.filter(
      (gate) => gate.key !== "enrollment" && gate.state !== "ready",
    );
    assert.ok(blocking.length);
    /* Enrollment is held closed by default, so it reports "closed" and still
       has to account for what is open upstream. */
    assert.equal(enrollment.state, "closed");
    assert.match(enrollment.blocker, /upstream gate/i);
  });
});

test("a Market Cell is not ready merely because its state column says pilot", async () => {
  await withDatabase(async (db) => {
    await db.query(
      "insert into market_cells(id,name,slug,timezone,state,data_kind) values('real-cell','Real Cell','real-cell','America/New_York','pilot','real')",
    );
    const gates = await readinessGates(db);
    const market = gates.find((gate) => gate.key === "market")!;
    assert.notEqual(
      market.state,
      "ready",
      "no supply, no fallback and no rehearsed destination exist behind this cell",
    );
    assert.match(market.blocker, /weeks backed|approved supply|fallback/i);
  });
});
