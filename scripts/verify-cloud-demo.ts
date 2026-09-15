import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, readFile, writeFile, rm } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
  requestMemberAccess,
  exchangeMemberAccess,
} from "../src/lib/membership-identity";
import { claimMemberDrop } from "../src/lib/network";
import { redeemAtPoint } from "../src/lib/tap";
import { decrypt } from "../src/lib/security";
import { pgAdapter } from "../src/lib/db";
import { installCloudDemoSchema } from "../src/lib/cloud-demo-schema";
import {
  cloudSchemaDb,
  leasedCloudDemoDb,
  acquireCloudDemoLease,
  requireCloudDemoLease,
} from "../src/lib/cloud-demo-db";
import { resetCloudDemo } from "../src/lib/cloud-demo-reset";
import {
  demoSnapshot,
  demoStockout,
  demoRecovery,
} from "../src/lib/demo-studio";

// Owns only a new temporary cluster. Never connects to the URL in the deployment
// configuration; that URL supplies the reviewed identity marker and password.
const prepare = process.argv.includes("--prepare-cloud");
const secret = () => randomBytes(32).toString("base64url");
const config = prepare
  ? JSON.parse(await readFile("private/cloud-demo/environment.json", "utf8"))
  : {
      UPTICK_CLOUD_DEMO_MODE: "true",
      UPTICK_ENV: "development",
      SMS_TRANSPORT: "development",
      PILOT_ENROLLMENT_ENABLED: "false",
      PRODUCTION_DELIVERY_ENABLED: "false",
      MEMBER_ACCESS_SMS_ENABLED: "false",
      MEMBER_PROMOTIONAL_SMS_ENABLED: "false",
      MESSAGING_APPROVED: "false",
      LEGAL_APPROVED: "false",
      APP_URL: "https://cloud-demo.example.test",
      CLOUD_DEMO_ORIGIN: "https://cloud-demo.example.test",
      CLOUD_DEMO_PROJECT_REF: "abcdefghijklmnopqrst",
      CLOUD_DEMO_VERCEL_PROJECT_ID: "prj_CloudDemoLocalProof",
      CLOUD_DEMO_DATABASE_URL: `postgres://uptick_cloud_demo_runtime:${secret()}@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`,
      CLOUD_DEMO_INSTANCE_ID: secret(),
      CLOUD_DEMO_ACCESS_KEY: secret(),
      SESSION_SECRET: secret(),
      PASS_ENCRYPTION_KEY: secret(),
      CRON_SECRET: secret(),
      PRIVACY_SUPPRESSION_KEY: secret(),
    };
for (const name of [
  "DATABASE_URL",
  "LOCAL_DATABASE_PATH",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
])
  delete process.env[name];
Object.assign(process.env, config, {
  UPTICK_LOCAL_MODE: "false",
  UPTICK_DEMO_MODE: "false",
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: config.CLOUD_DEMO_VERCEL_PROJECT_ID,
});
const password = new URL(config.CLOUD_DEMO_DATABASE_URL).password;
const root = await realpath(await mkdtemp("/tmp/uptick-cloud-proof."));
await writeFile(join(root, ".owner"), "uptick-cloud-proof");
const bin = execFileSync("pg_config", ["--bindir"], {
  encoding: "utf8",
}).trim();
const run = (name: string, args: string[]) =>
  execFileSync(join(bin, name), args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120000,
  });
