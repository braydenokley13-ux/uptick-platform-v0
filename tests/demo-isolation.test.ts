import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertDemoEnvironment,
  assertDemoStorage,
} from "../src/lib/demo-guard";

const originalEnvironment = { ...process.env };
type EnvironmentOverrides = Partial<NodeJS.ProcessEnv>;
const tsxLoader = resolve("node_modules/tsx/dist/loader.mjs");
const demoLauncher = resolve("scripts/demo.ts");
const storageVerifier = resolve("scripts/demo-verify-storage.ts");
const guardedEnvironmentKeys = [
  "APP_URL",
  "DATABASE_URL",
  "LOCAL_DATABASE_PATH",
  "PILOT_ENROLLMENT_ENABLED",
  "PRODUCTION_DELIVERY_ENABLED",
  "SMS_TRANSPORT",
  "SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "UPTICK_DEMO_MODE",
  "UPTICK_DEMO_ROOT",
  "UPTICK_ENV",
  "UPTICK_LOCAL_MODE",
  "VERCEL",
  "VERCEL_ENV",
] as const;

let temporaryParent = "";
let demoRoot = "";
let databasePath = "";

function isolatedChildEnvironment(
  overrides: EnvironmentOverrides = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "development" };
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "SHELL"] as const) {
    if (originalEnvironment[key]) environment[key] = originalEnvironment[key];
  }
  return Object.assign(environment, overrides);
}

function runTypeScript(
  entry: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  cwd = process.cwd(),
) {
  return spawnSync(process.execPath, ["--import", tsxLoader, entry, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 60_000,
  });
}

function runStorageVerifier() {
  return runTypeScript(storageVerifier, [demoRoot], isolatedChildEnvironment());
}

function runDatabaseProgram(body: string) {
  return runTypeScript(
    "--input-type=module",
    ["--eval", body],
    isolatedChildEnvironment({
      UPTICK_DEMO_MODE: "false",
      UPTICK_ENV: "development",
      UPTICK_LOCAL_MODE: "true",
      APP_URL: "http://127.0.0.1:3210",
      LOCAL_DATABASE_PATH: databasePath,
      SMS_TRANSPORT: "development",
      PILOT_ENROLLMENT_ENABLED: "false",
      PRODUCTION_DELIVERY_ENABLED: "false",
    }),
  );
}

