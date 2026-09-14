import type { DB } from "./db";
import { localMode } from "./config";

export function assertLocalSeedEnvironment() {
  // Seed entry points do not accept a connection string at all. Tests that use
  // isolated Postgres fixtures populate it deliberately through their adapter.
  if (
    !localMode() ||
    process.env.DATABASE_URL ||
    process.env.VERCEL ||
    process.env.PILOT_ENROLLMENT_ENABLED === "true"
  )
    throw Error(
      "Demo seeding requires local storage with no DATABASE_URL, no hosted environment and real enrollment disabled.",
    );
}
export async function assertNoRealPilotData(db: DB) {
  const [real] = await db.query(
    "select id from uptick_members where data_kind='real' union all select id from pilot_runs where data_kind='real' limit 1",
  );
  if (real)
    throw Error(
      "Demo seeding is disabled because real pilot records exist. No records were changed.",
    );
}
