import type { DB } from "./db";
import tables from "./cloud-demo-tables.json";
import {
  CLOUD_DEMO_LOCK,
  verifyCloudDemoOwnership,
  requireCloudDemoLease,
  rotateCloudDemoLease,
} from "./cloud-demo-db";
import { seedDemoStudio } from "./demo-studio";

export async function assertCloudDemoSampleRows(db: DB) {
  const classified = await db.query<{ table_name: string }>(
    "select table_name from information_schema.columns where table_schema='uptick_cloud_demo' and column_name='data_kind'",
  );
  for (const { table_name: table } of classified) {
    if (!tables.includes(table))
      throw Error("Unrecognized cloud demo table; reset refused.");
    if (
      (
        await db.query(
          `select 1 from "${table}" where data_kind='real' limit 1`,
        )
      ).length
    )
      throw Error("Real-classified records found; cloud demo reset refused.");
  }
  if (
    (await db.query("select 1 from organizations where not is_demo limit 1"))
      .length
  )
    throw Error("Non-demo organization found; reset refused.");
  if (
    (
      await db.query(
        "select 1 from customers where phone !~ '^\\+1[0-9]{3}55501[0-9]{2}$' and phone <> 'erased:'||id limit 1",
      )
    ).length
  )
    throw Error("Non-fictional customer number found; reset refused.");
}

export async function resetCloudDemo(db: DB, credential: string) {
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [CLOUD_DEMO_LOCK]);
    await verifyCloudDemoOwnership(tx);
    await requireCloudDemoLease(tx, credential);
    const actual = await tx.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname='uptick_cloud_demo' and tablename not in ('schema_migrations','schema_migration_checksums') order by tablename",
    );
    if (
      JSON.stringify(actual.map((row) => row.tablename)) !==
      JSON.stringify(tables)
    )
      throw Error(
        "Cloud demo table inventory changed; reset refused until reviewed.",
      );
    await assertCloudDemoSampleRows(tx);
    // No CASCADE: a foreign dependency outside the reviewed list makes reset fail.
    await tx.query(
      `truncate table ${tables.map((name) => `"uptick_cloud_demo"."${name}"`).join(",")}`,
    );
    // Compose existing domain transactions inside this one atomic reset. Any error
    // rolls back both the old records and the old lease generation.
    const atomic: DB = {
      query: (sql, params) => tx.query(sql, params),
      transaction: (fn) => fn(atomic),
    };
    await seedDemoStudio(atomic);
    return rotateCloudDemoLease(tx);
  });
}
