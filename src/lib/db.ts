import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { localMode } from "./config";
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
      return db;
    })();
  return globalDb.uptickDb;
}
export async function migrate(db: DB) {
  await db.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())",
  );
  for (const name of (await readdir(resolve("db/migrations")))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    if (
      (
        await db.query("select name from schema_migrations where name=$1", [
          name,
        ])
      ).length
    )
      continue;
    const sql = await readFile(resolve("db/migrations", name), "utf8");
    // Split through the driver's multi-statement support: PGlite exec required for migration blocks.
    await db.transaction(async (tx) => {
      for (const statement of splitSql(sql)) await tx.query(statement);
      await tx.query("insert into schema_migrations(name) values($1)", [name]);
    });
  }
}
function splitSql(sql: string) {
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
