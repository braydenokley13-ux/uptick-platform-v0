import assert from "node:assert/strict";
import type { DB } from "../src/lib/db";

// One shared lock order protects every operation that touches both the Growth
// Program coordination singleton and a pilot run:
//
//   growth_program_coordination -> pilot_runs -> market_cells ->
//   growth_programs -> network_drop_supplies (id asc) -> uptick_members (id asc)
//
// Growth Program approval already took the coordination singleton before the
// pilot run. The weekly release took the pilot run first and the coordination
// singleton last, so an approval and a release running at the same time could
// each hold what the other needed. This check drives both interleavings from
// separate PostgreSQL sessions and proves the ordering, not the absence of
// luck: the opposing order is expected to deadlock, the shared order is not.

type Order = "coordination-first" | "run-first";

async function holdBothLocks(db: DB, runId: string, order: Order) {
  return db.transaction(async (tx) => {
    if (order === "coordination-first") {
      await tx.query(
        "select singleton from growth_program_coordination where singleton=true for update",
      );
      await tx.query("select id from pilot_runs where id=$1 for update", [
        runId,
      ]);
    } else {
      await tx.query("select id from pilot_runs where id=$1 for update", [
        runId,
      ]);
      // Give the opposing session time to take the lock this one needs next.
      await tx.query("select pg_sleep(0.15)");
      await tx.query(
        "select singleton from growth_program_coordination where singleton=true for update",
      );
    }
    return order;
  });
}

async function race(db: DB, runId: string, opposing: Order) {
  const results = await Promise.allSettled([
    holdBothLocks(db, runId, "coordination-first"),
    holdBothLocks(db, runId, opposing),
  ]);
  return results.filter(
    (result) =>
      result.status === "rejected" &&
      /deadlock detected/i.test(
        String(result.reason?.message ?? result.reason),
      ),
  ).length;
}

export async function verifyLockOrderPostgres(db: DB) {
  const [run] = await db.query<{ id: string }>(
    "select id from pilot_runs order by id limit 1",
  );
  assert.ok(run, "the pilot fixture must have created a run to lock");
  await db.query(
    "insert into growth_program_coordination(singleton) values(true) on conflict do nothing",
  );

  // The order the code used before the fix still deadlocks, which is what
  // makes the shared order worth enforcing rather than assuming.
  let opposingDeadlocks = 0;
  for (let attempt = 0; attempt < 6 && opposingDeadlocks === 0; attempt++)
    opposingDeadlocks += await race(db, run.id, "run-first");
  assert.ok(
    opposingDeadlocks > 0,
    "the opposing lock order should still be able to deadlock; if it cannot, this check is no longer proving anything",
  );
  console.log(
    "PASS: the opposing growth_program_coordination/pilot_runs order deadlocks under separate-session contention, as the defect described.",
  );

  // The shared order must never deadlock, however the sessions interleave.
  for (let attempt = 0; attempt < 12; attempt++) {
    const deadlocks = await race(db, run.id, "coordination-first");
    assert.equal(
      deadlocks,
      0,
      "two sessions using the shared lock order must serialize, never deadlock",
    );
  }
  console.log(
    "PASS: repeated separate-session contention under the shared lock order serializes without a deadlock.",
  );
}
