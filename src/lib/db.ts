import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { localMode } from "./config";
import { demoMode, assertDemoStorage } from "./demo-guard";
import { cloudDemoMode } from "./cloud-demo-guard";
export type Row = Record<string, unknown>;
export interface DB {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}
export function pgAdapter(client: ReturnType<typeof postgres>): DB {
  return {
    query: async <T>(sql: string, params: unknown[] = []) =>
      (await client.unsafe(sql, params as never[])) as unknown as T[],
    transaction: (fn) =>
      client.begin((tx) =>
        fn(pgAdapter(tx as unknown as ReturnType<typeof postgres>)),
      ) as Promise<never>,
  };
}
function liteAdapter(client: PGlite): DB {
  return {
    query: async <T>(sql: string, params: unknown[] = []) =>
      (await client.query<T>(sql, params)).rows,
    transaction: (fn) =>
      client.transaction((tx) =>
        fn({
          query: async <T>(sql: string, params: unknown[] = []) =>
            (await tx.query<T>(sql, params)).rows,
          transaction: async () => {
            throw Error("Nested transaction is not supported");
          },
        }),
      ),
    close: () => client.close(),
  };
}
const globalDb = globalThis as unknown as { uptickDb?: Promise<DB> };
export async function getDb() {
  if (cloudDemoMode()) {
    const { requestCloudDemoDb } = await import("./cloud-demo-db");
    return requestCloudDemoDb();
  }
  if (demoMode()) assertDemoStorage();
  // This reused project is operated only from the canonical deployment. Preview
  // builds may render static content but must not touch shared service records.
  if (process.env.VERCEL_ENV === "preview")
    throw Error(
      "Shared pilot database access is disabled on preview deployments.",
    );
  if (!globalDb.uptickDb)
    globalDb.uptickDb = (async () => {
      if (process.env.DATABASE_URL)
        return pgAdapter(
          postgres(process.env.DATABASE_URL, { prepare: false, max: 5 }),
        );
      if (!localMode())
        throw Error(
          "Configure DATABASE_URL. Local storage is disabled outside explicit local mode.",
        );
      const path = resolve(process.env.LOCAL_DATABASE_PATH || ".data/uptick");
      await mkdir(path, { recursive: true });
      const db = liteAdapter(new PGlite(path));
      await migrate(db);
      if (demoMode()) {
        // Database constraints protect every classified table, including raw
        // operator/API writes. They exist only inside this isolated database.
        const tables = await db.query<{ table_name: string }>(
          "select table_name from information_schema.columns where table_schema='public' and column_name='data_kind'",
        );
        for (const { table_name: table } of tables) {
          if (!/^[a-z_]+$/.test(table)) throw Error("Unexpected demo table.");
          const [constraint] = await db.query(
            "select 1 from pg_constraint where conname=$1",
            [`demo_only_${table}`],
          );
          if (!constraint)
            await db.query(
              `alter table ${table} add constraint demo_only_${table} check (data_kind <> 'real')`,
            );
        }
        const [organizationConstraint] = await db.query(
          "select 1 from pg_constraint where conname='demo_only_organizations'",
        );
        if (!organizationConstraint)
          await db.query(
            "alter table organizations add constraint demo_only_organizations check (is_demo)",
          );
      }
      return db;
    })();
  return globalDb.uptickDb;
}
export async function migrate(db: DB) {
  await db.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())",
  );
  await db.query(
    "create table if not exists schema_migration_checksums(name text primary key references schema_migrations(name),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),recorded_at timestamptz not null default now(),basis text not null check(basis in ('applied','reviewed_baseline')))",
  );
  await db.query(
    "alter table schema_migration_checksums enable row level security",
  );
  for (const name of (await readdir(resolve("db/migrations")))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(resolve("db/migrations", name), "utf8");
    const fingerprint = createHash("sha256").update(sql).digest("hex");
    const [recorded] = await db.query<{ sha256: string }>(
      "select sha256 from schema_migration_checksums where name=$1",
      [name],
    );
    if (recorded && recorded.sha256 !== fingerprint)
      throw Error(
        `Applied migration ${name} differs from its recorded checksum. Create a new migration; do not rewrite history.`,
      );
    if (
      (
        await db.query("select name from schema_migrations where name=$1", [
          name,
        ])
      ).length
    )
      continue;
    // Split through the driver's multi-statement support: PGlite exec required for migration blocks.
    await db.transaction(async (tx) => {
      for (const statement of splitSql(sql)) await tx.query(statement);
      await tx.query("insert into schema_migrations(name) values($1)", [name]);
      await tx.query(
        "insert into schema_migration_checksums(name,sha256,basis) values($1,$2,'applied')",
        [name, fingerprint],
      );
    });
  }
}
export function splitSql(sql: string) {
  const statements: string[] = [];
  let chunk = "";
  let dollar = false;
  let single = false;
  let comment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (!single && !dollar && c === "-" && sql[i + 1] === "-") {
      comment = true;
    }
    if (comment) {
      if (c === "\n") comment = false;
      continue;
    }
    if (!single && c === "$" && sql[i + 1] === "$") {
      dollar = !dollar;
      chunk += "$$";
      i++;
      continue;
    }
    if (!dollar && c === "'") {
      if (single && sql[i + 1] === "'") {
        chunk += "''";
        i++;
        continue;
      }
      single = !single;
    }
    if (c === ";" && !single && !dollar) {
      if (chunk.trim()) statements.push(chunk.trim());
      chunk = "";
    } else chunk += c;
  }
  if (chunk.trim()) statements.push(chunk);
  return statements;
}
export async function memoryDb() {
  const db = liteAdapter(new PGlite());
  await migrate(db);
  return db;
}
