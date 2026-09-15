import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import postgres from "postgres";
import { migrate, pgAdapter, type DB } from "../src/lib/db";
import {
  admitPilotMember,
  loadPilotRun,
  pilotCapacity,
} from "../src/lib/pilot-operations";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "./verify-postgres-pilot";

// This verifier owns a disposable PostgreSQL cluster under /tmp. It does not
// inherit an application connection string and cannot address a hosted server.
delete process.env.DATABASE_URL;
delete process.env.PGHOST;
delete process.env.PGPORT;
delete process.env.PGUSER;
delete process.env.PGDATABASE;
delete process.env.VERCEL;
process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";

const marker = "uptick-real-enrollment-upgrade-v1";
const temporaryParent = await realpath("/tmp");
const root = await realpath(
  await mkdtemp(join(temporaryParent, "uptick-real-enrollment-upgrade.")),
);
assert.equal(dirname(root), temporaryParent);
assert.match(basename(root), /^uptick-real-enrollment-upgrade\.[A-Za-z0-9]+$/);
await writeFile(resolve(root, ".uptick-test-cluster"), `${marker}\n`, {
  flag: "wx",
});

const childEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PATH: process.env.PATH,
  LANG: "C",
  LC_ALL: "C",
  PGCONNECT_TIMEOUT: "5",
};
let serverStarted = false;

function run(executable: string, args: string[]) {
  execFileSync(executable, args, {
    env: childEnvironment,
    stdio: "pipe",
    timeout: 120_000,
  });
}

