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
import {
  pilotBacking,
  type PilotRun,
  type PilotWeekBacking,
} from "./pilot-operations";

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
/** A Market Cell, and the proof — or the absence of one — that the cohort it
    intends to admit is actually backed in every week it still has to serve. */
export type MarketReadiness = {
  id: string;
  name: string;
  state: string;
  data_kind: string;
  /** Every run this cell is currently obligated by — enrolling, live or
      paused — each with its own four-week proof. Plural because proving one of
      them says nothing about the others. */
  runs: {
    id: string;
    name: string;
    state: string;
    cohortFrozen: boolean;
    weeks: PilotWeekBacking[];
    required: number;
    backed: boolean;
    evidence: string;
  }[];
  /** The weeks of the run a member joining today would land in, for display. */
  weeks: PilotWeekBacking[];
  required: number;
  /** True only when every week the run still has to serve covers the cohort. */
  backed: boolean;
  /** The specific sentence: "Week 3: 142 usable units backed for 150 required." */
  evidence: string;
  /** Why capacity may be zero. Diagnostics, never the proof itself. */
  approvedSupplies: number;
  approvedFallbacks: number;
  readyDestinations: number;
};

/* Whether each Market Cell can actually serve the cohort it intends to admit.

   A Market Cell's `state` is a free operator-set text column, so "pilot" is a
   statement of intent, not evidence. Counting rows is barely better: four weeks
   that each hold *a* commitment, one approved supply and one rehearsed
   destination are all satisfied by a single unit per week, which would let a
   200-member pilot read as ready while backing two people a month.

   So this proves it the only way it can be proved — per week, comparing the
   cohort that week owes against the usable eligible committed capacity behind
   it, through `pilotBacking`: the same function the run-state gate uses and the
   same `pilotCapacity` engine admission and release use. */
export async function marketReadiness(db: DB): Promise<MarketReadiness[]> {
  const cells = await db.query<{
    id: string;
    name: string;
    state: string;
    data_kind: string;
    approved_supplies: number;
    approved_fallbacks: number;
    ready_destinations: number;
  }>(
    `select k.id,k.name,k.state,k.data_kind,
            (select count(*)::int
               from pilot_runs r join effective_pilot_week_supplies p on p.run_id=r.id
               join network_drop_supplies s on s.id=p.supply_id
              where r.market_id=k.id and r.state<>'complete' and s.state='approved') approved_supplies,
            (select count(*)::int
               from pilot_runs r join effective_pilot_week_supplies p on p.run_id=r.id
               join pilot_supply_fallbacks f on f.supply_id=p.supply_id and f.state='approved'
              where r.market_id=k.id and r.state<>'complete') approved_fallbacks,
            (select count(*)::int
               from pilot_runs r join effective_pilot_week_supplies p on p.run_id=r.id
               join destination_readiness d on d.supply_id=p.supply_id
              where r.market_id=k.id and r.state<>'complete'
                and d.state='ready' and d.valid_until>now()) ready_destinations
       from market_cells k order by k.name`,
  );
  /* Every run this cell is obligated by, not one chosen from among them.

     A draft run promises nothing yet and a complete one is finished, but an
     enrolling, live or paused run is an obligation to real people, and proving
     one of them says nothing about the rest. Which one to prove was a live
     question in its own right: `tryAdmitMemberInTransaction` sends a new member
     to the *enrolling* run specifically, so a gate that happened to read a
     different run could stay green while the run actually accepting members
     lost its backing. Evaluating all of them removes the question. */
  const runs = await db.query<PilotRun>(
    `select r.*,r.starts_on::text starts_on,r.ends_on::text ends_on,m.timezone
       from pilot_runs r join market_cells m on m.id=r.market_id
      where r.state in ('enrolling','live','paused')
      order by r.market_id,
               case r.state when 'enrolling' then 0 when 'live' then 1 else 2 end,
               r.starts_on`,
  );
  const named = (
    proofs: { name: string; evidence: string }[],
    subset: { name: string; evidence: string }[],
  ) =>
    subset
      .map((proof) =>
        proofs.length > 1 ? `${proof.name}: ${proof.evidence}` : proof.evidence,
      )
      .join(" ");
  return Promise.all(
    cells.map(async (cell) => {
      const proofs = await Promise.all(
        runs
          .filter((run) => run.market_id === cell.id)
          .map(async (run) => {
            const backing = await pilotBacking(db, run);
            return {
              id: run.id,
              name: run.name,
              state: run.state,
              cohortFrozen: !!run.cohort_frozen_at,
              weeks: backing.weeks,
              required: backing.required,
              backed: backing.weeks.length === 4 && !backing.short,
              evidence: backing.evidence,
            };
          }),
      );
      /* Enrolling first, so the weeks on display belong to the run a member
         joining today would land in. The gate still needs every run to hold. */
      const admitting = proofs[0] ?? null;
      const unbacked = proofs.filter((proof) => !proof.backed);
      return {
        id: cell.id,
        name: cell.name,
        state: cell.state,
        data_kind: cell.data_kind,
        runs: proofs,
        weeks: admitting?.weeks ?? [],
        required: admitting?.required ?? 0,
        backed: proofs.length > 0 && !unbacked.length,
        evidence: !proofs.length
          ? "No pilot run is enrolling, live or paused in this Market Cell, so no week is backed."
          : named(proofs, unbacked.length ? unbacked : proofs),
        approvedSupplies: cell.approved_supplies,
        approvedFallbacks: cell.approved_fallbacks,
        readyDestinations: cell.ready_destinations,
      };
    }),
  );
}

