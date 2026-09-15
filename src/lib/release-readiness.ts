import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { DB } from "./db";
import { audit, type Actor } from "./domain";
import { id, encrypt, decrypt } from "./security";
import { RequestError } from "./http";
import { scheduledJobHealth } from "./scheduled-jobs";
import { memberMessagingReadiness } from "./member-messaging";
import { privacyPolicy } from "./privacy-admin";

export const commissioningChecks = [
  ["ci_build", "Software", "CI and build at this release"],
  [
    "schema_review",
    "Hosted commissioning",
    "Hosted schema compared with the release",
  ],
  ["operator_auth", "Hosted commissioning", "Operator sign-in, MFA and logout"],
  [
    "backup_operator",
    "Hosted commissioning",
    "Backup operator and lost-factor recovery",
  ],
  [
    "merchant_auth",
    "Hosted commissioning",
    "Merchant sign-in and tenant boundaries",
  ],
  [
    "member_recovery",
    "Hosted commissioning",
    "Lost-browser member access and recovery",
  ],
  [
    "account_recovery",
    "Hosted commissioning",
    "Recovery email, password reset and session revocation",
  ],
  [
    "backup_restore",
    "Hosted commissioning",
    "Restore rehearsal and reconciliation",
  ],
  [
    "brand_campaign",
    "Messaging",
    "Approved Brand, Campaign and sender association",
  ],
  [
    "access_receipt",
    "Messaging",
    "Requested access: provider acceptance, callback and handset receipt",
  ],
  [
    "promotion_receipt",
    "Messaging",
    "Opt-in confirmation and weekly notice: handset receipt",
  ],
  [
    "keywords_support",
    "Messaging",
    "STOP, START, HELP and ordinary reply rehearsal",
  ],
  [
    "support_coverage",
    "Operations",
    "Primary and backup support coverage and tested contact",
  ],
] as const;
type Evidence = {
  id: string;
  check_key: string;
  state: string;
  release_sha: string;
  schema_fingerprint: string;
  sender_id: string | null;
  evidence_encrypted: string;
  owner: string;
  review_due_at: string;
  verified_at: string;
  messaging_scope: string | null;
};
// Configuration identifiers, never provider secrets or member identifiers.
export async function messagingCommissioningScope(db: DB, senderId?: string) {
  const [sender] = await db.query<{
    id: string;
    service_sid: string;
    phone: string;
  }>(
    senderId
      ? "select id,service_sid,phone from member_senders where id=$1"
      : "select id,service_sid,phone from member_senders where active",
    senderId ? [senderId] : [],
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        release: process.env.VERCEL_GIT_COMMIT_SHA || "local",
        account: process.env.TWILIO_ACCOUNT_SID || "",
        origin: process.env.APP_URL || "",
        environment: process.env.UPTICK_ENV || "",
        sender: sender || null,
      }),
    )
    .digest("hex");
}
export async function migrationIntegrity(db: DB) {
  const names = (await readdir(resolve("db/migrations")))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  const expected = await Promise.all(
    names.map(async (name) => ({
      name,
      sha256: createHash("sha256")
        .update(await readFile(resolve("db/migrations", name)))
        .digest("hex"),
    })),
  );
  const actual = await db.query<{
    name: string;
    sha256: string | null;
    basis: string | null;
  }>(
    "select m.name,c.sha256,c.basis from schema_migrations m left join schema_migration_checksums c on c.name=m.name order by m.name",
  );
  const missing = expected
    .filter((e) => !actual.some((a) => a.name === e.name))
    .map((e) => e.name);
  const unexpected = actual
    .filter((a) => !expected.some((e) => e.name === a.name))
    .map((a) => a.name);
  const unverified = actual.filter((a) => !a.sha256).map((a) => a.name);
  const changed = actual
    .filter(
      (a) =>
        a.sha256 &&
        expected.find((e) => e.name === a.name)?.sha256 !== a.sha256,
    )
    .map((a) => a.name);
  return {
    expected,
    actual,
    missing,
    unexpected,
    unverified,
    changed,
    matches: ![missing, unexpected, unverified, changed].some(
      (rows) => rows.length,
    ),
    fingerprint: createHash("sha256")
      .update(JSON.stringify(expected))
      .digest("hex"),
  };
}
export async function recordCommissioningEvidence(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  const input = z
    .object({
      checkKey: z.enum(commissioningChecks.map((c) => c[0])),
      state: z.enum(["verified", "failed", "pending"]),
      evidence: z.string().trim().min(20).max(3000),
      owner: z.string().trim().min(2).max(200),
      reviewDueAt: z.iso.datetime(),
    })
    .parse(raw);
  if (new Date(input.reviewDueAt) <= new Date())
    throw new RequestError("Choose a future evidence review date.");
  const schema = await migrationIntegrity(db),
    releaseSha = process.env.VERCEL_GIT_COMMIT_SHA || "local";
  const [sender] = await db.query<{ id: string }>(
    "select id from member_senders where active",
  );
  const messagingScope = await messagingCommissioningScope(db);
  return db.transaction(async (tx) => {
    const evidenceId = id();
    await tx.query(
      "insert into commissioning_evidence(id,check_key,state,release_sha,schema_fingerprint,sender_id,evidence_encrypted,owner,actor_id,review_due_at,messaging_scope) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        evidenceId,
        input.checkKey,
        input.state,
        releaseSha,
        schema.fingerprint,
        sender?.id || null,
        encrypt(input.evidence),
        input.owner,
        actor.id,
        input.reviewDueAt,
        messagingScope,
      ],
    );
    await audit(
      tx,
      actor.id,
      null,
      "commissioning_evidence_recorded",
      evidenceId,
      {
        check: input.checkKey,
        state: input.state,
        releaseSha,
        schemaFingerprint: schema.fingerprint,
      },
    );
    return evidenceId;
  });
}
export async function reviewLegacyMigrationBaseline(
  db: DB,
  actor: Actor,
  evidence: string,
) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  if (evidence.trim().length < 30)
    throw new RequestError(
      "Describe the reviewed hosted migration statements and schema comparison.",
    );
  const schema = await migrationIntegrity(db);
  if (
    schema.missing.length ||
    schema.unexpected.length ||
    schema.changed.length
  )
    throw new RequestError(
      "Resolve missing, unexpected or changed migrations before reviewing the legacy baseline.",
    );
  await db.transaction(async (tx) => {
    for (const name of schema.unverified)
      await tx.query(
        "insert into schema_migration_checksums(name,sha256,basis) values($1,$2,'reviewed_baseline') on conflict(name) do nothing",
        [name, schema.expected.find((e) => e.name === name)!.sha256],
      );
    await audit(
      tx,
      actor.id,
      null,
      "migration_baseline_reviewed",
      schema.fingerprint,
      { migrationCount: schema.unverified.length, evidence },
    );
  });
}
export async function recordCallbackHealth(
  db: DB,
  kind: string,
  success: boolean,
  code?: number,
  senderId?: string,
) {
  if (!["inbound", "status"].includes(kind)) return;
  const scope = success
    ? await messagingCommissioningScope(db, senderId)
    : null;
  await db.query(
    `insert into member_callback_health(kind,successful_count,failed_count,last_success_at,last_failure_at,last_failure_code,last_success_scope)
   values($1,case when $2 then 1 else 0 end,case when $2 then 0 else 1 end,case when $2 then now() end,case when not $2 then now() end,case when not $2 then $3 end,$4)
   on conflict(kind) do update set successful_count=member_callback_health.successful_count+excluded.successful_count,failed_count=member_callback_health.failed_count+excluded.failed_count,
   last_success_scope=coalesce(excluded.last_success_scope,member_callback_health.last_success_scope),last_success_at=coalesce(excluded.last_success_at,member_callback_health.last_success_at),last_failure_at=coalesce(excluded.last_failure_at,member_callback_health.last_failure_at),last_failure_code=coalesce(excluded.last_failure_code,member_callback_health.last_failure_code)`,
    [kind, success, code ? `http_${code}` : "processing_failed", scope],
  );
}
export async function releaseReadiness(db: DB) {
  const [
    schema,
    jobs,
    messaging,
    policy,
    evidence,
    callbacks,
    messages,
    support,
    markets,
  ] = await Promise.all([
    migrationIntegrity(db),
    scheduledJobHealth(db),
    memberMessagingReadiness(db),
    privacyPolicy(db),
    db.query<Evidence>(
      "select distinct on(check_key) * from commissioning_evidence order by check_key,sequence desc",
    ),
    db.query<{
      kind: string;
      successful_count: string;
      failed_count: string;
      last_success_at: string | null;
      last_failure_at: string | null;
      last_failure_code: string | null;
      last_success_scope: string | null;
    }>("select * from member_callback_health order by kind"),
    db.query<{ state: string; n: number }>(
      "select state,count(*)::int n from member_messages group by state order by state",
    ),
    db.query<{ open: number; oldest: string | null }>(
      "select count(*)::int open,min(created_at) oldest from member_support_requests where state in ('queued','working')",
    ),
    db.query<{ id: string; name: string; state: string; data_kind: string }>(
      "select id,name,state,data_kind from market_cells order by name",
    ),
  ]);
  const releaseSha = process.env.VERCEL_GIT_COMMIT_SHA || "local";
  const messagingScope = await messagingCommissioningScope(db);
  const [sender] = await db.query<{ id: string }>(
    "select id from member_senders where active",
  );
  const checks = commissioningChecks.map(([key, group, label]) => {
    const saved = evidence.find((e) => e.check_key === key);
    const current =
      !!saved &&
      saved.release_sha === releaseSha &&
      saved.schema_fingerprint === schema.fingerprint &&
      new Date(saved.review_due_at) > new Date() &&
      (group !== "Messaging" ||
        (saved.sender_id === (sender?.id || null) &&
          saved.messaging_scope === messagingScope));
    return {
      key,
      group,
      label,
      state: current ? saved.state : "unverified",
      evidence: saved ? decrypt(saved.evidence_encrypted) : null,
      owner: saved?.owner,
      reviewDueAt: saved?.review_due_at,
      current,
    };
  });
  const expectedJobs = ["membership_prepare", "membership_dispatch"].map(
    (key) => {
      const job = jobs.find((j) => j.job_key === key);
      return {
        key,
        ...job,
        healthy:
          !!job &&
          job.state === "succeeded" &&
          !!job.last_success &&
          Date.now() - new Date(job.last_success).getTime() <
            (key === "membership_prepare" ? 15 : 5) * 60000,
      };
    },
  );
  return {
    releaseSha,
    schema,
    jobs: expectedJobs,
    messaging,
    policy,
    checks,
    callbacks: callbacks.map((callback) => ({
      ...callback,
      current:
        !!callback.last_success_at &&
        callback.last_success_scope === messagingScope &&
        Date.now() - new Date(callback.last_success_at).getTime() <
          7 * 86400000,
    })),
    messages,
    support: support[0],
    markets,
    enrollmentEnabled: process.env.PILOT_ENROLLMENT_ENABLED === "true",
  };
}
export async function assertRealEnrollmentCommissioned(db: DB) {
  const readiness = await releaseReadiness(db);
  const required = readiness.checks.filter(
    (check) =>
      check.key !== "promotion_receipt" || readiness.messaging.promotionEnabled,
  );
  if (
    readiness.releaseSha === "local" ||
    !readiness.schema.matches ||
    required.some((check) => check.state !== "verified") ||
    readiness.jobs.some((job) => !job.healthy) ||
    !readiness.messaging.accessReady ||
    !readiness.policy ||
    new Date(readiness.policy.review_due_at) <= new Date() ||
    (process.env.PRIVACY_SUPPRESSION_KEY?.length || 0) < 32 ||
    process.env.OPERATOR_MFA_REQUIRED !== "true" ||
    ["inbound", "status"].some(
      (kind) =>
        !readiness.callbacks.some(
          (callback) => callback.kind === kind && callback.current,
        ),
    )
  )
    throw new RequestError(
      "Real enrollment is waiting for verified release, account, messaging and support commissioning.",
      503,
    );
}
