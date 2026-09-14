import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDb } from "../src/lib/db";
import { seed } from "../src/lib/seed";
import { seedSyntheticPilot } from "./verify-postgres-pilot";

// Never target the application's saved local database or a hosted connection.
assert.ok(
  process.env.LOCAL_DATABASE_PATH?.startsWith(
    "/private/tmp/uptick-browser-rehearsal-",
  ),
);
assert.equal(process.env.DATABASE_URL, undefined);
const db = await getDb();
try {
  await seed(db);
  const fixture = await seedSyntheticPilot(db, 3, "browser-pilot");
  const file = resolve(
    process.env.LOCAL_DATABASE_PATH!,
    "browser-fixture.json",
  );
  await writeFile(file, JSON.stringify(fixture), { mode: 0o600 });
  console.log(
    "Created isolated synthetic browser rehearsal: 3 members; no issued grants; no real SMS.",
  );
} finally {
  await db.close?.();
}