let started = false;
const pools: ReturnType<typeof postgres>[] = [];
try {
  run("initdb", [
    "-D",
    join(root, "data"),
    "--auth-local=trust",
    "--auth-host=reject",
    "--encoding=UTF8",
    "--locale=C",
  ]);
  run("pg_ctl", [
    "-D",
    join(root, "data"),
    "-l",
    join(root, "server.log"),
    "-o",
    `-k ${root} -p 55443 -c listen_addresses='' -c shared_buffers=16MB -c min_wal_size=32MB -c max_wal_size=64MB`,
    "-w",
    "start",
  ]);
  started = true;
  const connect = (user: string) => {
    const p = postgres({
      host: root,
      port: 55443,
      database: "postgres",
      user,
      prepare: false,
      max: 3,
      onnotice: () => {},
    });
    pools.push(p);
    return pgAdapter(p);
  };
  const owner = connect(userInfo().username);
  await owner.query(
    "create table public.untouched(id int primary key, evidence text); insert into public.untouched values(1,'must remain unchanged'); create schema auth; create table auth.users(id int); insert into auth.users values(1)",
  );
  await installCloudDemoSchema(owner, password);
  const base = cloudSchemaDb(connect("uptick_cloud_demo_runtime"));
  await assert.rejects(
    () => base.query("select * from public.untouched"),
    /permission denied/,
  );
  await assert.rejects(
    () => base.query("update public.untouched set evidence='bad'"),
    /permission denied/,
  );
  await assert.rejects(
    () => base.query("select * from auth.users"),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      base.query("update uptick_demo.ownership set origin='https://evil.test'"),
    /permission denied/,
  );
  await assert.rejects(
    () => base.query("delete from schema_migrations"),
    /permission denied/,
  );
  await assert.rejects(
    () => acquireCloudDemoLease(base, "incorrect"),
    /not accepted/,
  );
  let credential = await acquireCloudDemoLease(
    base,
    config.CLOUD_DEMO_ACCESS_KEY,
  );
  await assert.rejects(
    () => acquireCloudDemoLease(base, config.CLOUD_DEMO_ACCESS_KEY),
    /already open/,
  );
  let leased = leasedCloudDemoDb(base, credential);
  assert.equal((await demoSnapshot(leased)).counts.claims, 0);
  await assert.rejects(
    () => leased.query("update customers set phone='+19145551234'"),
    /demo_only_phone/,
  );
  await assert.rejects(
    () => leased.query("update uptick_members set data_kind='real'"),
    /demo_only/,
  );
  await assert.rejects(
    () => leased.query("update organizations set is_demo=false"),
    /demo_only/,
  );
  const access = await requestMemberAccess(leased, {
    phone: "+12025550123",
    homeZip: "10583",
    consentRequested: false,
    ageAttested: true,
  });
  const member = await exchangeMemberAccess(leased, access.credential, false);
  const claim = await claimMemberDrop(
    leased,
    member.credential,
    "demo-supply-1",
  );
  const snap = await demoSnapshot(leased);
  await redeemAtPoint(leased, decrypt(claim.token_encrypted), {
    pointToken: snap.qr.public_token,
  });
  assert.equal((await demoSnapshot(leased)).counts.redemptions, 1);
  await demoStockout(leased);
  await demoRecovery(leased);
  await redeemAtPoint(leased, decrypt(claim.token_encrypted), {
    pointToken: snap.qr.public_token,
  });
  assert.equal((await demoSnapshot(leased)).counts.recovery_redemptions, 1);
  assert.equal((await demoSnapshot(leased)).counts.recoveries, 1);
  const second = cloudSchemaDb(connect("uptick_cloud_demo_runtime"));
  assert.equal(
    (await demoSnapshot(leasedCloudDemoDb(second, credential))).counts
      .recoveries,
    1,
  );
  const before = (await demoSnapshot(leased)).counts;
  const fault = {
    ...base,
    transaction: <T>(fn: (tx: import("../src/lib/db").DB) => Promise<T>) =>
      base.transaction((tx) =>
        fn({
          ...tx,
          query: async (sql, params) => {
            if (sql.startsWith("insert into organizations"))
              throw Error("injected seed failure");
            return tx.query(sql, params);
          },
        }),
      ),
  };
  await assert.rejects(
    () => resetCloudDemo(fault, credential),
    /injected seed failure/,
  );
  assert.deepEqual((await demoSnapshot(leased)).counts, before);
  await requireCloudDemoLease(base, credential);
  // Unexpected inventory must refuse reset without altering current records.
  await owner.query("create table uptick_cloud_demo.unreviewed(id int)");
  await assert.rejects(
    () => resetCloudDemo(base, credential),
    /inventory changed/,
  );
  assert.deepEqual((await demoSnapshot(leased)).counts, before);
  await owner.query("drop table uptick_cloud_demo.unreviewed");
  const old = credential;
  credential = await resetCloudDemo(base, credential);
  await assert.rejects(
    () => requireCloudDemoLease(base, old),
    /ended or was reset/,
  );
  leased = leasedCloudDemoDb(base, credential);
  assert.deepEqual((await demoSnapshot(leased)).counts, {
    claims: 0,
    redemptions: 0,
    incidents: 0,
    recoveries: 0,
    recovery_redemptions: 0,
  });
  assert.deepEqual(
    [...(await owner.query("select * from public.untouched"))],
    [{ id: 1, evidence: "must remain unchanged" }],
  );
  // Export a clean unleased fixture, using schema-qualified pg_dump output.
  await owner.query(
    "update uptick_demo.lease set token_hash=null,expires_at=null,generation=1",
  );
  const dump = run("pg_dump", [
    "-h",
    root,
    "-p",
    "55443",
    "-U",
    userInfo().username,
    "-d",
    "postgres",
    "--schema=uptick_cloud_demo",
    "--schema=uptick_demo",
    "--no-owner",
    "--inserts",
    "--column-inserts",
  ])
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("\\restrict") && !line.startsWith("\\unrestrict"),
    )
    .join("\n");
  const pre = `begin; select pg_advisory_xact_lock(723914208);\ndo $$ begin if exists(select 1 from pg_namespace where nspname in ('uptick_cloud_demo','uptick_demo')) or exists(select 1 from pg_roles where rolname='uptick_cloud_demo_runtime') then raise exception 'Cloud demo already exists; refusing overwrite'; end if; end $$;\ncreate role uptick_cloud_demo_runtime login password '${password}' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 10;\n`;
  const post = `
revoke all on schema uptick_cloud_demo,uptick_demo from anon,authenticated,service_role;
revoke all on all tables in schema uptick_cloud_demo,uptick_demo from anon,authenticated,service_role;
revoke all on all functions in schema uptick_cloud_demo from anon,authenticated,service_role;
\ndo $$ begin if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and c.relkind in ('r','p','v','m') and (has_table_privilege('uptick_cloud_demo_runtime',c.oid,'SELECT') or has_table_privilege('uptick_cloud_demo_runtime',c.oid,'INSERT') or has_table_privilege('uptick_cloud_demo_runtime',c.oid,'UPDATE') or has_table_privilege('uptick_cloud_demo_runtime',c.oid,'DELETE') or has_table_privilege('uptick_cloud_demo_runtime',c.oid,'TRUNCATE'))) then raise exception 'Unexpected public/auth access; rollback'; end if; if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('uptick_cloud_demo_runtime',p.oid,'EXECUTE')) then raise exception 'Unexpected public definer access; rollback'; end if; end $$;\ncommit;\n`;
  if (prepare)
    await writeFile("private/cloud-demo/provisioning.sql", pre + dump + post, {
      mode: 0o600,
    });
  console.log(
    JSON.stringify(
      {
        passed: true,
        privateMigrations: 34,
        publicReadWriteDenied: true,
        authReadDenied: true,
        leaseIsolation: true,
        fullJourneyIncludingRecoveryRedemption: true,
        failedResetRollsBack: true,
        twoConnectionPersistence: true,
        resetAndCredentialRotation: true,
        realDataConstraints: true,
        publicSentinelUnchanged: true,
        provisioningBytes: Buffer.byteLength(pre + dump + post),
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.all(pools.map((p) => p.end({ timeout: 2 })));
  if (started)
    run("pg_ctl", ["-D", join(root, "data"), "-m", "fast", "-w", "stop"]);
  if ((await readFile(join(root, ".owner"), "utf8")) === "uptick-cloud-proof")
    await rm(root, { recursive: true });
}
