// The migration runner is the one caller that must reach a database that is
// still behind this release.
process.env.UPTICK_MIGRATING = "true";
import { getDb, migrate } from "../src/lib/db";
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
try {
  const db = await getDb();
  await migrate(db);
  await db.close?.();
  console.log("Database migrations applied.");
  process.exit(0);
} catch (error) {
  /* A failed hosted migration is the moment an operator most needs to know
     what actually broke. Discarding the error entirely — as this did — leaves
     them with "check the database connection" for a constraint violation in a
     named file, which is the same undiagnosable failure the schema guard was
     written to eliminate.

     Postgres puts credentials in none of these fields: `code` is the SQLSTATE,
     `message` and `detail` describe the offending statement, `where` is the
     PL/pgSQL context, and `constraint`/`table` name the object. The connection
     string is never among them, so they are safe to print. `stack` and the raw
     error object are not printed, because the driver attaches the query and
     its parameters to those. */
  const pg = error as {
    code?: string;
    message?: string;
    detail?: string;
    hint?: string;
    where?: string;
    constraint?: string;
    table?: string;
  };
  console.error(
    `Migration failed${pg.code ? ` [${pg.code}]` : ""}: ${pg.message ?? "unknown error"}`,
  );
  for (const [label, value] of [
    ["detail", pg.detail],
    ["hint", pg.hint],
    ["context", pg.where],
    ["constraint", pg.constraint],
    ["table", pg.table],
  ] as const)
    if (value) console.error(`  ${label}: ${value}`);
  console.error(
    "Nothing was left half-applied: each migration runs in its own transaction, so the failing file rolled back entirely. Fix the cause and re-run; database credentials are never printed.",
  );
  process.exit(1);
}
