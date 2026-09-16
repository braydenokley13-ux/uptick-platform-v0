import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { type DB, splitSql } from "./db";
import { assertCloudDemoEnvironment } from "./cloud-demo-guard";
import { seedDemoStudio } from "./demo-studio";
import { CLOUD_DEMO_LOCK } from "./cloud-demo-db";
import tables from "./cloud-demo-tables.json";

export function renderCloudDemoMigration(sql: string) {
  // Only schema syntax is rewritten. Values such as 'public', public_tap and
  // public_token retain their product meanings. The source files stay intact.
  return sql
    .replace(
      /\bset\s+search_path\s*=\s*public\s*,\s*pg_temp\b/gi,
      "set search_path=uptick_cloud_demo,pg_temp",
    )
    .replace(
      /pg_advisory_xact_lock\(73418,\s*1\)/g,
      "pg_advisory_xact_lock(73419,1)",
    )
    .replace(
      /\balter\s+function\s+public\./gi,
      "alter function uptick_cloud_demo.",
    );
}

// Deployment-owner operation, never imported by a web route. Run only after
// reviewing this fixed schema/role plan. The deployed app never gets this owner connection.
export async function installCloudDemoSchema(
  owner: DB,
  runtimePassword: string,
) {
  const config = assertCloudDemoEnvironment();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(runtimePassword))
    throw Error("Use a generated runtime password.");
  const sources = await Promise.all(
    (await readdir(resolve("db/migrations")))
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map(async (name) => ({
        name,
        sql: await readFile(resolve("db/migrations", name), "utf8"),
      })),
  );
  if (sources.at(-1)?.name !== "035_restore_public_schema_hardening.sql")
    throw Error(
      "Review the cloud schema renderer before installing newer migrations.",
    );
  return owner.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [CLOUD_DEMO_LOCK]);
    if (
      (
        await tx.query(
          "select 1 from pg_namespace where nspname in ('uptick_cloud_demo','uptick_demo')",
        )
      ).length
    )
      throw Error(
        "Cloud demo schema already exists. Refusing to overwrite it.",
      );
    if (
      (
        await tx.query(
          "select 1 from pg_roles where rolname='uptick_cloud_demo_runtime'",
        )
      ).length
    )
      throw Error(
        "Demo runtime role already exists. Refusing to reuse unverified privileges.",
      );
    await tx.query(
      `create role uptick_cloud_demo_runtime login password '${runtimePassword}' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 10`,
    );
    await tx.query("create schema uptick_cloud_demo");
    await tx.query("create schema uptick_demo");
    await tx.query(
      "revoke all on schema uptick_cloud_demo,uptick_demo from public",
    );
    await tx.query("set local search_path=uptick_cloud_demo,pg_temp");
    await tx.query(
      "create table schema_migrations(name text primary key,applied_at timestamptz default now())",
    );
    await tx.query(
      "create table schema_migration_checksums(name text primary key references schema_migrations(name),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),rendered_sha256 text not null,recorded_at timestamptz default now(),basis text not null check(basis in ('applied','reviewed_baseline')))",
    );
    for (const source of sources) {
      const rendered = renderCloudDemoMigration(source.sql);
      for (const statement of splitSql(rendered)) await tx.query(statement);
      await tx.query("insert into schema_migrations(name) values($1)", [
        source.name,
      ]);
      await tx.query(
        "insert into schema_migration_checksums(name,sha256,rendered_sha256,basis) values($1,$2,$3,'applied')",
        [
          source.name,
          createHash("sha256").update(source.sql).digest("hex"),
          createHash("sha256").update(rendered).digest("hex"),
        ],
      );
    }
    /* Migration 035 now performs these three repairs for every schema, and the
       renderer rewrites its `search_path=public,pg_temp` to this schema like
       any other. They are kept here as a belt-and-braces assertion: this
       installer is the only place that verified them before 035 existed, and
       re-stating them costs one idempotent statement each. */
    await tx.query(
      "alter function protect_consent_with_erasure() set search_path=uptick_cloud_demo,pg_temp",
    );
    await tx.query(
      "alter function protect_member_support_context() set search_path=uptick_cloud_demo,pg_temp",
    );
    await tx.query(
      "alter view privacy_retention_queue set (security_invoker=true)",
    );
    const classified = await tx.query<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema='uptick_cloud_demo' and column_name='data_kind'",
    );
    for (const { table_name: table } of classified) {
      if (!tables.includes(table)) throw Error("Unexpected classified table.");
      await tx.query(
        `alter table "${table}" add constraint "demo_only_${table}" check(data_kind<>'real')`,
      );
    }
    await tx.query(
      "alter table organizations add constraint demo_only_organizations check(is_demo)",
    );
    for (const table of [
      "customers",
      "consent_events",
      "senders",
      "suppressions",
      "member_senders",
      "member_suppressions",
      "member_global_suppressions",
    ]) {
      const erased =
        table === "customers"
          ? " or phone='erased:'||id"
          : table === "consent_events"
            ? " or phone='erased'"
            : "";
      await tx.query(
        `alter table "${table}" add constraint demo_only_phone check(phone ~ '^\\+1[0-9]{3}55501[0-9]{2}$'${erased})`,
      );
    }
    await tx.query(
      "create table uptick_demo.ownership(singleton boolean primary key default true check(singleton),kind text not null check(kind='uptick-cloud-demo-v1'),project_ref text not null,instance_id text not null,origin text not null)",
    );
    await tx.query(
      "insert into uptick_demo.ownership(kind,project_ref,instance_id,origin) values('uptick-cloud-demo-v1',$1,$2,$3)",
      [config.ref, config.instanceId, config.origin],
    );
    await tx.query(
      "create table uptick_demo.lease(singleton boolean primary key default true check(singleton),generation integer not null default 1,token_hash text,expires_at timestamptz)",
    );
    await tx.query("insert into uptick_demo.lease(singleton) values(true)");
    await tx.query(
      "alter table uptick_demo.ownership enable row level security",
    );
    await tx.query("alter table uptick_demo.lease enable row level security");
    await tx.query(
      "create policy demo_ownership_read on uptick_demo.ownership for select to uptick_cloud_demo_runtime using(true)",
    );
    await tx.query(
      "create policy demo_lease_access on uptick_demo.lease to uptick_cloud_demo_runtime using(true) with check(true)",
    );
    await tx.query(
      "grant usage on schema uptick_cloud_demo,uptick_demo to uptick_cloud_demo_runtime",
    );
    await tx.query(
      "grant select on uptick_demo.ownership to uptick_cloud_demo_runtime",
    );
    await tx.query(
      "grant select,update on uptick_demo.lease to uptick_cloud_demo_runtime",
    );
    for (const table of [
      ...tables,
      "schema_migrations",
      "schema_migration_checksums",
    ]) {
      await tx.query(`alter table "${table}" enable row level security`);
      await tx.query(
        `create policy cloud_demo_runtime on "${table}" to uptick_cloud_demo_runtime using(true) with check(true)`,
      );
      await tx.query(
        `grant ${tables.includes(table) ? "select,insert,update,delete,truncate" : "select"} on "${table}" to uptick_cloud_demo_runtime`,
      );
    }
    await tx.query(
      "grant select on all tables in schema uptick_cloud_demo to uptick_cloud_demo_runtime",
    );
    await tx.query(
      "revoke all on all functions in schema uptick_cloud_demo from public",
    );
    await tx.query(
      "grant execute on all functions in schema uptick_cloud_demo to uptick_cloud_demo_runtime",
    );
    await tx.query(
      "grant usage,select on all sequences in schema uptick_cloud_demo to uptick_cloud_demo_runtime",
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      if (
        (await tx.query("select 1 from pg_roles where rolname=$1", [role]))
          .length
      ) {
        await tx.query(
          `revoke all on schema uptick_cloud_demo,uptick_demo from "${role}"`,
        );
        await tx.query(
          `revoke all on all tables in schema uptick_cloud_demo,uptick_demo from "${role}"`,
        );
        await tx.query(
          `revoke all on all functions in schema uptick_cloud_demo from "${role}"`,
        );
      }
    }
    const escaped = await tx.query(
      "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and c.relkind in ('r','p','v','m') and (has_table_privilege('uptick_cloud_demo_runtime',c.oid,'SELECT') or has_table_privilege('uptick_cloud_demo_runtime',c.oid,'INSERT') or has_table_privilege('uptick_cloud_demo_runtime',c.oid,'UPDATE') or has_table_privilege('uptick_cloud_demo_runtime',c.oid,'DELETE') or has_table_privilege('uptick_cloud_demo_runtime',c.oid,'TRUNCATE'))",
    );
    if (escaped.length)
      throw Error(
        "Demo role inherits access outside the demo schema; installation rolled back.",
      );
    const definer = await tx.query(
      "select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('uptick_cloud_demo_runtime',p.oid,'EXECUTE')",
    );
    if (definer.length)
      throw Error(
        "Public privileged functions are executable by the demo role; installation rolled back.",
      );
    const atomic: DB = {
      query: (sql, params) => tx.query(sql, params),
      transaction: (fn) => fn(atomic),
    };
    await seedDemoStudio(atomic);
    return {
      schema: "uptick_cloud_demo",
      migrations: sources.length,
      role: "uptick_cloud_demo_runtime",
      publicTablesChanged: false,
    };
  });
}
