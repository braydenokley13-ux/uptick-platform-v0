/* Properties of the applied schema that nothing else checks.

   Migration 028 reset two functions' pinned search_path simply by using CREATE
   OR REPLACE without a SET clause, and migration 030 created a view over
   RLS-protected tables without security_invoker. Both went unnoticed because
   every existing test asserts behaviour, and neither regression changes
   behaviour — they change who the database trusts while producing it.

   These assertions read the catalog after the real migration runner has
   applied every file, so a future migration that quietly drops one of these
   properties fails here rather than in a hosted commissioning record months
   later. */
import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, type DB } from "../src/lib/db";

function localEnvironment() {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
}

async function withMigratedDatabase(run: (db: DB) => Promise<void>) {
  localEnvironment();
  const db = await memoryDb();
  try {
    await run(db);
  } finally {
    await db.close?.();
  }
}

test("every function in public pins its search_path", async () => {
  await withMigratedDatabase(async (db) => {
    const loose = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proconfig is null
        order by p.proname`,
    );
    assert.deepEqual(
      loose.map((row) => row.proname),
      [],
      "a function with no pinned search_path resolves unqualified names through the caller's search_path",
    );
  });
});

test("every view in public runs as its caller, not its owner", async () => {
  await withMigratedDatabase(async (db) => {
    const definer = await db.query<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='v'
          and (c.reloptions is null
               or not ('security_invoker=true' = any(c.reloptions)))
        order by c.relname`,
    );
    assert.deepEqual(
      definer.map((row) => row.relname),
      [],
      "a view without security_invoker reads its base tables with the owner's rights, bypassing their RLS",
    );
  });
});

test("every table in public has row level security enabled", async () => {
  await withMigratedDatabase(async (db) => {
    const open = await db.query<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
        order by c.relname`,
    );
    assert.deepEqual(
      open.map((row) => row.relname),
      [],
      "RLS is enabled everywhere and left without policies deliberately, so anything but the owning role fails closed",
    );
  });
});

test("the incident lookup on recovery_grants is indexed", async () => {
  await withMigratedDatabase(async (db) => {
    const indexes = await db.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname='public' and tablename='recovery_grants' order by indexname",
    );
    const names = indexes.map((row) => row.indexname);
    assert.ok(
      names.includes("recovery_grants_incident"),
      `incident_id lost its index when 026 dropped the unique constraint; found ${names.join(", ")}`,
    );
    /* The supersession-aware invariant that replaced the dropped uniqueness. */
    assert.ok(names.includes("one_current_recovery_per_original"));
  });
});

test("an applied migration cannot be rewritten after the fact", async () => {
  await withMigratedDatabase(async (db) => {
    const [checksum] = await db.query<{ name: string; basis: string }>(
      "select name,basis from schema_migration_checksums order by name desc limit 1",
    );
    assert.equal(checksum.basis, "applied");
    assert.equal(checksum.name, "035_restore_public_schema_hardening.sql");
  });
});
