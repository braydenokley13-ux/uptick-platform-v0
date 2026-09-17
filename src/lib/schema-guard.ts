/* Hosted schema drift guard.

   The failure this exists to stop: a deployment whose code expects migration
   034 talking to a database that stopped at 021. The first symptom was a raw
   `relation "location_outages" does not exist` reaching a normal route — an
   error that names a table but not the cause, the consequence or the fix.

   The guard does not route around the missing table. It refuses to serve,
   once, loudly, naming the exact gap and the exact command. That converts an
   undiagnosable 500 into an operator-actionable state, which is what the
   readiness surface then reports.

   Local mode is exempt: `getDb()` migrates the embedded database on open, so
   drift cannot exist there. The migration runner is exempt too, or it could
   never be the thing that closes the gap. */
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { DB } from "./db";

/** Postgres: undefined_table. */
export const UNDEFINED_TABLE = "42P01";

export function isMissingRelation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code: unknown }).code) === UNDEFINED_TABLE
  );
}

export type SchemaDrift = {
  applied: number;
  expected: number;
  missing: string[];
};

let cached: { at: number; drift: SchemaDrift | null } | null = null;
const TTL = 30_000;

/** Null when the connected database carries every migration in this release. */
export async function schemaDrift(db: DB): Promise<SchemaDrift | null> {
  if (cached && Date.now() - cached.at < TTL) return cached.drift;
  const expected = (await readdir(resolve("db/migrations")))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  let applied: string[] = [];
  try {
    applied = (
      await db.query<{ name: string }>("select name from schema_migrations")
    ).map((r) => r.name);
  } catch (error) {
    // No ledger at all is the most extreme drift: an entirely unmigrated database.
    if (!isMissingRelation(error)) throw error;
  }
  const missing = expected.filter((name) => !applied.includes(name));
  const drift = missing.length
    ? { applied: applied.length, expected: expected.length, missing }
    : null;
  cached = { at: Date.now(), drift };
  return drift;
}

export function driftMessage(drift: SchemaDrift) {
  const first = drift.missing[0];
  const last = drift.missing[drift.missing.length - 1];
  const range = drift.missing.length === 1 ? first : `${first} through ${last}`;
  return (
    `This deployment expects ${drift.expected} database migrations but the connected database has ${drift.applied}. ` +
    `${drift.missing.length} migration${drift.missing.length === 1 ? " is" : "s are"} not applied (${range}). ` +
    `Apply the forward migrations with "npm run db:migrate" against this database, then reload. ` +
    `No data is changed until that runs, and nothing here works around the missing tables.`
  );
}

/** Clears the cache so a completed migration is picked up without a redeploy. */
export function forgetSchemaDrift() {
  cached = null;
}
