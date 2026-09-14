import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const EXPECTED_PROJECT_ID = "dmirmwzubafuzoxcporr";
const EXPECTED_MIGRATIONS = [
  "001_platform.sql",
  "002_product.sql",
  "003_operator.sql",
  "004_integrity.sql",
  "005_operator_fixes.sql",
  "006_claim_consent_choices.sql",
  "007_internal_testing.sql",
  "008_json_object_integrity.sql",
  "009_network.sql",
  "010_tap.sql",
  "011_membership_messaging.sql",
  "012_merchant_growth.sql",
  "013_member_experience.sql",
] as const;
const EXPECTED_TABLE_COUNT = 65;
const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const MD5 = /^[a-f0-9]{32}$/;

type JsonRecord = Record<string, unknown>;
type SnapshotTable = {
  name: string;
  rows: JsonRecord[];
  row_texts: string[];
  count: number;
  fingerprint: string;
};
type Snapshot = {
  captured_at: string;
  project_id: string;
  server_version: string;
  row_encoding: string;
  migrations: string[];
  tables: SnapshotTable[];
};

// The connection below is fully explicit. Remove inherited connection and
// Supabase variables as a second guard against accidental remote access.
for (const name of Object.keys(process.env)) {
  if (
    name === "DATABASE_URL" ||
    name === "DIRECT_URL" ||
    name.startsWith("PG") ||
    name.startsWith("SUPABASE")
  )
    delete process.env[name];
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw Error(`${label} must be a string`);
  return value;
}

function exactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
) {
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expected].sort(),
    `${label} has an unexpected shape`,
  );
}

function parseSnapshot(value: unknown): Snapshot {
  assert.ok(isRecord(value), "Snapshot must be a JSON object");
  exactKeys(
    value,
    [
      "captured_at",
      "project_id",
      "server_version",
      "row_encoding",
      "migrations",
      "tables",
    ],
    "Snapshot",
  );
  const capturedAt = stringValue(value.captured_at, "captured_at");
  assert.ok(
    Number.isFinite(Date.parse(capturedAt)),
    "captured_at must be an ISO timestamp",
  );
  const projectId = stringValue(value.project_id, "project_id");
  assert.equal(projectId, EXPECTED_PROJECT_ID, "Wrong hosted project snapshot");
  const serverVersion = stringValue(value.server_version, "server_version");
  assert.match(
    serverVersion,
    /^17\./,
    "Expected the captured hosted PostgreSQL 17 server",
  );
  const rowEncoding = stringValue(value.row_encoding, "row_encoding");
  assert.equal(rowEncoding, "postgres_jsonb_text");
  const rawMigrations = value.migrations;
  if (!Array.isArray(rawMigrations)) throw Error("migrations must be an array");
  const migrations = rawMigrations.map((name) => {
    return stringValue(name, "Migration ledger entry");
  });
  assert.deepEqual(
    migrations,
    EXPECTED_MIGRATIONS,
    "Snapshot must carry the exact sorted 001-013 migration ledger",
  );
  const rawTables = value.tables;
  if (!Array.isArray(rawTables)) throw Error("tables must be an array");
  assert.equal(
    rawTables.length,
    EXPECTED_TABLE_COUNT,
    `Snapshot must contain all ${EXPECTED_TABLE_COUNT} public tables`,
  );

  const tables = rawTables.map((raw, index): SnapshotTable => {
    if (!isRecord(raw)) throw Error(`tables[${index}] must be an object`);
    exactKeys(
      raw,
      ["name", "rows", "row_texts", "count", "fingerprint"],
      `tables[${index}]`,
    );
    const name = stringValue(raw.name, `tables[${index}].name`);
    assert.match(name, TABLE_NAME, `Unsafe table name at tables[${index}]`);
    const rows = raw.rows;
    if (!Array.isArray(rows)) throw Error(`${name}.rows must be an array`);
    if (!rows.every(isRecord))
      throw Error(`${name}.rows must contain JSON objects`);
    const rawRowTexts = raw.row_texts;
    if (!Array.isArray(rawRowTexts))
      throw Error(`${name}.row_texts must be an array`);
    const rowTexts = rawRowTexts.map((rowText) =>
      stringValue(rowText, `${name}.row_texts entry`),
    );
    const count = raw.count;
    if (typeof count !== "number")
      throw Error(`${name}.count must be a number`);
    assert.ok(
      Number.isSafeInteger(count) && Number(count) >= 0,
      `${name}.count must be a non-negative integer`,
    );
    assert.equal(count, rows.length, `${name} row count is inconsistent`);
    assert.equal(
      count,
      rowTexts.length,
      `${name} row_texts count is inconsistent`,
    );
    const fingerprint = stringValue(raw.fingerprint, `${name}.fingerprint`);
    assert.match(fingerprint, MD5, `${name} has an invalid fingerprint`);
    const orderedRowTexts = [...rowTexts].sort((a, b) =>
      Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")),
    );
    assert.equal(
      createHash("md5")
        .update(orderedRowTexts.join("\n"), "utf8")
        .digest("hex"),
      fingerprint,
      `${name} row_texts do not produce the captured fingerprint`,
    );
    const parsedRowTexts = rowTexts.map((rowText) => {
      const parsed: unknown = JSON.parse(rowText);
      if (!isRecord(parsed))
        throw Error(`${name}.row_texts entry is not an object`);
      return parsed;
    });
    assert.deepEqual(
      parsedRowTexts.map(canonicalJson).sort(),
      rows.map(canonicalJson).sort(),
      `${name}.rows and row_texts do not describe the same logical rows`,
    );
    return {
      name,
      rows,
      row_texts: rowTexts,
      count,
      fingerprint,
    };
  });
  const names = tables.map((table) => table.name);
  assert.deepEqual(
    names,
    [...names].sort(),
    "Snapshot tables must be sorted by name",
  );
  assert.equal(
    new Set(names).size,
    names.length,
    "Snapshot table names must be unique",
  );
  assert.ok(
    names.includes("schema_migrations"),
    "schema_migrations is missing",
  );
  return {
    captured_at: capturedAt,
    project_id: projectId,
    server_version: serverVersion,
    row_encoding: rowEncoding,
    migrations,
    tables,
  };
}