/** Whether a signed provider callback has genuinely been observed for the
    configuration in front of us. One definition, because the readiness gate and
    the messaging console were each deciding it separately and could disagree
    about whether STOP and HELP are being received. */
export function callbackIsCurrent(
  callback: {
    last_success_at: string | null;
    last_success_scope: string | null;
  },
  messagingScope: string,
) {
  return (
    !!callback.last_success_at &&
    callback.last_success_scope === messagingScope &&
    Date.now() - new Date(callback.last_success_at).getTime() < 7 * 86400000
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
    marketReadiness(db),
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
      current: callbackIsCurrent(callback, messagingScope),
    })),
    messages,
    support: support[0],
    markets,
    enrollmentEnabled: process.env.PILOT_ENROLLMENT_ENABLED === "true",
  };
}
/** Which readiness gate an enrollment blocker belongs to. Keep in step with
    `GateKey` in operator-readiness.ts — the map renders one gate per value. */
export type BlockerGate =
  | "software"
  | "database"
  | "identity"
  | "messaging"
  | "market"
  | "support"
  | "operations";

export type EnrollmentBlocker = {
  key: string;
  gate: BlockerGate;
  detail: string;
};

/* The conditions real enrollment is actually gated on — the single list.

   This used to be a boolean expression inside the server assert, while the
   operator's readiness map derived its own answer from the same underlying
   data. The two drifted: of the nine conditions enforced here, the seven
   visual gates encoded four, so the map could show every gate green and read
   "Nothing technical is blocking it" while the server refused to enrol anyone.

   Both surfaces now read this function, so a gate cannot be green unless the
   thing it stands for is genuinely not blocking. */