function initializeOrdinaryDatabase(statements: string[]) {
  const program = String.raw`
    const { getDb } = await import("./src/lib/db.ts");
    const db = await getDb();
    try {
      for (const sql of ${JSON.stringify(statements)}) await db.query(sql);
    } finally {
      await db.close?.();
    }
  `;
  const result = runDatabaseProgram(program);
  assert.equal(
    result.status,
    0,
    `database setup failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function readDatabaseCount(sql: string) {
  const program = String.raw`
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(${JSON.stringify(databasePath)});
    try {
      const { rows } = await db.query(${JSON.stringify(sql)});
      console.log("ROW_COUNT=" + rows[0].count);
    } finally {
      await db.close();
    }
  `;
  return runDatabaseProgram(program);
}

function safeDemoEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    UPTICK_DEMO_MODE: "true",
    UPTICK_DEMO_ROOT: demoRoot,
    UPTICK_ENV: "development",
    UPTICK_LOCAL_MODE: "true",
    APP_URL: "http://127.0.0.1:3210",
    LOCAL_DATABASE_PATH: databasePath,
    SMS_TRANSPORT: "development",
    PILOT_ENROLLMENT_ENABLED: "false",
    PRODUCTION_DELIVERY_ENABLED: "false",
  };
}

function setProcessEnvironment(environment: EnvironmentOverrides) {
  for (const key of guardedEnvironmentKeys) delete process.env[key];
  Object.assign(process.env, environment);
}

async function writeOwnershipMarker(directory = demoRoot) {
  await writeFile(
    join(directory, "ownership.json"),
    JSON.stringify({
      kind: "uptick-isolated-demo-v1",
      repository: temporaryParent,
      database: databasePath,
    }),
  );
}

beforeEach(async () => {
  temporaryParent = await realpath(
    await mkdtemp(join(tmpdir(), "uptick-demo-isolation-")),
  );
  demoRoot = join(temporaryParent, ".demo-studio");
  databasePath = join(demoRoot, "database");
  await mkdir(databasePath, { recursive: true });
  await writeOwnershipMarker();
});

afterEach(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  if (temporaryParent)
    await rm(temporaryParent, { recursive: true, force: true });
});

test("the complete explicit loopback demo environment is accepted", async () => {
  const paths = assertDemoEnvironment(safeDemoEnvironment());
  assert.deepEqual(paths, {
    root: resolve(demoRoot),
    database: resolve(databasePath),
  });

  setProcessEnvironment(safeDemoEnvironment());
  assert.deepEqual(assertDemoStorage(), paths);
  assert.equal((await lstat(paths.root)).isSymbolicLink(), false);
  assert.equal(await realpath(paths.database), paths.database);
});

test("demo mode rejects hosted databases, origins, services, delivery and enrollment", () => {
  const cases: Array<{
    label: string;
    changes: EnvironmentOverrides;
    message: RegExp;
  }> = [
    {
      label: "disabled mode",
      changes: { UPTICK_DEMO_MODE: "false" },
      message: /disabled/i,
    },
    {
      label: "hosted HTTPS origin",
      changes: { APP_URL: "https://pilot.upticklocal.com" },
      message: /hosted origins|loopback origin/i,
    },
    {
      label: "loopback-looking subdomain",
      changes: { APP_URL: "http://localhost.example:3210" },
      message: /hosted origins|loopback origin/i,
    },
    {
      label: "HTTPS loopback",
      changes: { APP_URL: "https://127.0.0.1:3210" },
      message: /hosted origins|loopback origin/i,
    },
    {
      label: "hosted database",
      changes: { DATABASE_URL: "postgresql://example.invalid/uptick" },
      message: /DATABASE_URL|hosted service/i,
    },
    {
      label: "Vercel runtime",
      changes: { VERCEL: "1" },
      message: /DATABASE_URL|hosted service/i,
    },
    {
      label: "Vercel environment",
      changes: { VERCEL_ENV: "preview" },
      message: /DATABASE_URL|hosted service/i,
    },
    {
      label: "Supabase URL",
      changes: { SUPABASE_URL: "https://example.supabase.co" },
      message: /DATABASE_URL|hosted service/i,
    },
    {
      label: "Supabase anonymous key",
      changes: { SUPABASE_ANON_KEY: "public-but-hosted" },
      message: /DATABASE_URL|hosted service/i,
    },
    {
      label: "Twilio transport",
      changes: { SMS_TRANSPORT: "twilio" },
      message: /real enrollment and real SMS disabled/i,
    },
    {
      label: "Twilio account",
      changes: { TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}` },
      message: /real enrollment and real SMS disabled/i,
    },
    {
      label: "Twilio credential",
      changes: { TWILIO_AUTH_TOKEN: "must-not-enter-demo" },
      message: /real enrollment and real SMS disabled/i,
    },
    {
      label: "real enrollment",
      changes: { PILOT_ENROLLMENT_ENABLED: "true" },
      message: /real enrollment and real SMS disabled/i,
    },
    {
      label: "production delivery",
      changes: { PRODUCTION_DELIVERY_ENABLED: "true" },
      message: /real enrollment and real SMS disabled/i,
    },
    {
      label: "staging environment",
      changes: { UPTICK_ENV: "staging" },
      message: /real enrollment and real SMS disabled/i,
    },
    {
      label: "local mode disabled",
      changes: { UPTICK_LOCAL_MODE: "false" },
      message: /real enrollment and real SMS disabled/i,
    },
  ];

  for (const { label, changes, message } of cases) {
    assert.throws(
      () => assertDemoEnvironment({ ...safeDemoEnvironment(), ...changes }),
      message,
      label,
    );
  }

  assert.throws(
    () =>
      assertDemoEnvironment({
        ...safeDemoEnvironment(),
        DATABASE_URL: "postgresql://example.invalid/uptick",
        SMS_TRANSPORT: "twilio",
        TWILIO_AUTH_TOKEN: "must-not-enter-demo",
        PILOT_ENROLLMENT_ENABLED: "true",
      }),
    /DATABASE_URL|hosted service|real enrollment|real SMS/i,
    "combined hostile settings",
  );
});

