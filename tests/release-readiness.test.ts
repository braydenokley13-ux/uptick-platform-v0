import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb, migrate, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import {
  migrationIntegrity,
  recordCallbackHealth,
  recordCommissioningEvidence,
  releaseReadiness,
  reviewLegacyMigrationBaseline,
} from "../src/lib/release-readiness";
import { encrypt } from "../src/lib/security";

const actor: Actor = {
  id: "release-readiness-operator",
  role: "operator",
  organizationId: "release-readiness-organization",
};
const firstRelease = "a".repeat(40);
const secondRelease = "b".repeat(40);

async function readinessDb() {
  process.env.UPTICK_ENV = "development";
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
  process.env.PASS_ENCRYPTION_KEY = "p".repeat(64);
  process.env.SESSION_SECRET = "s".repeat(64);
  process.env.SUPPORT_EMAIL = "help@uptick.example";
  process.env.VERCEL_GIT_COMMIT_SHA = firstRelease;
  process.env.TWILIO_ACCOUNT_SID = `AC${"c".repeat(32)}`;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.PILOT_ENROLLMENT_ENABLED;
  delete process.env.MEMBER_ACCESS_SMS_ENABLED;
  delete process.env.MEMBER_PROMOTIONAL_SMS_ENABLED;
  const db = await memoryDb();
  await db.query(
    "insert into member_senders(id,service_sid,phone,approved) values('sender-one',$1,'+12015550199',true)",
    [`MG${"a".repeat(32)}`],
  );
  return db;
}

function savedCheck(
  readiness: Awaited<ReturnType<typeof releaseReadiness>>,
  key: string,
) {
  const check = readiness.checks.find((candidate) => candidate.key === key);
  assert.ok(check, `Missing commissioning check ${key}`);
  return check;
}

async function recordVerified(db: DB, checkKey: "ci_build" | "access_receipt") {
  await recordCommissioningEvidence(db, actor, {
    checkKey,
    state: "verified",
    evidence:
      "The isolated release-readiness test verified this commissioning check.",
    owner: "Release operator",
    reviewDueAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
}

test("commissioning evidence is current only for the release where it was recorded", async () => {
  const db = await readinessDb();
  try {
    await recordVerified(db, "ci_build");
    let check = savedCheck(await releaseReadiness(db), "ci_build");
    assert.equal(check.current, true);
    assert.equal(check.state, "verified");

    process.env.VERCEL_GIT_COMMIT_SHA = secondRelease;
    check = savedCheck(await releaseReadiness(db), "ci_build");
    assert.equal(check.current, false);
    assert.equal(check.state, "unverified");
  } finally {
    process.env.VERCEL_GIT_COMMIT_SHA = firstRelease;
    await db.close?.();
  }
});

test("messaging evidence becomes unverified when the active sender changes", async () => {
  const db = await readinessDb();
  try {
    await recordVerified(db, "access_receipt");
    assert.equal(
      savedCheck(await releaseReadiness(db), "access_receipt").current,
      true,
    );

    await db.query(
      "update member_senders set active=false where id='sender-one'",
    );
    await db.query(
      "insert into member_senders(id,service_sid,phone,approved) values('sender-two',$1,'+12015550200',true)",
      [`MG${"b".repeat(32)}`],
    );
    const changed = savedCheck(await releaseReadiness(db), "access_receipt");
    assert.equal(changed.current, false);
    assert.equal(changed.state, "unverified");
  } finally {
    await db.close?.();
  }
});

test("expired evidence remains visible but cannot satisfy its commissioning check", async () => {
  const db = await readinessDb();
  try {
    const schema = await migrationIntegrity(db);
    await db.query(
      `insert into commissioning_evidence(
        id,check_key,state,release_sha,schema_fingerprint,sender_id,
        evidence_encrypted,owner,actor_id,verified_at,review_due_at
       ) values('expired-release-evidence','ci_build','verified',$1,$2,null,$3,
        'Release operator',$4,now()-interval '2 days',now()-interval '1 day')`,
      [
        firstRelease,
        schema.fingerprint,
        encrypt("This evidence is intentionally expired for an isolated test."),
        actor.id,
      ],
    );
    const expired = savedCheck(await releaseReadiness(db), "ci_build");
    assert.equal(expired.current, false);
    assert.equal(expired.state, "unverified");
    assert.match(expired.evidence || "", /intentionally expired/);
  } finally {
    await db.close?.();
  }
});

test("legacy migration rows stay unverified until an operator reviews their baseline", async () => {
  const db = await readinessDb();
  try {
    await db.query("truncate schema_migration_checksums");
    const legacy = await migrationIntegrity(db);
    assert.equal(legacy.matches, false);
    assert.deepEqual(
      legacy.unverified,
      legacy.expected.map((migration) => migration.name),
    );

    await reviewLegacyMigrationBaseline(
      db,
      actor,
      "The operator compared every historical statement and the resulting hosted schema.",
    );
    const reviewed = await migrationIntegrity(db);
    assert.equal(reviewed.matches, true);
    assert.equal(reviewed.unverified.length, 0);
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from schema_migration_checksums where basis='reviewed_baseline'",
        )
      )[0].count,
      reviewed.expected.length,
    );
  } finally {
    await db.close?.();
  }
});