function quoteIdentifier(value: string) {
  assert.match(value, TABLE_NAME);
  return `"${value}"`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

let currentStage = "startup";

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = await realpath(resolve(scriptDir, ".."));
  assert.equal(
    process.argv.length,
    4,
    "Use scripts/verify-hosted-public-backup.sh",
  );
  const clusterRoot = await realpath(process.argv[2] || "");
  const tempRoot = await realpath("/tmp");
  assert.equal(
    dirname(clusterRoot),
    tempRoot,
    "Cluster must be directly below /tmp",
  );
  assert.ok(
    clusterRoot.startsWith(`${tempRoot}/uptick-hosted-backup-check.`),
    "Unexpected isolated cluster path",
  );
  assert.equal(
    (
      await readFile(resolve(clusterRoot, ".uptick-test-cluster"), "utf8")
    ).trim(),
    "uptick-hosted-public-backup-check-v1",
    "Missing isolated cluster marker",
  );

  const snapshotPath = await realpath(process.argv[3]);
  const commissioningRoot = await realpath(
    resolve(repositoryRoot, ".data/commissioning"),
  );
  assert.equal(
    dirname(snapshotPath),
    commissioningRoot,
    "Snapshot must be in .data/commissioning",
  );
  assert.equal(
    basename(snapshotPath),
    "public-before-014.json",
    "Unexpected snapshot filename",
  );
  assert.equal(
    (await stat(snapshotPath)).mode & 0o777,
    0o600,
    "Snapshot permissions must be 600",
  );
  const snapshot = parseSnapshot(
    JSON.parse(await readFile(snapshotPath, "utf8")),
  );

  const connection = {
    host: clusterRoot,
    port: 55442,
    user: userInfo().username,
    prepare: false,
    max: 2,
    onnotice: () => {},
  };
  const admin = postgres({ ...connection, database: "postgres" });
  const migrationDigests: { name: string; sha256: string }[] = [];

  try {
    const [{ data_directory }] = await admin`show data_directory`;
    assert.equal(
      await realpath(data_directory),
      await realpath(resolve(clusterRoot, "data")),
      "Connected server does not own the isolated data directory",
    );
    assert.equal((await admin`show listen_addresses`)[0].listen_addresses, "");
    assert.equal((await admin`show fsync`)[0].fsync, "on");
    assert.equal(
      (await admin`show synchronous_commit`)[0].synchronous_commit,
      "on",
    );
    assert.equal(
      Math.floor(
        Number((await admin`show server_version_num`)[0].server_version_num) /
          10000,
      ),
      16,
      "The isolated server must be PostgreSQL 16",
    );
    await admin.unsafe("create database uptick_hosted_public_restore");

    const sql = postgres({
      ...connection,
      database: "uptick_hosted_public_restore",
    });
    try {
      await sql.unsafe("set timezone to 'UTC'");
      await sql.unsafe(
        "create table schema_migrations (name text primary key, applied_at timestamptz default now())",
      );

      for (const name of snapshot.migrations) {
        currentStage = `migration ${name}`;
        const migrationPath = await realpath(
          resolve(repositoryRoot, "db/migrations", name),
        );
        assert.equal(
          dirname(migrationPath),
          resolve(repositoryRoot, "db/migrations"),
        );
        assert.equal(basename(migrationPath), name);
        const migration = await readFile(migrationPath, "utf8");
        migrationDigests.push({
          name,
          sha256: createHash("sha256").update(migration).digest("hex"),
        });
        await sql.begin(async (tx) => {
          await tx.unsafe(migration);
          await tx`insert into schema_migrations(name) values(${name})`;
        });
      }

      const actualTables = (
        await sql<{ table_name: string }[]>`
        select table_name
        from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE'
        order by table_name collate "C"
      `
      ).map((row) => row.table_name);
      const snapshotTables = snapshot.tables.map((table) => table.name);
      assert.deepEqual(
        actualTables,
        snapshotTables,
        "Snapshot tables do not exactly match the schema produced by migrations 001-013",
      );

      await sql.begin(async (tx) => {
        currentStage = "snapshot table truncation";
        await tx.unsafe("set local timezone to 'UTC'");
        await tx.unsafe("set local session_replication_role = replica");
        await tx.unsafe(
          `truncate table ${snapshotTables.map(quoteIdentifier).join(", ")} restart identity cascade`,
        );

        for (const table of snapshot.tables) {
          currentStage = `restore of table ${table.name}`;
          const columns = await tx<
            { column_name: string; data_type: string }[]
          >`
          select a.attname column_name,pg_catalog.format_type(a.atttypid,a.atttypmod) data_type
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid=a.attrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=${table.name}
            and a.attnum>0 and not a.attisdropped
          order by a.attnum
        `;
          const expectedColumns = columns
            .map((column) => column.column_name)
            .sort();
          for (const [rowIndex, rowText] of table.row_texts.entries()) {
            const row = JSON.parse(rowText) as JsonRecord;
            assert.deepEqual(
              Object.keys(row).sort(),
              expectedColumns,
              `${table.name} row ${rowIndex} does not exactly match its restored schema`,
            );
            await tx.unsafe(
              `insert into ${quoteIdentifier(table.name)}
               select * from jsonb_populate_record(
                 null::${quoteIdentifier(table.name)},
                 convert_from(decode($1::text,'base64'),'UTF8')::jsonb
               )`,
              [Buffer.from(rowText, "utf8").toString("base64")],
            );
          }
        }
      });

      for (const table of snapshot.tables) {
        currentStage = `fingerprint of table ${table.name}`;
        const [restored] = await sql.unsafe<
          { count: number; fingerprint: string }[]
        >(
          `select count(*)::int count,
          md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n'
            order by to_jsonb(t)::text collate "C"),'')) fingerprint
          from ${quoteIdentifier(table.name)} t`,
        );
        assert.equal(
          restored.count,
          table.count,
          `${table.name} count mismatch`,
        );
        assert.equal(
          restored.fingerprint,
          table.fingerprint,
          `${table.name} fingerprint mismatch`,
        );
      }

      const restoredLedger = (
        await sql<{ name: string }[]>`
        select name from schema_migrations order by name collate "C"
      `
      ).map((row) => row.name);
      assert.deepEqual(
        restoredLedger,
        snapshot.migrations,
        "Restored schema_migrations ledger mismatch",
      );

      currentStage = "sanitized evidence output";
      console.log(
        JSON.stringify(
          {
            result: "PASS",
            method:
              "fresh PostgreSQL 16 cluster; Unix socket only; migrations 001-013 replayed; public rows restored with local trigger replication disabled",
            capturedAt: snapshot.captured_at,
            expectedProjectIdentityMatched: true,
            capturedPostgresVersion: snapshot.server_version,
            postgresMajor: 16,
            migrations: migrationDigests,
            verifiedPublicTableCount: snapshot.tables.length,
            allTableCountsMatched: true,
            allTableFingerprintsMatched: true,
            schemaMigrationsIncluded: true,
            remoteProjectTouched: false,
            snapshotRowsPrinted: false,
            limitations: [
              "Public-schema row snapshot only; Supabase Auth and Storage are excluded.",
              "This is not a provider backup, point-in-time recovery, or hosted recovery test.",
              "The rehearsal proves restore compatibility only for repository migrations 001-013 and the captured public rows.",
            ],
          },
          null,
          2,
        ),
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const code =
    isRecord(error) && typeof error.code === "string"
      ? ` (code ${error.code})`
      : "";
  console.error(
    `Hosted public backup rehearsal failed during ${currentStage}${code}. Captured row values and database error details are suppressed.`,
  );
  process.exitCode = 1;
});