test("the launcher rejects inherited hosted and real-delivery settings before touching storage", async () => {
  const sentinel = join(demoRoot, "launcher-sentinel.txt");
  await writeFile(sentinel, "unchanged");
  const cases: Array<{
    label: string;
    changes: EnvironmentOverrides;
    message: RegExp;
  }> = [
    {
      label: "DATABASE_URL",
      changes: { DATABASE_URL: "postgresql://example.invalid/uptick" },
      message: /refuses inherited DATABASE_URL/i,
    },
    {
      label: "Vercel",
      changes: { VERCEL: "1" },
      message: /refuses inherited VERCEL/i,
    },
    {
      label: "Vercel environment",
      changes: { VERCEL_ENV: "production" },
      message: /refuses inherited VERCEL_ENV/i,
    },
    {
      label: "Supabase URL",
      changes: { SUPABASE_URL: "https://example.supabase.co" },
      message: /refuses inherited SUPABASE_URL/i,
    },
    {
      label: "Supabase key",
      changes: { SUPABASE_ANON_KEY: "hosted-key" },
      message: /refuses inherited SUPABASE_ANON_KEY/i,
    },
    {
      label: "Twilio account",
      changes: { TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}` },
      message: /refuses inherited TWILIO_ACCOUNT_SID/i,
    },
    {
      label: "Twilio token",
      changes: { TWILIO_AUTH_TOKEN: "hosted-token" },
      message: /refuses inherited TWILIO_AUTH_TOKEN/i,
    },
    {
      label: "hosted origin",
      changes: { APP_URL: "https://pilot.upticklocal.com" },
      message: /refuses hosted origins/i,
    },
    {
      label: "Twilio transport",
      changes: { SMS_TRANSPORT: "twilio" },
      message: /refuses hosted origins, real enrollment and real SMS/i,
    },
    {
      label: "real enrollment",
      changes: { PILOT_ENROLLMENT_ENABLED: "true" },
      message: /refuses hosted origins, real enrollment and real SMS/i,
    },
    {
      label: "production delivery",
      changes: { PRODUCTION_DELIVERY_ENABLED: "true" },
      message: /refuses hosted origins, real enrollment and real SMS/i,
    },
  ];

  for (const { label, changes, message } of cases) {
    const result = runTypeScript(
      demoLauncher,
      ["--reset"],
      isolatedChildEnvironment(changes),
      temporaryParent,
    );
    assert.notEqual(result.status, 0, label);
    assert.match(result.stdout + result.stderr, message, label);
    assert.equal(await readFile(sentinel, "utf8"), "unchanged", label);
  }
});

test("demo storage is restricted to an exact database child of a named absolute root", () => {
  const cases: Array<{ label: string; changes: EnvironmentOverrides }> = [
    {
      label: "relative root",
      changes: { UPTICK_DEMO_ROOT: ".demo-studio" },
    },
    {
      label: "ordinary application database",
      changes: { LOCAL_DATABASE_PATH: resolve(".data/uptick") },
    },
    {
      label: "database sibling",
      changes: { LOCAL_DATABASE_PATH: join(demoRoot, "other-database") },
    },
    {
      label: "wrong root name",
      changes: {
        UPTICK_DEMO_ROOT: temporaryParent,
        LOCAL_DATABASE_PATH: join(temporaryParent, "database"),
      },
    },
  ];

  for (const { label, changes } of cases) {
    assert.throws(
      () => assertDemoEnvironment({ ...safeDemoEnvironment(), ...changes }),
      /isolated database path/i,
      label,
    );
  }
});

test("demo storage requires an exact, parseable ownership marker", async () => {
  setProcessEnvironment(safeDemoEnvironment());
  const cases = [
    {
      label: "wrong kind",
      marker: {
        kind: "ordinary-local-storage",
        repository: temporaryParent,
        database: databasePath,
      },
    },
    {
      label: "wrong checkout",
      marker: {
        kind: "uptick-isolated-demo-v1",
        repository: join(temporaryParent, "other-checkout"),
        database: databasePath,
      },
    },
    {
      label: "wrong database",
      marker: {
        kind: "uptick-isolated-demo-v1",
        repository: temporaryParent,
        database: join(demoRoot, "other-database"),
      },
    },
  ];

  for (const { label, marker } of cases) {
    await writeFile(join(demoRoot, "ownership.json"), JSON.stringify(marker));
    assert.throws(
      () => assertDemoStorage(),
      /ownership|match|checkout/i,
      label,
    );
  }

  await writeFile(join(demoRoot, "ownership.json"), "not-json");
  assert.throws(() => assertDemoStorage(), /JSON|position|unexpected token/i);

  await rm(join(demoRoot, "ownership.json"));
  assert.throws(() => assertDemoStorage(), /ENOENT|no such file/i);
});

test("demo storage rejects symbolic links for the root and database", async () => {
  const rootTarget = join(temporaryParent, "root-target");
  await rm(demoRoot, { recursive: true, force: true });
  await mkdir(join(rootTarget, "database"), { recursive: true });
  await writeOwnershipMarker(rootTarget);
  await symlink(rootTarget, demoRoot, "dir");
  setProcessEnvironment(safeDemoEnvironment());
  assert.throws(() => assertDemoStorage(), /symlink|alias/i);

  await rm(demoRoot, { force: true });
  await mkdir(demoRoot, { recursive: true });
  await writeOwnershipMarker();
  const databaseTarget = join(temporaryParent, "database-target");
  await mkdir(databaseTarget);
  await symlink(databaseTarget, databasePath, "dir");
  assert.throws(() => assertDemoStorage(), /symlink|alias/i);
});

test("reset verification rejects unowned storage without deleting it", async () => {
  const sentinel = join(databasePath, "not-a-demo.txt");
  await writeFile(sentinel, "ordinary local data");
  await rm(join(demoRoot, "ownership.json"));

  const result = runStorageVerifier();
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout + result.stderr,
    /ownership\.json|ENOENT|no such file/i,
  );
  assert.equal(await readFile(sentinel, "utf8"), "ordinary local data");
});

test("reset verification rejects linked database storage without touching its target", async () => {
  const target = join(temporaryParent, "ordinary-database-target");
  const sentinel = join(target, "ordinary-data.txt");
  await rm(databasePath, { recursive: true, force: true });
  await mkdir(target);
  await writeFile(sentinel, "keep me");
  await symlink(target, databasePath, "dir");

  const result = runStorageVerifier();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /linked storage|symlink/i);
  assert.equal(await readFile(sentinel, "utf8"), "keep me");
});

test("reset verification rejects a real classified row before mutation", () => {
  initializeOrdinaryDatabase([
    "insert into market_cells(id,name,slug,state,data_kind) values('real-market','Real market','real-market','pilot','real')",
  ]);

  const result = runStorageVerifier();
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout + result.stderr,
    /real records found|reset refused/i,
  );

  const preserved = readDatabaseCount(
    "select count(*)::int count from market_cells where id='real-market' and data_kind='real'",
  );
  assert.equal(
    preserved.status,
    0,
    `database read failed\nstdout:\n${preserved.stdout}\nstderr:\n${preserved.stderr}`,
  );
  assert.match(preserved.stdout, /ROW_COUNT=1/);
});

test("reset verification rejects a non-demo organization before mutation", () => {
  initializeOrdinaryDatabase([
    "insert into organizations(id,name,is_demo) values('real-organization','Real organization',false)",
  ]);

  const result = runStorageVerifier();
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout + result.stderr,
    /non-demo organizations found|reset refused/i,
  );

  const preserved = readDatabaseCount(
    "select count(*)::int count from organizations where id='real-organization' and not is_demo",
  );
  assert.equal(
    preserved.status,
    0,
    `database read failed\nstdout:\n${preserved.stdout}\nstderr:\n${preserved.stderr}`,
  );
  assert.match(preserved.stdout, /ROW_COUNT=1/);
});

test("an isolated demo database installs CHECK constraints that reject real data kinds", () => {
  const safeEnvironment = safeDemoEnvironment();
  const environment = { ...process.env, ...safeEnvironment };
  for (const key of guardedEnvironmentKeys) {
    if (!(key in safeEnvironment)) delete environment[key];
  }

  const program = String.raw`
    const assert = (await import("node:assert/strict")).default;
    const { getDb } = await import("./src/lib/db.ts");
    const db = await getDb();
    try {
      const tables = await db.query("select table_name from information_schema.columns where table_schema='public' and column_name='data_kind' order by table_name");
      const constraints = await db.query("select conname from pg_constraint where conname like 'demo_only_%' order by conname");
      const expected = [...tables.map(({ table_name }) => "demo_only_" + table_name), "demo_only_organizations"].sort();
      assert.deepEqual(constraints.map(({ conname }) => conname), expected);

      async function rejectsReal(label, sql) {
        try {
          await db.query(sql);
          console.error("REAL_WRITE_SUCCEEDED:" + label);
          process.exitCode = 2;
        } catch (error) {
          if (!/demo_only_|check constraint/i.test(String(error))) {
            console.error(label + ":" + String(error));
            process.exitCode = 3;
          }
        }
      }

      await db.query("insert into market_cells(id,name,slug,state,data_kind) values('allowed-demo','Allowed demo','allowed-demo','pilot','demo')");
      await rejectsReal("real-market-insert", "insert into market_cells(id,name,slug,state,data_kind) values('forbidden-real','Forbidden real','forbidden-real','pilot','real')");
      await rejectsReal("real-market-update", "update market_cells set data_kind='real' where id='allowed-demo'");
      await rejectsReal("real-pilot-insert", "insert into pilot_runs(id,market_id,name,starts_on,ends_on,state,data_kind,target_members,hard_cap,operator_owner,support_owner,backup_support_owner,created_by) values('forbidden-run','allowed-demo','Forbidden run','2030-01-07','2030-02-04','draft','real',1,1,'operator','support','backup','operator')");

      await db.query("insert into organizations(id,name,is_demo) values('allowed-organization','Allowed organization',true)");
      await rejectsReal("non-demo-organization", "insert into organizations(id,name,is_demo) values('forbidden-organization','Forbidden organization',false)");
    } finally {
      await db.close?.();
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", program],
    {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
      timeout: 60_000,
    },
  );

  assert.equal(
    result.status,
    0,
    `demo database child failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.doesNotMatch(result.stdout + result.stderr, /REAL_WRITE_SUCCEEDED/);
});

test("the demo API stops at its demo guard when the feature is disabled", async () => {
  setProcessEnvironment({
    UPTICK_DEMO_MODE: "false",
    APP_URL: "https://pilot.upticklocal.com",
    DATABASE_URL: "postgresql://example.invalid/uptick",
  });
  const { POST } = await import("../src/app/api/demo/route");
  const response = await POST(
    new Request("https://pilot.upticklocal.com/api/demo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://pilot.upticklocal.com",
      },
      body: JSON.stringify({ action: "operator" }),
    }),
  );

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found");
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});