test("migration replay rejects checksum drift before applying anything else", async () => {
  const db = await readinessDb();
  try {
    const [{ name }] = await db.query<{ name: string }>(
      'select name from schema_migrations order by name collate "C" limit 1',
    );
    await db.query("truncate schema_migration_checksums");
    await db.query(
      "insert into schema_migration_checksums(name,sha256,basis) values($1,$2,'reviewed_baseline')",
      [name, "0".repeat(64)],
    );
    await assert.rejects(
      migrate(db),
      new RegExp(
        `Applied migration ${name} differs from its recorded checksum`,
      ),
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from schema_migration_checksums",
        )
      )[0].count,
      1,
    );
  } finally {
    await db.close?.();
  }
});

test("callback health stores aggregate outcomes and bounded codes without personal data", async () => {
  const db = await readinessDb();
  try {
    await recordCallbackHealth(db, "inbound", true, undefined, "sender-one");
    await recordCallbackHealth(db, "inbound", false, 403);
    await recordCallbackHealth(db, "status", false);
    await recordCallbackHealth(db, "inbound:+12015550123", false, 500);

    const callbacks = (await releaseReadiness(db)).callbacks;
    assert.deepEqual(
      callbacks.map((row) => ({
        kind: row.kind,
        successful: Number(row.successful_count),
        failed: Number(row.failed_count),
        code: row.last_failure_code,
      })),
      [
        { kind: "inbound", successful: 1, failed: 1, code: "http_403" },
        {
          kind: "status",
          successful: 0,
          failed: 1,
          code: "processing_failed",
        },
      ],
    );
    const columns = (
      await db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='public' and table_name='member_callback_health' order by ordinal_position",
      )
    ).map((row) => row.column_name);
    assert.deepEqual(columns, [
      "kind",
      "successful_count",
      "failed_count",
      "last_success_at",
      "last_failure_at",
      "last_failure_code",
      "last_success_scope",
    ]);
    assert.ok(
      callbacks.every(
        (row) =>
          !JSON.stringify(row).includes("+12015550123") &&
          !JSON.stringify(row).includes("help@uptick.example"),
      ),
    );
  } finally {
    await db.close?.();
  }
});

test("callback success is current only for its release, sender, configuration and seven-day window", async () => {
  const db = await readinessDb();
  try {
    await recordCallbackHealth(db, "inbound", true, undefined, "sender-one");
    const current = () =>
      releaseReadiness(db).then(
        (readiness) =>
          readiness.callbacks.find((callback) => callback.kind === "inbound")!
            .current,
      );
    assert.equal(await current(), true);

    process.env.VERCEL_GIT_COMMIT_SHA = secondRelease;
    assert.equal(await current(), false);
    process.env.VERCEL_GIT_COMMIT_SHA = firstRelease;

    process.env.TWILIO_ACCOUNT_SID = `AC${"d".repeat(32)}`;
    assert.equal(await current(), false);
    process.env.TWILIO_ACCOUNT_SID = `AC${"c".repeat(32)}`;

    process.env.APP_URL = "https://changed-origin.example";
    assert.equal(await current(), false);
    process.env.APP_URL = "http://localhost:3000";

    process.env.UPTICK_ENV = "staging";
    assert.equal(await current(), false);
    process.env.UPTICK_ENV = "development";

    await db.query(
      "update member_senders set service_sid=$1 where id='sender-one'",
      [`MG${"e".repeat(32)}`],
    );
    assert.equal(await current(), false);
    await recordCallbackHealth(db, "inbound", true, undefined, "sender-one");
    assert.equal(await current(), true);

    await db.query(
      "update member_callback_health set last_success_at=now()-interval '8 days' where kind='inbound'",
    );
    assert.equal(await current(), false);
  } finally {
    process.env.VERCEL_GIT_COMMIT_SHA = firstRelease;
    process.env.TWILIO_ACCOUNT_SID = `AC${"c".repeat(32)}`;
    process.env.APP_URL = "http://localhost:3000";
    process.env.UPTICK_ENV = "development";
    await db.close?.();
  }
});
