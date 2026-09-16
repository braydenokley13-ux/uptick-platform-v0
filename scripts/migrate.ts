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
} catch {
  console.error(
    "Migration failed. Check the database connection and migration files. Database credentials are never printed.",
  );
  process.exit(1);
}
