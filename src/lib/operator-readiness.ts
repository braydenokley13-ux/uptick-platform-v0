/* The readiness model.

   One truth used by two surfaces: the compact strip on the command centre and
   the full dependency map. Readiness is expressed as seven gates with explicit
   dependencies, because "can we open enrollment?" is a question about a graph,
   not a checklist — enrollment is blocked by messaging, which is blocked by the
   database matching the release, and so on.

   For every gate we carry the five things an operator needs to act:
     blocker      — the specific thing that is not true yet
     consequence  — what stays broken while it is not true
     owner        — who can change it
     action       — the exact next step
     evidence     — what proved it, and when that proof expires

   Nothing here is scored or averaged. A gate is `ready`, `blocked`, `pending`
   (work is legitimately in flight) or `closed` (deliberately held shut). */
import type { DB } from "./db";
import { enrollmentBlockers, releaseReadiness } from "./release-readiness";
import type { Tone } from "@/components/system";

export type GateKey =
  | "software"
  | "database"
  | "identity"
  | "messaging"
  | "market"
  | "operations"
  | "support"
  | "enrollment";

export type Gate = {
  key: GateKey;
  label: string;
  state: "ready" | "pending" | "blocked" | "closed";
  /** The specific untrue thing, or what is true when ready. */
  blocker: string;
  consequence: string;
  owner: string;
  action: string;
  evidence: string | null;
  expiresAt: string | null;
  /** Gates that must be ready before this one can be. */
  dependsOn: GateKey[];
  href?: string;
};

export const gateTone: Record<Gate["state"], Tone> = {
  ready: "ok",
  pending: "warn",
  blocked: "bad",
  closed: "idle",
};

const GATE_LABEL: Record<GateKey, string> = {
  software: "Software",
  database: "Database",
  identity: "Hosted identity",
  messaging: "Messaging",
  market: "Market Cell",
  operations: "Operations",
  support: "Support",
  enrollment: "Real enrollment",
};

