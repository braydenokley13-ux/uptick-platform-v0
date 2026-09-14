import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { userInfo } from "node:os";
import postgres from "postgres";
import { migrate, pgAdapter, type DB } from "../src/lib/db";
import { verifyPilotPostgres } from "./verify-postgres-pilot";

// This executable refuses application connection strings, real project hosts,
// and any directory except the disposable cluster made by its shell wrapper.
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
const root = await realpath(process.argv[2] || ""),
  tmp = await realpath("/tmp");
assert.equal(dirname(root), tmp);
assert.ok(root.startsWith(`${tmp}/uptick-restore-check.`));
assert.equal(
  (await readFile(resolve(root, ".uptick-test-cluster"), "utf8")).trim(),
  "uptick-durable-restore-test-v1",
);
const options = {
  host: root,
  port: 55440,
  user: userInfo().username,
  prepare: false,
  max: 8,
  onnotice: () => {},
};
const admin = postgres({ ...options, database: "postgres" });
const [{ data_directory }] = await admin`show data_directory`;
assert.equal(
  await realpath(data_directory),
  await realpath(resolve(root, "data")),
);
assert.equal((await admin`show listen_addresses`)[0].listen_addresses, "");
assert.equal((await admin`show fsync`)[0].fsync, "on");
await admin.unsafe("create database uptick_restore_source");
await admin.unsafe("create database uptick_restore_target");
const sourceClient = postgres({
  ...options,
  database: "uptick_restore_source",
});
const source = pgAdapter(sourceClient);
async function fingerprint(db: DB) {
  const names = [
    "schema_migrations",
    "pilot_runs",
    "pilot_admissions",
    "pilot_week_supplies",
    "weekly_releases",
    "fulfillment_grants",
    "member_claims",
    "claims",
    "fulfillment_incidents",
    "recovery_grants",
    "recovery_redemptions",
    "member_consents",
    "member_global_suppressions",
    "member_messages",
    "member_message_events",
  ];
  const snapshot: Record<string, { count: number; digest: string | null }> = {};
  for (const name of names) {
    const [exists] = await db.query<{ present: boolean }>(
      "select to_regclass($1) is not null present",
      [name],
    );
    if (!exists.present) continue;
    const [row] = await db.query<{ count: number; digest: string | null }>(
      `select count(*)::int count,md5(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text)) digest from ${name} t`,
    );
    snapshot[name] = row;
  }
  return snapshot;
}
try {
  await migrate(source);
  await verifyPilotPostgres(source);
  const before = await fingerprint(source);
  assert.ok(
    before.fulfillment_grants.count > 0,
    "Restore rehearsal needs actual synthetic issued grants, not just empty tables",
  );
  const backup = resolve(root, "pilot-rehearsal.dump");
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    LANG: "C",
    PGCONNECT_TIMEOUT: "5",
  };
  const started = Date.now();
  execFileSync(
    "pg_dump",
    [
      "--host",
      root,
      "--port",
      "55440",
      "--username",
      options.user,
      "--format=custom",
      "--file",
      backup,
      "uptick_restore_source",
    ],
    { env, stdio: "pipe", timeout: 120000 },
  );
  execFileSync(
    "pg_restore",
    [
      "--host",
      root,
      "--port",
      "55440",
      "--username",
      options.user,
      "--no-owner",
      "--exit-on-error",
      "--dbname",
      "uptick_restore_target",
      backup,
    ],
    { env, stdio: "pipe", timeout: 120000 },
  );
  const restoreClient = postgres({
    ...options,
    database: "uptick_restore_target",
  });
  try {
    const restored = pgAdapter(restoreClient),
      after = await fingerprint(restored);
    assert.deepEqual(
      after,
      before,
      "Restored commitments, consent and evidence must exactly match the backup",
    );
    await migrate(restored);
    assert.deepEqual(
      await fingerprint(restored),
      before,
      "Redeploy migration replay must preserve restored commitments",
    );
    console.log(
      JSON.stringify(
        {
          result: "PASS",
          method:
            "isolated local logical dump/restore; fsync enabled; TCP disabled",
          restoreMilliseconds: Date.now() - started,
          verifiedTables: Object.keys(before),
          grants: before.fulfillment_grants.count,
          realProjectTouched: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await restoreClient.end({ timeout: 5 });
  }
} finally {
  await sourceClient.end({ timeout: 5 });
  await admin.end({ timeout: 5 });
}
