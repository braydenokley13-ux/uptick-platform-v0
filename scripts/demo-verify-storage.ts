import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir, realpath, lstat } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";

const root = resolve(process.argv[2] || "");
const database = resolve(root, "database");
if (basename(root) !== ".demo-studio" || (await realpath(root)) !== root)
  throw Error("Invalid demo root.");
const marker = JSON.parse(
  await readFile(resolve(root, "ownership.json"), "utf8"),
);
if (
  marker.kind !== "uptick-isolated-demo-v1" ||
  marker.repository !== dirname(root) ||
  marker.database !== database
)
  throw Error("Invalid storage ownership.");
const files = await readdir(database).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
if (files.length) {
  if (
    (await lstat(database)).isSymbolicLink() ||
    (await realpath(database)) !== database
  )
    throw Error("Cannot reset linked storage.");
  const db = new PGlite(database);
  try {
    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema='public' and column_name='data_kind'",
    );
    if (!rows.length)
      throw Error("Existing database is not a recognized Uptick demo.");
    for (const { table_name: table } of rows) {
      if (!/^[a-z_]+$/.test(table)) throw Error("Unexpected table.");
      if (
        (
          await db.query(
            `select 1 from ${table} where data_kind='real' limit 1`,
          )
        ).rows.length
      )
        throw Error("Real records found. Reset refused.");
    }
    if (
      (await db.query("select 1 from organizations where not is_demo limit 1"))
        .rows.length
    )
      throw Error("Non-demo organizations found. Reset refused.");
  } finally {
    await db.close();
  }
}