function ago(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours}h ago`;
  return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
}

export async function readinessGates(db: DB): Promise<Gate[]> {
  const readiness = await releaseReadiness(db);
  /* The same list the server gate enforces. Gates are reconciled against it
     below so the map cannot show green where enrollment would be refused. */
  const blockers = enrollmentBlockers(readiness);
  const schema = readiness.schema;
  const group = (name: string) =>
    readiness.checks.filter((c) => c.group === name);
  const firstUnverified = (name: string) =>
    group(name).find((c) => c.state !== "verified");

  /* --- Software ---------------------------------------------------------- */
  const ci = readiness.checks.find((c) => c.key === "ci_build");
  const software: Gate = {
    key: "software",
    label: GATE_LABEL.software,
    state:
      readiness.releaseSha === "local"
        ? "pending"
        : ci?.state === "verified"
          ? "ready"
          : "blocked",
    blocker:
      readiness.releaseSha === "local"
        ? "Running from a local build, so there is no release commit to attest."
        : ci?.state === "verified"
          ? `CI and build attested for ${readiness.releaseSha.slice(0, 7)}.`
          : "No CI and build evidence recorded for the deployed commit.",
    consequence:
      "Without an attested release, no other evidence can be tied to known code.",
    owner: "Release engineer",
    action:
      readiness.releaseSha === "local"
        ? "Deploy the candidate, then record CI evidence against its commit."
        : "Record CI and build evidence for this commit in Settings.",
    evidence: ci?.evidence ?? null,
    expiresAt: ci?.reviewDueAt ?? null,
    dependsOn: [],
    href: "/operator/pilot/settings",
  };

  /* --- Database ----------------------------------------------------------
     The migration ledger is the single most load-bearing fact here: source
     ahead of the hosted schema is exactly how a missing table reaches a member. */
  const missing = schema.missing.length;
  const database: Gate = {
    key: "database",
    label: GATE_LABEL.database,
    state: schema.matches ? "ready" : missing ? "blocked" : "pending",
    blocker: schema.matches
      ? `All ${schema.expected.length} migrations applied and checksum-matched.`
      : missing
        ? `${missing} migration${missing === 1 ? "" : "s"} in this release ${missing === 1 ? "is" : "are"} not applied to the connected database (${schema.missing[0]}${missing > 1 ? ` … ${schema.missing[missing - 1]}` : ""}).`
        : schema.changed.length
          ? `${schema.changed.length} applied migration(s) no longer match their recorded checksum.`
          : `${schema.unverified.length} applied migration(s) have no reviewed checksum.`,
    consequence: missing
      ? "Normal routes that touch the new tables fail at runtime with a missing-relation error."
      : schema.changed.length
        ? "The deployed code and the stored schema may disagree in ways tests cannot see."
        : "Schema provenance cannot be proved for this release.",
    owner: "Deployment owner",
    action: missing
      ? "Run the forward migrations against the hosted database, then re-check."
      : schema.changed.length
        ? "Investigate the changed migration; never rewrite an applied file."
        : "Review the legacy baseline and record its checksums.",
    evidence: `Ledger fingerprint ${schema.fingerprint.slice(0, 12)}`,
    expiresAt: null,
    dependsOn: ["software"],
    href: "/operator/pilot/settings",
  };

  /* --- Hosted identity ---------------------------------------------------- */
  const identityCheck = firstUnverified("Hosted commissioning");
  const identityDone = group("Hosted commissioning").filter(
    (c) => c.state === "verified",
  ).length;
  const identityTotal = group("Hosted commissioning").length;
  const identity: Gate = {
    key: "identity",
    label: GATE_LABEL.identity,
    state: identityCheck ? "blocked" : "ready",
    blocker: identityCheck
      ? `${identityDone} of ${identityTotal} hosted checks verified. Outstanding: ${identityCheck.label}.`
      : `All ${identityTotal} hosted account journeys verified.`,
    consequence:
      "Operators or merchants could be locked out, or a lost factor could not be recovered.",
    owner: "Operator owner",
    action: identityCheck
      ? `Complete and record: ${identityCheck.label}.`
      : "Re-verify before each evidence review date.",
    evidence: identityCheck?.evidence ?? null,
    expiresAt: identityCheck?.reviewDueAt ?? null,
    dependsOn: ["software", "database"],
    href: "/operator/pilot/settings",
  };

  /* --- Messaging ---------------------------------------------------------- */
  const messagingCheck = firstUnverified("Messaging");
  const inbound = readiness.callbacks.find((c) => c.kind === "inbound");
  const status = readiness.callbacks.find((c) => c.kind === "status");
  const callbacksCurrent = !!inbound?.current && !!status?.current;
  const messaging: Gate = {
    key: "messaging",
    label: GATE_LABEL.messaging,
    state: messagingCheck || !callbacksCurrent ? "blocked" : "ready",
    blocker: messagingCheck
      ? `Provider commissioning incomplete. Outstanding: ${messagingCheck.label}.`
      : !callbacksCurrent
        ? `Signed ${!inbound?.current ? "inbound" : "status"} callbacks have not succeeded for this sender and release.`
        : "Brand, Campaign, sender and both signed callbacks verified.",
    consequence:
      "Members cannot be sent access links, and STOP or HELP replies may not be honoured.",
    owner: "Messaging lead",
    action: messagingCheck
      ? `Complete and record: ${messagingCheck.label}.`
      : !callbacksCurrent
        ? "Send one commissioning message and confirm both webhooks return signed success."
        : "Keep evidence inside its review window.",
    evidence: inbound?.last_success_at
      ? `Last signed inbound ${ago(inbound.last_success_at)}`
      : (messagingCheck?.evidence ?? null),
    expiresAt: messagingCheck?.reviewDueAt ?? null,
    dependsOn: ["software", "database"],
    href: "/operator/network/messaging",
  };

  /* --- Market Cell -------------------------------------------------------- */
  /* `state` is a free operator-set text column, so "pilot" is a statement of
     intent. A cell is only ready when something is actually behind it: four
     distinct backed weeks, approved supply, an approved fallback and a
     destination rehearsed within its validity window. Reading `state` alone
     let a cell with no supply at all report the gate green. */
  const realMarkets = readiness.markets.filter((m) => m.data_kind === "real");
  const backed = realMarkets.filter(
    (m) =>
      m.state === "pilot" &&
      m.backed_weeks >= 4 &&
      m.approved_supplies > 0 &&
      m.approved_fallbacks > 0 &&
      m.ready_destinations > 0,
  );
  const intended = realMarkets.filter((m) => m.state === "pilot");
  const shortfall = (m: (typeof realMarkets)[number]) =>
    [
      m.backed_weeks < 4 ? `${m.backed_weeks}/4 weeks backed` : null,
      m.approved_supplies ? null : "no approved supply",
      m.approved_fallbacks ? null : "no approved fallback",
      m.ready_destinations ? null : "no destination rehearsed and in date",
    ]
      .filter(Boolean)
      .join(", ");
  const market: Gate = {
    key: "market",
    label: GATE_LABEL.market,
    state: backed.length ? "ready" : realMarkets.length ? "pending" : "blocked",
    blocker: backed.length
      ? `${backed.length} real Market Cell(s) with four backed weeks, approved supply, fallback and a rehearsed destination.`
      : intended.length
        ? `${intended.map((m) => `${m.name}: ${shortfall(m)}`).join("; ")}.`
        : realMarkets.length
          ? `${realMarkets.length} real Market Cell(s) recorded but none in pilot state.`
          : "No real Market Cell exists yet. Only test classifications are present.",
    consequence:
      "There is no real neighbourhood, destination or four-week supply to admit anyone into.",
    owner: "Operator owner",
    action: realMarkets.length
      ? "Confirm destinations, four-week supply and fallback, then move the cell to pilot."
      : "Create the real Market Cell, its locations and its approved supply.",
    evidence: realMarkets.length
      ? realMarkets.map((m) => m.name).join(", ")
      : null,
    expiresAt: null,
    dependsOn: ["database"],
    href: "/operator/network/markets",
  };

  /* --- Support ------------------------------------------------------------ */
  const supportCheck = readiness.checks.find(
    (c) => c.key === "support_coverage",
  );
  const openSupport = readiness.support?.open ?? 0;
  const oldest = readiness.support?.oldest ?? null;
  const stale =
    !!oldest && Date.now() - new Date(oldest).getTime() > 24 * 3600 * 1000;
  const support: Gate = {
    key: "support",
    label: GATE_LABEL.support,
    state:
      supportCheck?.state === "verified"
        ? stale
          ? "pending"
          : "ready"
        : "blocked",
    blocker:
      supportCheck?.state === "verified"
        ? stale
          ? `Oldest open request has been waiting since ${ago(oldest)}.`
          : `Coverage verified. ${openSupport} request(s) open.`
        : "Primary and backup support coverage is not verified.",
    consequence:
      "A member who cannot access their benefit has no one accountable to reach.",
    owner: "Support owner",
    action:
      supportCheck?.state === "verified"
        ? stale
          ? "Work the oldest open request or reassign it to the backup owner."
          : "Keep the tested contact path current."
        : "Record primary and backup owners and prove the contact path works.",
    evidence: supportCheck?.evidence ?? null,
    expiresAt: supportCheck?.reviewDueAt ?? null,
    dependsOn: ["identity"],
    href: "/operator/pilot/support",
  };

  /* --- Operations --------------------------------------------------------- */
  /* Scheduler health and the privacy prerequisites are enforced by the server
     gate but had no gate of their own, so the map could show everything green
     while enrollment was refused for a stopped cron job or a lapsed policy. */
  const operationsBlockers = blockers.filter((b) => b.gate === "operations");
  const operations: Gate = {
    key: "operations",
    label: GATE_LABEL.operations,
    state: operationsBlockers.length ? "blocked" : "ready",
    blocker: operationsBlockers.length
      ? operationsBlockers.map((b) => b.detail).join(" ")
      : "Scheduled jobs are within their freshness windows and privacy settings are current.",
    consequence:
      "Weekly releases, suppression reconciliation and retention reviews stop running, and erasure requests cannot be honoured.",
    owner: "Operator owner",
    action: operationsBlockers.length
      ? "Restore the scheduler and the privacy settings named above."
      : "Keep the scheduler and the privacy review current.",
    evidence: `${readiness.jobs.filter((j) => j.healthy).length}/${readiness.jobs.length} scheduled jobs healthy.`,
    expiresAt: readiness.policy?.review_due_at ?? null,
    dependsOn: ["database"],
    href: "/operator/pilot/settings",
  };

  /* --- Reconcile every gate with what the server actually enforces --------- */
  /* One list decides both surfaces. Any gate carrying an unmet server
     condition is forced to `blocked` here, so a green map and a refusing
     server cannot disagree — which is exactly what happened when the map
     encoded four of the nine conditions and said "Nothing technical is
     blocking it". */
  const reconcile = (gate: Gate) => {
    const mine = blockers.filter((b) => b.gate === gate.key);
    if (!mine.length || gate.state === "blocked") return gate;
    return {
      ...gate,
      state: "blocked" as const,
      blocker: mine.map((b) => b.detail).join(" "),
    };
  };

  /* --- Real enrollment ---------------------------------------------------- */
  const upstream = [
    software,
    database,
    identity,
    messaging,
    market,
    operations,
    support,
  ].map(reconcile);
  const blocking = upstream.filter((g) => g.state !== "ready");
  const enrollment: Gate = {
    key: "enrollment",
    label: GATE_LABEL.enrollment,
    state: readiness.enrollmentEnabled
      ? blocking.length
        ? "blocked"
        : "ready"
      : "closed",
    blocker: readiness.enrollmentEnabled
      ? blocking.length
        ? `Blocked by ${blocking.map((g) => g.label.toLowerCase()).join(", ")}.`
        : "Every upstream gate is verified."
      : `Deliberately closed. ${blocking.length ? `${blocking.length} upstream gate(s) still open.` : "All upstream gates are verified."}`,
    consequence: readiness.enrollmentEnabled
      ? "Real people could join a pilot that cannot serve them."
      : "No member of the public can join. This is the intended state until launch is approved.",
    owner: "Founder",
    action: blocking.length
      ? `Clear ${blocking[0].label.toLowerCase()} first: ${blocking[0].action}`
      : "All gates are clear. Opening enrollment is an explicit, separate decision.",
    evidence: null,
    expiresAt: null,
    dependsOn: [
      "software",
      "database",
      "identity",
      "messaging",
      "market",
      "operations",
      "support",
    ],
  };

  return [...upstream, enrollment];
}

/** The compact strip on the command centre. */
export async function operatorReadinessRows(db: DB) {
  try {
    const gates = await readinessGates(db);
    return gates.map((g) => ({
      key: g.key,
      label: g.label,
      tone: gateTone[g.state],
      why: g.blocker,
      href: g.href,
    }));
  } catch {
    // Readiness must never take the operator's home screen down with it.
    return [
      {
        key: "software",
        label: "Readiness",
        tone: "bad" as Tone,
        why: "Readiness could not be read. Open Settings for the underlying error.",
        href: "/operator/pilot/settings",
      },
    ];
  }
}