export function enrollmentBlockers(
  readiness: Awaited<ReturnType<typeof releaseReadiness>>,
): EnrollmentBlocker[] {
  const blockers: EnrollmentBlocker[] = [];
  const add = (key: string, gate: BlockerGate, detail: string) =>
    blockers.push({ key, gate, detail });

  if (readiness.releaseSha === "local")
    add(
      "release_sha",
      "software",
      "Running from a local build, so no evidence can be tied to a known commit.",
    );
  if (!readiness.schema.matches)
    add(
      "schema",
      "database",
      "The connected database does not carry exactly the migrations in this release.",
    );
  for (const check of readiness.checks)
    if (
      check.state !== "verified" &&
      (check.key !== "promotion_receipt" ||
        readiness.messaging.promotionEnabled)
    )
      add(
        `evidence:${check.key}`,
        /* `support_coverage` is filed under the Operations group but is what
           the Support gate stands for, so it is routed by key. */
        check.key === "support_coverage"
          ? "support"
          : check.group === "Hosted commissioning"
            ? "identity"
            : check.group === "Messaging"
              ? "messaging"
              : check.group === "Software"
                ? "software"
                : "operations",
        `Commissioning evidence "${check.label}" is ${check.state}.`,
      );
  for (const job of readiness.jobs)
    if (!job.healthy)
      add(
        `job:${job.key}`,
        "operations",
        `Scheduled job "${job.key}" is not running within its freshness window.`,
      );
  if (!readiness.messaging.accessReady)
    add(
      "access_messaging",
      "messaging",
      "Requested-access messaging is not ready, so an admitted member could not be given a way in.",
    );
  if (!readiness.policy)
    add(
      "privacy_policy",
      "operations",
      "No privacy policy version is recorded.",
    );
  else if (new Date(readiness.policy.review_due_at) <= new Date())
    add(
      "privacy_policy_review",
      "operations",
      "The recorded privacy policy is past its review date.",
    );
  if ((process.env.PRIVACY_SUPPRESSION_KEY?.length || 0) < 32)
    add(
      "suppression_key",
      "operations",
      "PRIVACY_SUPPRESSION_KEY is missing or too short, so erasure do-not-contact cannot be honoured.",
    );
  if (process.env.OPERATOR_MFA_REQUIRED !== "true")
    add(
      "operator_mfa",
      "identity",
      "Operator multi-factor authentication is not required.",
    );
  /* The Market Cell condition. This used not to exist here at all: the
     readiness map drew a Market Cell gate that the server never enforced, so a
     cell with nothing behind it blocked nothing. A cohort that cannot be served
     is exactly what enrollment must not step past, and the proof is the same
     per-week one the gate renders. */
  const pilotCells = readiness.markets.filter(
    (m) => m.data_kind === "real" && m.state === "pilot",
  );
  if (!pilotCells.length)
    add(
      "market_cell",
      "market",
      "No real Market Cell is in pilot state, so there is nowhere to admit anyone.",
    );
  else
    /* Every cell in pilot state, not "at least one of them". A member's home ZIP
       decides which cell they land in, so one backed neighbourhood does not
       make a second one able to serve anybody. */
    for (const cell of pilotCells.filter((m) => !m.backed))
      add(
        `market_backing:${cell.id}`,
        "market",
        `${cell.name} cannot back its cohort in every week it must serve. ${cell.evidence}`,
      );
  for (const kind of ["inbound", "status"])
    if (
      !readiness.callbacks.some(
        (callback) => callback.kind === kind && callback.current,
      )
    )
      add(
        `callback:${kind}`,
        "messaging",
        `No current signed ${kind} callback has been observed.`,
      );
  return blockers;
}

export async function assertRealEnrollmentCommissioned(db: DB) {
  /* The switch itself. `setPilotState` refused a real run without it, but the
     admission path did not, so the readiness map could read "deliberately
     closed" while a real member was being admitted through another door. */
  if (process.env.PILOT_ENROLLMENT_ENABLED !== "true")
    throw new RequestError(
      "Real enrollment is waiting for verified release, account, messaging and support commissioning.",
      503,
    );
  const readiness = await releaseReadiness(db);
  /* The reason stays generic: this also guards the public signup path, and an
     unauthenticated caller should not be handed a list of what is unfinished.
     Operators get the detail through the readiness map. */
  if (enrollmentBlockers(readiness).length)
    throw new RequestError(
      "Real enrollment is waiting for verified release, account, messaging and support commissioning.",
      503,
    );
}