function weekAfter(firstWeek: string, index: number) {
  return new Date(Date.parse(`${firstWeek}T12:00:00Z`) + index * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function applyThrough(db: DB, lastMigration: string) {
  await db.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())",
  );
  const names = (await readdir(resolve("db/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => name <= lastMigration);
  assert.equal(names.at(-1), lastMigration);
  for (const name of names) {
    const sql = await readFile(resolve("db/migrations", name), "utf8");
    await db.transaction(async (tx) => {
      await tx.query(sql);
      await tx.query("insert into schema_migrations(name) values($1)", [name]);
    });
  }
  return names;
}

async function selectedFingerprint(db: DB) {
  const tables = [
    "customers",
    "uptick_members",
    "member_senders",
    "member_suppressions",
  ];
  const result: Record<string, { count: number; digest: string | null }> = {};
  for (const table of tables) {
    const [row] = await db.query<{ count: number; digest: string | null }>(
      `select count(*)::int count,
        md5(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text)) digest
       from ${table} t`,
    );
    result[table] = row;
  }
  return result;
}

async function seedMigration021Rows(db: DB) {
  const phone = "+12015550123";
  const senderId = "upgrade-membership-sender";
  await db.query(
    "insert into customers(id,phone) values('upgrade-customer',$1)",
    [phone],
  );
  await db.query(
    `insert into uptick_members(
      id,customer_id,home_zip,state,verified_at,data_kind,age_confirmed_at
     ) values('upgrade-member','upgrade-customer','10583','active',
      '2026-09-01T12:00:00Z','internal','2026-09-01T12:00:00Z')`,
  );
  await db.query(
    `insert into member_senders(id,service_sid,phone,approved)
     values($1,$2,$3,true)`,
    [senderId, `MG${"a".repeat(32)}`, "+12015550199"],
  );
  await db.query(
    `insert into member_suppressions(phone,sender_id,suppressed,updated_at)
     values($1,$2,true,'2026-09-02T12:00:00Z')`,
    [phone, senderId],
  );
  return { phone, senderId };
}

async function addWeekSupply(
  db: DB,
  fixture: SyntheticPilotFixture,
  index: number,
  quantity: number,
) {
  const supplyId = `${fixture.runId}-admission-week-${index}`;
  const weekKey = weekAfter(fixture.weekKey, index);
  const [source] = await db.query<{
    organization_id: string;
    location_id: string;
    starts_at: string;
    expires_at: string;
  }>(
    "select organization_id,location_id,starts_at,expires_at from network_drop_supplies where id=$1",
    [fixture.supplyId],
  );
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Synthetic admission capacity item')",
    [supplyId, source.organization_id, source.location_id],
  );
  await db.query(
    `insert into offer_versions(
      offer_id,version,qualification,reward,terms,starts_at,expires_at,
      limit_mode,quantity
     ) values($1,1,'No purchase required','One free synthetic item',
      'One per synthetic member.',$2,$3,'claim',$4)`,
    [supplyId, source.starts_at, source.expires_at, quantity],
  );
  await db.query(
    `insert into network_drop_supplies(
      id,market_id,organization_id,location_id,offer_id,offer_version,state,
      starts_at,expires_at,inventory_policy,quantity,verification_mode,
      staff_instructions,fallback_plan,approved_by,data_kind
     ) values($1,$2,$3,$4,$1,1,'approved',$5,$6,'claim',$7,'staff_tap',
      'Scan the staff QR and hand over the item.',
      'Use an independently backed substitute.',$8,'synthetic')`,
    [
      supplyId,
      fixture.marketId,
      source.organization_id,
      source.location_id,
      source.starts_at,
      source.expires_at,
      quantity,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_terms(
      supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
      funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values($1,'Synthetic admission capacity item',$2,'12 oz',
      'Current pilot week during posted store hours',$3,$4,$4,'synthetic',$5)`,
    [
      supplyId,
      `${supplyId}-sku`,
      `${supplyId}-primary-stock`,
      source.organization_id,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_fallbacks(
      id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
      usable_capacity,instructions,payer_organization_id,state,approved_by,
      created_by
     ) values($1,$2,'Synthetic sealed substitute',$3,'12 oz',$4,$5,
      'Provide the independent substitute and scan the staff QR.',$6,
      'approved',$7,$7)`,
    [
      `${supplyId}-fallback`,
      supplyId,
      `${supplyId}-fallback-sku`,
      `${supplyId}-fallback-stock`,
      quantity,
      source.organization_id,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into destination_readiness(
      supply_id,organization_id,location_id,state,owner_approved_by,
      primary_manager,primary_contact,backup_contact,stock_confirmed_at,
      exact_item_confirmed,staff_instructions_confirmed,shifts_briefed_at,
      valid_hours_confirmed,qr_rehearsed_at,support_escalation,valid_until,
      updated_by
     ) values($1,$2,$3,'ready',$4,'Synthetic Manager',
      'manager@example.test','backup@example.test',now(),true,true,now(),true,
      now(),'Escalate immediately to the synthetic support owner.',$5,$4)`,
    [
      supplyId,
      source.organization_id,
      source.location_id,
      fixture.actor.id,
      source.expires_at,
    ],
  );
  const pointId = `${supplyId}-point`;
  await db.query(
    `insert into redemption_points(
      id,organization_id,location_id,name,exposure,created_by
     ) values($1,$2,$3,'Synthetic weekly register','staff',$4)`,
    [pointId, source.organization_id, source.location_id, fixture.actor.id],
  );
  await db.query(
    `insert into redemption_credentials(
      id,point_id,public_token,credential_type,version,created_by
     ) values($1,$2,$3,'qr',1,$4)`,
    [`${supplyId}-qr`, pointId, `${supplyId}-qr-token`, fixture.actor.id],
  );
  return { supplyId, weekKey };
}

async function verifyCapacityAndAdmissions(db: DB) {
  const fixture = await seedSyntheticPilot(db, 150, "real-enrollment-upgrade");

  // The reusable fixture creates a completed 150-member example. Remove only
  // its pilot-run graph so the same synthetic members can race for a fresh run.
  await db.query("truncate pilot_runs cascade");
  const supplies = [
    { supplyId: fixture.supplyId, weekKey: fixture.weekKey },
    await addWeekSupply(db, fixture, 1, 150),
    await addWeekSupply(db, fixture, 2, 150),
    await addWeekSupply(db, fixture, 3, 150),
  ];
  const runId = `${fixture.runId}-admission-run`;
  await db.query(
    `insert into pilot_runs(
      id,market_id,name,starts_on,ends_on,state,data_kind,target_members,hard_cap,
      operator_owner,support_owner,backup_support_owner,created_by
     ) values($1,$2,'Synthetic admission race',$3,$4,'enrolling','synthetic',
      149,150,$5,'synthetic-support','synthetic-backup',$5)`,
    [
      runId,
      fixture.marketId,
      fixture.weekKey,
      weekAfter(fixture.weekKey, 4),
      fixture.actor.id,
    ],
  );
  for (const supply of supplies)
    await db.query(
      "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,150,$4)",
      [runId, supply.weekKey, supply.supplyId, fixture.actor.id],
    );

  const beforeReduction = await pilotCapacity(
    db,
    await loadPilotRun(db, runId),
  );
  assert.deepEqual(
    beforeReduction.weeks.map((week) => week.capacity),
    [150, 150, 150, 150],
  );
  await db.query(
    `insert into supply_adjustments(id,supply_id,delta,reason,actor_id)
     values('real-enrollment-stock-reduction',$1,-1,
      'Synthetic one-unit physical stock reduction.', $2)`,
    [supplies[2].supplyId, fixture.actor.id],
  );
  const afterReduction = await pilotCapacity(db, await loadPilotRun(db, runId));
  assert.deepEqual(
    afterReduction.weeks.map((week) => week.capacity),
    [150, 150, 149, 150],
  );
  assert.equal(afterReduction.capacity, 149);

  const results = await Promise.all(
    fixture.members.map((member) =>
      admitPilotMember(db, fixture.actor, { memberId: member.id }),
    ),
  );
  assert.equal(
    results.filter((result) => result.state === "admitted").length,
    149,
  );
  assert.equal(
    results.filter((result) => result.state === "waitlisted").length,
    1,
  );
  const [counts] = await db.query<{ admitted: number; waitlisted: number }>(
    `select
        (select count(*)::int from pilot_admissions where run_id=$1) admitted,
        (select count(*)::int from pilot_waitlist where run_id=$1) waitlisted`,
    [runId],
  );
  assert.equal(counts.admitted, 149);
  assert.equal(counts.waitlisted, 1);
  return {
    attempts: results.length,
    admitted: 149,
    waitlisted: 1,
    weekCapacityBeforeReduction: beforeReduction.weeks.map(
      (week) => week.capacity,
    ),
    weekCapacityAfterReduction: afterReduction.weeks.map(
      (week) => week.capacity,
    ),
    smallestFourWeekCapacity: afterReduction.capacity,
  };
}

try {
  run("initdb", [
    "-D",
    resolve(root, "data"),
    "--auth-local=trust",
    "--auth-host=reject",
    "--encoding=UTF8",
    "--locale=C",
  ]);
  run("pg_ctl", [
    "-D",
    resolve(root, "data"),
    "-l",
    resolve(root, "server.log"),
    "-o",
    `-k ${root} -p 55441 -c listen_addresses='' -c shared_buffers=16MB -c max_connections=32 -c fsync=on -c synchronous_commit=on -c min_wal_size=32MB -c max_wal_size=64MB`,
    "-w",
    "start",
  ]);
  serverStarted = true;

  assert.equal(
    (await readFile(resolve(root, ".uptick-test-cluster"), "utf8")).trim(),
    marker,
  );
  const options = {
    host: root,
    port: 55441,
    user: userInfo().username,
    prepare: false,
    max: 24,
    onnotice: () => {},
  };
  const admin = postgres({ ...options, database: "postgres" });
  try {
    const [{ data_directory }] = await admin`show data_directory`;
    assert.equal(
      await realpath(data_directory),
      await realpath(resolve(root, "data")),
    );
    assert.equal((await admin`show listen_addresses`)[0].listen_addresses, "");
    assert.equal((await admin`show fsync`)[0].fsync, "on");
    await admin.unsafe("create database uptick_real_enrollment_upgrade");
  } finally {
    await admin.end({ timeout: 5 });
  }

  const client = postgres({
    ...options,
    database: "uptick_real_enrollment_upgrade",
  });
  const db = pgAdapter(client);
  try {
    const baselineNames = await applyThrough(
      db,
      "021_membership_function_search_paths.sql",
    );
    const seeded = await seedMigration021Rows(db);
    const beforeUpgrade = await selectedFingerprint(db);
    await migrate(db);
    const afterUpgrade = await selectedFingerprint(db);
    assert.deepEqual(afterUpgrade, beforeUpgrade);

    const expectedNames = (await readdir(resolve("db/migrations")))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const appliedNames = (
      await db.query<{ name: string }>(
        'select name from schema_migrations order by name collate "C"',
      )
    ).map((row) => row.name);
    assert.deepEqual(appliedNames, expectedNames);
    const [latestChecksum] = await db.query<{
      sha256: string;
      basis: string;
    }>("select sha256,basis from schema_migration_checksums where name=$1", [
      expectedNames.at(-1),
    ]);
    assert.match(latestChecksum.sha256, /^[a-f0-9]{64}$/);
    assert.equal(latestChecksum.basis, "applied");
    const [globalSuppression] = await db.query<{
      suppressed: boolean;
      source_sender_id: string;
    }>(
      "select suppressed,source_sender_id from member_global_suppressions where phone=$1",
      [seeded.phone],
    );
    assert.deepEqual(globalSuppression, {
      suppressed: true,
      source_sender_id: seeded.senderId,
    });
    for (const table of [
      "pilot_supply_amendments",
      "member_service_events",
      "member_destination_reviews",
      "recovery_failures",
      "location_outages",
      "privacy_requests",
      "account_session_revocations",
      "privacy_retention_reviews",
    ]) {
      const [row] = await db.query<{ present: boolean }>(
        "select to_regclass($1) is not null present",
        [table],
      );
      assert.equal(row.present, true, `${table} must exist after the upgrade`);
    }

    const admission = await verifyCapacityAndAdmissions(db);
    console.log(
      JSON.stringify(
        {
          result: "PASS",
          postgres: (await db.query<{ version: string }>("select version()"))[0]
            .version,
          method:
            "disposable local PostgreSQL; Unix socket only; TCP disabled; fsync enabled",
          upgrade: {
            from: baselineNames.at(-1),
            to: expectedNames.at(-1),
            seededOriginalTablesPreserved: Object.keys(beforeUpgrade),
            senderStopReconciledProgramWide: true,
            exactMigrationLedger: true,
            latestMigrationChecksum: {
              name: expectedNames.at(-1),
              basis: latestChecksum.basis,
              sha256Recorded: true,
            },
          },
          admission,
          hostedDatabaseTouched: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end({ timeout: 5 });
  }
} finally {
  if (serverStarted) {
    try {
      run("pg_ctl", ["-D", resolve(root, "data"), "-m", "fast", "-w", "stop"]);
    } catch {
      console.error(
        `Temporary PostgreSQL server could not stop. Files retained: ${root}`,
      );
      process.exitCode = 1;
    }
  }
  if (!serverStarted) {
    await rm(root, { recursive: true, force: true });
  } else {
    const status = (() => {
      try {
        run("pg_ctl", ["-D", resolve(root, "data"), "status"]);
        return "running";
      } catch {
        return "stopped";
      }
    })();
    if (status === "stopped") await rm(root, { recursive: true, force: true });
  }
}
