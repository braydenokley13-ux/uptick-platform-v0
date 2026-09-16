import { z } from "zod";
import type { DB } from "./db";
import { audit, type Actor } from "./domain";
import { id } from "./security";
import { RequestError } from "./http";
import { marketWeekWindow, supplyUsage } from "./network";
import {
  memberServiceStatus,
  operationalPilotAudience,
} from "./member-service";

export const dataKinds = ["real", "internal", "demo", "synthetic"] as const;
export type PilotRun = {
  id: string;
  market_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  state: string;
  cohort_frozen_at: string | null;
  data_kind: string;
  target_members: number;
  hard_cap: number;
  paid_load_guidance: string;
  operator_owner: string;
  support_owner: string;
  backup_support_owner: string;
  budget: string;
  checklist: Record<string, boolean>;
  release_sha: string;
  timezone?: string;
};
const text = z.string().trim().min(1).max(1000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)), "Choose a valid date.");
const money = z.coerce
  .number()
  .finite()
  .nonnegative()
  .max(1_000_000)
  .multipleOf(0.01);
export function requirePilotOperator(actor: Actor) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
}
export function pilotWeeks(run: Pick<PilotRun, "starts_on">) {
  const start = new Date(run.starts_on).toISOString().slice(0, 10);
  return [0, 7, 14, 21].map((days) =>
    new Date(Date.parse(`${start}T12:00:00Z`) + days * 86400000)
      .toISOString()
      .slice(0, 10),
  );
}
export async function loadPilotRun(db: DB, runId: string, lock = false) {
  const [run] = await db.query<PilotRun>(
    `select r.*,r.starts_on::text starts_on,r.ends_on::text ends_on,m.timezone from pilot_runs r join market_cells m on m.id=r.market_id where r.id=$1${lock ? " for update of r" : ""}`,
    [runId],
  );
  if (!run) throw new RequestError("Choose an existing pilot run.", 404);
  return run;
}
export async function createPilotRun(db: DB, actor: Actor, raw: unknown) {
  requirePilotOperator(actor);
  const d = z
    .object({
      marketId: text,
      name: text,
      startsOn: date,
      dataKind: z.enum(dataKinds),
      targetMembers: z.coerce.number().int().min(1).max(200).default(150),
      hardCap: z.coerce.number().int().min(1).max(200).default(200),
      paidLoadGuidance: z.coerce.number().min(0).max(1).default(0.6),
      operatorOwner: text,
      supportOwner: text,
      backupSupportOwner: text,
      budget: money,
    })
    .parse(raw);
  if (
    d.hardCap < d.targetMembers ||
    new Date(`${d.startsOn}T12:00:00Z`).getUTCDay() !== 1
  )
    throw new RequestError(
      "Start on a Monday and keep the target within the hard cap.",
    );
  return db.transaction(async (tx) => {
    const [market] = await tx.query<{ data_kind: string }>(
      "select data_kind from market_cells where id=$1 for update",
      [d.marketId],
    );
    if (!market || market.data_kind !== d.dataKind)
      throw new RequestError(
        "The Market Cell and pilot must have the same real/test classification.",
      );
    const [overlap] = await tx.query(
      "select id from pilot_runs where market_id=$1 and data_kind=$2 and starts_on<$3::date+28 and ends_on>$3::date and state<>'complete'",
      [d.marketId, d.dataKind, d.startsOn],
    );
    if (overlap)
      throw new RequestError(
        "This Market Cell already has an overlapping pilot run.",
      );
    const runId = id();
    await tx.query(
      "insert into pilot_runs(id,market_id,name,starts_on,ends_on,data_kind,target_members,hard_cap,paid_load_guidance,operator_owner,support_owner,backup_support_owner,budget,created_by) values($1,$2,$3,$4,$4::date+28,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        runId,
        d.marketId,
        d.name,
        d.startsOn,
        d.dataKind,
        d.targetMembers,
        d.hardCap,
        d.paidLoadGuidance,
        d.operatorOwner,
        d.supportOwner,
        d.backupSupportOwner,
        d.budget,
        actor.id,
      ],
    );
    await audit(tx, actor.id, null, "pilot.created", runId, {
      marketId: d.marketId,
      dataKind: d.dataKind,
    });
    return runId;
  });
}
export async function commitPilotSupply(db: DB, actor: Actor, raw: unknown) {
  requirePilotOperator(actor);
  const d = z
    .object({
      runId: text,
      weekKey: date,
      supplyId: text,
      quantity: z.coerce.number().int().positive().max(200),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const run = await loadPilotRun(tx, d.runId, true);
    if (
      !["draft", "enrolling"].includes(run.state) ||
      !pilotWeeks(run).includes(d.weekKey)
    )
      throw new RequestError(
        "Choose one of the four weeks of a pilot accepting commitments.",
      );
    const [s] = await tx.query<{
      market_id: string;
      state: string;
      starts_at: string;
      expires_at: string;
      data_kind: string;
    }>(
      "select s.*,t.data_kind from network_drop_supplies s join pilot_supply_terms t on t.supply_id=s.id where s.id=$1 for update of s",
      [d.supplyId],
    );
    if (
      !s ||
      s.market_id !== run.market_id ||
      s.data_kind !== run.data_kind ||
      s.state !== "approved"
    )
      throw new RequestError(
        "Choose approved supply from this Market Cell and data classification.",
      );
    const window = marketWeekWindow(
      new Date(`${d.weekKey}T12:00:00Z`),
      run.timezone!,
    );
    if (
      new Date(s.starts_at) > window.start ||
      new Date(s.expires_at) < window.end
    )
      throw new RequestError(
        "The supply must cover this complete pilot week. Published usable hours still apply.",
      );
    const usage = await supplyUsage(tx, d.supplyId);
    if (usage.remaining === null || usage.remaining < d.quantity)
      throw new RequestError(
        "Confirm finite, uncommitted stock for the requested quantity.",
      );
    await tx.query(
      "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,$4,$5)",
      [d.runId, d.weekKey, d.supplyId, d.quantity, actor.id],
    );
    await audit(tx, actor.id, null, "pilot.supply_committed", d.runId, {
      week: d.weekKey,
      supplyId: d.supplyId,
      quantity: d.quantity,
    });
  });
}
/** A single named blocker. `text` is the whole truth of it; the category and
    urgency only decide where it is shown and how loudly. */
export type PilotConstraint = {
  category:
    | "Supply"
    | "Destinations"
    | "Incidents"
    | "Messaging"
    | "Partners"
    | "Readiness"
    | "Scheduler";
  urgency: "bad" | "warn";
  text: string;
  href?: string;
};
export const constraintOrder: PilotConstraint["urgency"][] = ["bad", "warn"];

/* How many members a week's supply has to back.

   Before the cohort is frozen the run is still admitting, so the requirement is
   the intention, not the current headcount: a 150-member pilot with five people
   admitted still needs 150 backed, or every week looks healthy right up until
   the moment it is not. Once the cohort is frozen the intention stops mattering
   and the fixed admitted number is the whole obligation.

   This is the rule pilot-supply-amendments.ts already enforced when accepting a
   replacement supply. It lives here so the amendment path, the command centre
   and the readiness gate cannot drift apart on what "backed" means. */
export async function requiredCohort(db: DB, run: PilotRun) {
  /* The operational audience, not the raw admission count. A withdrawn or
     suspended member is not owed a benefit — `releaseWeeklyBenefits` refuses a
     release that does not match this exact set — so counting them would demand
     backing for people the week will never serve. */
  const { included } = await operationalPilotAudience(db, run.id);
  return run.cohort_frozen_at
    ? included.length
    : Math.max(included.length, run.target_members);
}

export type PilotWeekBacking = {
  week: string;
  /** 1 to 4. */
  index: number;
  /** Usable, eligible, committed units for this week, from pilotCapacity. */
  usable: number;
  /** Members this week has to back. */
  required: number;
  released: boolean;
  /** True when the run still has to serve this week, so it still has to be
      backed. A released week is history; a week already behind a frozen run
      can no longer be served. */
  outstanding: boolean;
  /** How far short this week falls, floored at zero. */
  short: number;
};

/* Whether a run is actually backed, week by week.

   One function, because everything that asks "is this backed?" has to get the
   same answer: the run-state gate, the readiness map, and the operator's
   command centre. Asking it three ways is how a Market Cell shows a green
   readiness gate while the run it belongs to cannot be taken live.

   It proves the claim per week. An aggregate — total supplies, total committed
   units, how many weeks have any commitment at all — cannot: a 200-member
   cohort with one committed unit in each of four weeks satisfies every
   aggregate and backs nobody. */
export async function pilotBacking(
  db: DB,
  run: PilotRun,
  capacity?: Awaited<ReturnType<typeof pilotCapacity>>,
) {
  const plan = capacity ?? (await pilotCapacity(db, run));
  const required = await requiredCohort(db, run);
  const published = await db.query<{ week_key: string }>(
    "select week_key from weekly_releases where run_id=$1",
    [run.id],
  );
  const currentWeek = run.timezone
    ? marketWeekWindow(new Date(), run.timezone).weekKey
    : new Date().toISOString().slice(0, 10);
  const weeks: PilotWeekBacking[] = pilotWeeks(run).map((week, index) => {
    const usable = plan.weeks.find((w) => w.week === week)?.capacity ?? 0;
    const released = published.some((p) => p.week_key === week);
    return {
      week,
      index: index + 1,
      usable,
      required,
      released,
      outstanding:
        !released && (run.cohort_frozen_at ? week >= currentWeek : true),
      short: Math.max(0, required - usable),
    };
  });
  const outstanding = weeks.filter((w) => w.outstanding);
  /* A run with nothing left to serve is not short of anything. */
  const available = outstanding.length
    ? Math.min(...outstanding.map((w) => w.usable))
    : required;
  const worst = outstanding
    .filter((w) => w.short > 0)
    .sort((a, b) => b.short - a.short || a.index - b.index)[0];
  return {
    capacity: plan,
    required,
    weeks,
    outstanding,
    available,
    short: Math.max(0, required - available),
    /* The sentence an operator can act on, naming the week and both numbers. */
    evidence: worst
      ? `Week ${worst.index}: ${worst.usable} usable units backed for ${worst.required} required.`
      : weeks.length
        ? `All four weeks back the ${required} members required.`
        : "This run has no weeks planned.",
  };
}

export async function pilotCapacity(
  db: DB,
  run: PilotRun,
  options: { reviewingCommercial?: boolean } = {},
) {
  const plans = await db.query<{
    week_key: string;
    supply_id: string;
    committed_quantity: number;
    inventory: number;
    competing: number;
    eligible: boolean;
    fallback_available: number;
    commercial: boolean;
    own_issued: number;
  }>(
    `select p.week_key,p.supply_id,p.committed_quantity,
      coalesce(s.quantity,0)+(select coalesce(sum(delta),0)::int from supply_adjustments where supply_id=s.id) inventory,
      exists(select 1 from program_supply_links pl where pl.supply_id=s.id) commercial,
      greatest(0,coalesce(f.usable_capacity,0)-(select count(*)::int from recovery_grants rg where rg.fallback_id=f.id and (rg.state='redeemed' or (rg.superseded_at is null and rg.expires_at>now())))) fallback_available,
      (s.state='approved' and s.inventory_policy<>'unlimited' and s.data_kind=$2 and t.data_kind=$2 and s.market_id=$3
       and t.required_spend=0 and t.member_fee=0 and t.fulfiller_organization_id=s.organization_id
       and s.starts_at <= (p.week_key::date::timestamp at time zone m.timezone)
       and s.expires_at >= ((p.week_key::date+7)::timestamp at time zone m.timezone)
       and d.state='ready' and length(trim(d.owner_approved_by))>0
       and length(trim(d.primary_manager))>0 and length(trim(d.primary_contact))>0 and length(trim(d.backup_contact))>0
       and d.stock_confirmed_at<=now() and d.stock_confirmed_at>=now()-interval '72 hours'
       and d.exact_item_confirmed and d.staff_instructions_confirmed and d.valid_hours_confirmed
       and d.shifts_briefed_at<=now() and d.qr_rehearsed_at<=now() and length(trim(d.support_escalation))>0
       and d.valid_until >= ((p.week_key::date+7)::timestamp at time zone m.timezone)
       and f.state='approved' and regexp_replace(lower(f.dependency_key),'[^a-z0-9]','','g')<>regexp_replace(lower(t.dependency_key),'[^a-z0-9]','','g')
       and exists(select 1 from redemption_points rp join redemption_credentials rc on rc.point_id=rp.id where rp.organization_id=s.organization_id and rp.location_id=s.location_id and rp.state='active' and rp.exposure='staff' and rc.state='active' and rc.credential_type='qr')
       and exists(select 1 from market_locations ml where ml.market_id=s.market_id and ml.location_id=s.location_id and ml.active and not exists(select 1 from location_outages outage where outage.location_id=s.location_id and outage.closed_at is null))) eligible,
      ((select count(*)::int from member_claims mc join claims c on c.id=mc.claim_id
         where mc.supply_id=s.id and mc.grant_id is null and
          (c.state='redeemed' or (c.state='active' and (mc.reserved_until is null or mc.reserved_until>now())
           and (c.snapshot->>'expires_at')::timestamptz>now())))
       +(select count(*)::int from recovery_grants rg where rg.replacement_supply_id=s.id
          and (rg.state='redeemed' or (rg.superseded_at is null and rg.expires_at>now())))
       +(select count(*)::int from fulfillment_grants g join weekly_releases r on r.id=g.release_id
          where g.supply_id=s.id and (r.run_id is distinct from p.run_id or r.week_key<>p.week_key)
           and (g.state='redeemed' or g.expires_at>now()))) competing,
      (select count(*)::int from fulfillment_grants g join weekly_releases r on r.id=g.release_id
        where g.supply_id=s.id and r.run_id=p.run_id and r.week_key=p.week_key) own_issued
     from effective_pilot_week_supplies p join network_drop_supplies s on s.id=p.supply_id
     join market_cells m on m.id=s.market_id
     left join pilot_supply_terms t on t.supply_id=s.id left join destination_readiness d on d.supply_id=s.id left join pilot_supply_fallbacks f on f.supply_id=s.id
     where p.run_id=$1`,
    [run.id, run.data_kind, run.market_id],
  );
  // Work from unclamped inventory. supplyUsage.remaining has already removed
  // this pilot's reservation and clamps shortages to zero, so adding a whole
  // commitment to it can fabricate units. Issued grants for this same plan are
  // part of its commitment; they must not be subtracted a second time.
  const quantities = await Promise.all(
    plans.map(async (p) => {
      let programId: string | null = null,
        commercialCapacity: number | null = null;
      if (p.commercial && !options.reviewingCommercial) {
        try {
          const program = await (
            await import("./pilot-promise")
          ).programForSupply(db, p.supply_id, p.week_key, run.id, 0);
          programId = program!.program_id;
          commercialCapacity = program!.remaining_capacity;
        } catch (error) {
          if (!(error instanceof RequestError)) throw error;
          commercialCapacity = 0;
        }
      }
      /* The terms that are totals for the week: the commitment, the stock left
         after other obligations, and the fallback behind it. */
      const total = p.eligible
        ? Math.max(
            0,
            Math.min(
              p.committed_quantity,
              p.inventory - p.competing,
              p.fallback_available,
            ),
          )
        : 0;
      const quantity = Math.min(total, commercialCapacity ?? Infinity);
      return {
        week_key: p.week_key,
        supply_id: p.supply_id,
        programId,
        commercialCapacity,
        /* What can still be placed. A Growth Program's remaining_capacity is
           already net of the grants it has issued, so when it binds this is a
           remainder rather than a total — which is exactly the number admission
           and release want. */
        quantity,
        /* What this supply backs for the whole week, grants already issued
           against it included. Subtracting those issued grants from `quantity`
           would count them twice whenever the commercial limit is the binding
           term, so anything displaying "N of M remain" reads this. */
        weekTotal:
          commercialCapacity !== null && commercialCapacity < total
            ? Math.min(total, commercialCapacity + p.own_issued)
            : total,
        issued: p.own_issued,
      };
    }),
  );
  const weeks = pilotWeeks(run).map((week) => {
    const groups = new Map<string, { quantity: number; limit: number }>();
    for (const supply of quantities.filter((q) => q.week_key === week)) {
      const group = groups.get(supply.programId || supply.supply_id) || {
        quantity: 0,
        limit: supply.commercialCapacity ?? Infinity,
      };
      group.quantity += supply.quantity;
      groups.set(supply.programId || supply.supply_id, group);
    }
    return {
      week,
      capacity: [...groups.values()].reduce(
        (n, group) => n + Math.min(group.quantity, group.limit),
        0,
      ),
    };
  });
  return {
    weeks,
    supplies: quantities,
    capacity: Math.min(run.hard_cap, ...weeks.map((w) => w.capacity)),
  };
}
export async function tryAdmitMemberInTransaction(
  tx: DB,
  memberId: string,
): Promise<{
  state: "admitted" | "waitlisted" | "unavailable";
  runId?: string;
}> {
  await tx.query(
    "select singleton from growth_program_coordination where singleton=true for update",
  );
  const [member] = await tx.query<{
    market_id: string;
    state: string;
    verified_at: string;
    source_id: string | null;
    data_kind: string;
    age_confirmed_at: string | null;
  }>("select * from uptick_members where id=$1", [memberId]);
  if (!member || member.state !== "active" || !member.verified_at)
    return { state: "unavailable" };
  if (member.data_kind === "real" && !member.age_confirmed_at)
    return { state: "unavailable" };
  if ((await memberServiceStatus(tx, memberId))?.blocks_future_release)
    return { state: "unavailable" };
  // The run lock serializes all admissions, including independent signup workers.
  const [run] = await tx.query<PilotRun>(
    "select * from pilot_runs where market_id=$1 and data_kind=$2 and state='enrolling' and cohort_frozen_at is null order by starts_on limit 1 for update",
    [member.market_id, member.data_kind],
  );
  const [existing] = await tx.query<{ run_id: string }>(
    "select a.run_id from pilot_admissions a join pilot_runs r on r.id=a.run_id where a.member_id=$1 and r.state<>'complete'",
    [memberId],
  );
  if (existing) return { state: "admitted", runId: existing.run_id };
  if (!run) return { state: "unavailable" };
  if (member.data_kind === "real")
    await (
      await import("./release-readiness")
    ).assertRealEnrollmentCommissioned(tx);
  // Supply pauses, adjustments and other inventory users take these same row
  // locks. An admission therefore sees one serialized set of backing facts.
  await tx.query(
    "select s.id from network_drop_supplies s join effective_pilot_week_supplies p on p.supply_id=s.id where p.run_id=$1 order by s.id for update of s",
    [run.id],
  );
  const [{ n }] = await tx.query<{ n: number }>(
    "select count(*)::int n from pilot_admissions where run_id=$1",
    [run.id],
  );
  const capacity = await pilotCapacity(tx, run);
  if (n >= capacity.capacity) {
    await tx.query(
      "insert into pilot_waitlist(run_id,member_id,reason) values($1,$2,'Four-week backed capacity reached') on conflict do nothing",
      [run.id, memberId],
    );
    return { state: "waitlisted", runId: run.id };
  }
  await tx.query(
    "insert into pilot_admissions(run_id,member_id,source_id,data_kind) values($1,$2,$3,$4) on conflict do nothing",
    [run.id, memberId, member.source_id, member.data_kind],
  );
  await tx.query(
    "delete from pilot_waitlist where run_id=$1 and member_id=$2",
    [run.id, memberId],
  );
  return { state: "admitted", runId: run.id };
}
export async function admitPilotMember(db: DB, actor: Actor, raw: unknown) {
  requirePilotOperator(actor);
  const d = z.object({ memberId: text }).parse(raw);
  return db.transaction((tx) => tryAdmitMemberInTransaction(tx, d.memberId));
}
const launchChecks = [
  "ownerAgreements",
  "staffRehearsal",
  "recoveryFunded",
  "supportCoverage",
  "partnerDistribution",
  "privacyIdentity",
  "releaseVerified",
] as const;
export async function setPilotState(db: DB, actor: Actor, raw: unknown) {
  requirePilotOperator(actor);
  const d = z
    .object({
      runId: text,
      state: z.enum(["enrolling", "live", "paused", "complete"]),
      checklist: z.record(z.string(), z.boolean()).default({}),
      releaseSha: z.string().max(80).default(""),
    })
    .parse(raw);
  await db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const run = await loadPilotRun(tx, d.runId, true);
    const transitions: Record<string, string[]> = {
      draft: ["enrolling", "paused"],
      enrolling: ["live", "paused"],
      live: ["paused", "complete"],
      paused: ["enrolling", "live", "complete"],
      complete: [],
    };
    if (!transitions[run.state]?.includes(d.state))
      throw new RequestError("This pilot state transition is not available.");
    if (run.cohort_frozen_at && d.state === "enrolling")
      throw new RequestError(
        "The baseline cohort is frozen. Resume this pilot as live; admissions cannot reopen.",
      );
    const checklist = { ...run.checklist, ...d.checklist };
    if (["enrolling", "live"].includes(d.state)) {
      if (run.data_kind === "real")
        await (
          await import("./release-readiness")
        ).assertRealEnrollmentCommissioned(tx, run.id);
      /* The shared proof, so this gate and the readiness map cannot disagree
         about whether the same run is backed. */
      const backing = await pilotBacking(tx, run);
      if (backing.available < backing.required)
        throw new RequestError(
          `Four-week supply backs ${backing.available} members for the unreleased operating weeks; ${backing.required} are required. ${backing.evidence} Confirm backing before continuing. Issued history remains unchanged.`,
        );
      const missing = launchChecks.filter((key) => !checklist[key]);
      if (missing.length)
        throw new RequestError(
          `Complete launch checks: ${missing.join(", ")}.`,
        );
      const [{ n }] = await tx.query<{ n: number }>(
        "select count(*)::int n from partner_commitments where run_id=$1 and state in ('planned','completed')",
        [run.id],
      );
      if (!n)
        throw new RequestError(
          "Record an accountable partner distribution before admission.",
        );
      if (
        run.data_kind === "real" &&
        process.env.PILOT_ENROLLMENT_ENABLED !== "true"
      )
        throw new RequestError(
          "Real enrollment remains disabled until hosted commissioning is complete.",
        );
      if (d.state === "live") {
        const [{ n: admitted }] = await tx.query<{ n: number }>(
          "select count(*)::int n from pilot_admissions where run_id=$1",
          [run.id],
        );
        if (!admitted)
          throw new RequestError(
            "Admit a fixed baseline cohort before starting the run.",
          );
      }
    }
    await tx.query(
      "update pilot_runs set state=$2,checklist=$3,release_sha=case when $4='' then release_sha else $4 end where id=$1",
      [run.id, d.state, checklist, d.releaseSha],
    );
    await audit(tx, actor.id, null, "pilot.state_changed", run.id, {
      from: run.state,
      to: d.state,
      checklist,
    });
  });
}
export async function savePartnerCommitment(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  requirePilotOperator(actor);
  const d = z
    .object({
      runId: text,
      partnerId: text,
      sourceId: text,
      channel: z.enum([
        "resident_email",
        "newsletter",
        "lobby_card",
        "front_desk",
        "move_in",
        "partner_screen",
      ]),
      plannedAt: z.iso.datetime(),
      owner: text,
      intendedPopulation: z.coerce
        .number()
        .int()
        .nonnegative()
        .max(1000000)
        .nullable(),
    })
    .parse(raw);
  const run = await loadPilotRun(db, d.runId);
  const [source] = await db.query(
    "select s.id from acquisition_sources s join acquisition_partners p on p.id=s.partner_id where s.id=$1 and s.partner_id=$2 and s.market_id=$3 and s.data_kind=$4 and p.data_kind=$4 and s.state='active' and p.state='active'",
    [d.sourceId, d.partnerId, run.market_id, run.data_kind],
  );
  if (!source)
    throw new RequestError(
      "Choose an active partner source in this pilot's Market Cell and data classification.",
    );
  await db.query(
    "insert into partner_commitments(id,run_id,partner_id,source_id,channel,planned_at,owner,intended_population) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id(),
      run.id,
      d.partnerId,
      d.sourceId,
      d.channel,
      d.plannedAt,
      d.owner,
      d.intendedPopulation,
    ],
  );
}
export async function completePartnerCommitment(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  requirePilotOperator(actor);
  const d = z
    .object({
      commitmentId: text,
      state: z.enum(["completed", "missed", "canceled"]),
      evidence: text,
      reportedDelivered: z.coerce.number().int().nonnegative().nullable(),
    })
    .parse(raw);
  await db.transaction(async (tx) => {
    const [row] = await tx.query(
      "update partner_commitments set state=$2,evidence=$3,reported_delivered=$4,completed_at=case when $2='completed' then now() else null end where id=$1 and state='planned' returning id",
      [d.commitmentId, d.state, d.evidence, d.reportedDelivered],
    );
    if (!row)
      throw new RequestError(
        "This commitment has already been recorded or is unavailable.",
      );
    await audit(
      tx,
      actor.id,
      null,
      "partner.distribution_recorded",
      d.commitmentId,
      {
        state: d.state,
        evidence: d.evidence,
        reportedDelivered: d.reportedDelivered,
      },
    );
  });
}
export const economicCategories = [
  "uptick_revenue",
  "uptick_expense",
  "merchant_benefit_exposure",
  "sponsor_benefit_exposure",
  "reserved_recovery_liquidity",
  "retail_value",
] as const;
export async function recordEconomicEntry(db: DB, actor: Actor, raw: unknown) {
  requirePilotOperator(actor);
  const d = z
    .object({
      runId: text,
      programId: z.string().max(100).nullable().default(null),
      category: z.enum(economicCategories),
      amount: money.refine((v) => v > 0),
      basis: z.enum(["committed", "actual"]),
      payer: text,
      payee: text,
      occurredOn: date,
      evidence: text,
      dedupKey: text,
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const run = await loadPilotRun(tx, d.runId);
    if (d.programId) {
      const [program] = await tx.query(
        "select id from growth_programs where id=$1 and market_id=$2",
        [d.programId, run.market_id],
      );
      if (!program)
        throw new RequestError("The program must belong to this Market Cell.");
    }
    if (d.category === "uptick_revenue" && d.basis === "committed")
      throw new RequestError(
        "Negotiated committed revenue comes from the approved Growth Program once. Record received cash as actual with a payment reference.",
      );
    const entryId = id();
    const [entry] = await tx.query<{ id: string }>(
      "insert into economic_entries(id,market_id,run_id,program_id,category,amount,basis,payer,payee,occurred_on,evidence,dedup_key,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(dedup_key) do nothing returning id",
      [
        entryId,
        run.market_id,
        run.id,
        d.programId,
        d.category,
        d.amount,
        d.basis,
        d.payer,
        d.payee,
        d.occurredOn,
        d.evidence,
        d.dedupKey,
        actor.id,
      ],
    );
    if (!entry)
      throw new RequestError(
        "This evidence/reference has already been recorded. Check the existing ledger entry.",
      );
    return entry.id;
  });
}
export async function reverseEconomicEntry(db: DB, actor: Actor, raw: unknown) {
  requirePilotOperator(actor);
  const d = z.object({ entryId: text, evidence: text }).parse(raw);
  return db.transaction(async (tx) => {
    const [original] = await tx.query<{
      id: string;
      reversal_of: string | null;
      amount: string;
    }>("select * from economic_entries where id=$1 for update", [d.entryId]);
    if (!original || original.reversal_of || Number(original.amount) <= 0)
      throw new RequestError("Choose an original positive entry to reverse.");
    await tx.query(
      "insert into economic_entries(id,market_id,run_id,program_id,category,amount,basis,payer,payee,occurred_on,evidence,reversal_of,dedup_key,created_by) select $2,market_id,run_id,program_id,category,-amount,basis,payer,payee,current_date,$3,id,$4,$5 from economic_entries where id=$1 on conflict(reversal_of) do nothing",
      [d.entryId, id(), d.evidence, `reversal:${d.entryId}`, actor.id],
    );
  });
}
export async function recordLabor(db: DB, actor: Actor, raw: unknown) {
  requirePilotOperator(actor);
  const d = z
    .object({
      runId: text,
      worker: text,
      minutes: z.coerce.number().int().min(1).max(1440),
      occurredOn: date,
      kind: z.enum(["setup", "operations", "on_call"]),
      note: text,
    })
    .parse(raw);
  await loadPilotRun(db, d.runId);
  await db.query(
    "insert into labor_entries(id,run_id,worker,minutes,occurred_on,kind,note,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id(),
      d.runId,
      d.worker,
      d.minutes,
      d.occurredOn,
      d.kind,
      d.note,
      actor.id,
    ],
  );
}

export async function pilotScorecard(db: DB, actor: Actor, runId: string) {
  requirePilotOperator(actor);
  const run = await loadPilotRun(db, runId);
  // Admissions never disappear when someone stops texts, moves ZIP, or disengages.
  const rows = await db.query<{ member_id: string; weeks: string[] }>(
    `select a.member_id,coalesce(array_agg(distinct g.week_key) filter(where c.state='redeemed' and g.week_key=any($2::text[]) and w.run_id=a.run_id and g.data_kind=a.data_kind),array[]::text[]) weeks from pilot_admissions a left join fulfillment_grants g on g.member_id=a.member_id left join weekly_releases w on w.id=g.release_id left join member_claims mc on mc.grant_id=g.id left join claims c on c.id=mc.claim_id where a.run_id=$1 and a.data_kind=$3 group by a.member_id`,
    [run.id, pilotWeeks(run), run.data_kind],
  );
  const denominator = rows.length,
    weeks = pilotWeeks(run),
    today = new Date();
  const matured =
    today >=
    marketWeekWindow(new Date(`${weeks[3]}T12:00:00Z`), run.timezone!).end;
  const firstUse = rows.filter((r) => r.weeks.length > 0).length,
    repeatUse = rows.filter((r) => r.weeks.length >= 2).length,
    weekFour = rows.filter((r) => r.weeks.includes(weeks[3])).length;
  const totals = await db.query<{
    category: string;
    basis: string;
    amount: string;
  }>(
    "select category,basis,sum(amount)::text amount from economic_entries where run_id=$1 group by category,basis order by category,basis",
    [run.id],
  );
  const labor = await db.query<{ kind: string; minutes: number }>(
    "select kind,sum(minutes)::int minutes from labor_entries where run_id=$1 group by kind",
    [run.id],
  );
  const [{ programFeeCents, creditsCents }] = await db.query<{
    programFeeCents: number;
    creditsCents: number;
  }>(
    `select coalesce(sum(v.negotiated_fee_cents),0)::int "programFeeCents",coalesce(sum((select coalesce(sum(c.amount_cents),0) from growth_program_credits c where c.program_id=p.id)),0)::int "creditsCents" from growth_programs p join growth_program_versions v on v.program_id=p.id and v.version=p.approved_version where exists(select 1 from growth_program_approvals a where a.program_id=p.id and a.program_version=p.approved_version and a.run_id=$1 and a.decision='approved')`,
    [run.id],
  );
  return {
    run,
    denominator,
    firstUse,
    repeatUse,
    weekFour: matured ? weekFour : null,
    matured,
    totals,
    labor,
    programFeeCents,
    creditsCents,
    criteria: {
      firstUse: 0.5,
      repeatUse: 0.3,
      weekFour: 0.25,
      weeklyLaborMinutes: 180,
    },
    evidence:
      "Recorded digital redemptions are not purchases, physical handoffs, organic loyalty or incrementality.",
  };
}
export async function partnerSummary(db: DB, actor: Actor, runId: string) {
  requirePilotOperator(actor);
  const run = await loadPilotRun(db, runId);
  return db.query<{
    partner_id: string;
    name: string;
    intended_population: number | null;
    executed: number;
    verified_members: number;
    retained_members: number | null;
  }>(
    `select p.id partner_id,p.name,(select max(c.intended_population)::int from partner_commitments c where c.run_id=$1 and c.partner_id=p.id) intended_population,(select count(*)::int from partner_commitments c where c.run_id=$1 and c.partner_id=p.id and c.state='completed') executed,count(distinct a.member_id)::int verified_members,case when count(distinct a.member_id)>=10 then count(distinct a.member_id) filter(where (select count(distinct g.week_key) from fulfillment_grants g join weekly_releases w on w.id=g.release_id join member_claims mc on mc.grant_id=g.id and mc.member_id=a.member_id join claims cl on cl.id=mc.claim_id where g.member_id=a.member_id and w.run_id=a.run_id and g.data_kind=a.data_kind and cl.state='redeemed' and g.week_key=any($3::text[]))>=2)::int else null end retained_members from acquisition_partners p join acquisition_sources s on s.partner_id=p.id left join pilot_admissions a on a.source_id=s.id and a.run_id=$1 and a.data_kind=$2 where exists(select 1 from partner_commitments c where c.partner_id=p.id and c.run_id=$1) group by p.id,p.name`,
    [run.id, run.data_kind, pilotWeeks(run)],
  );
}

export async function classifyPilotEntity(db: DB, actor: Actor, raw: unknown) {
  requirePilotOperator(actor);
  const d = z
    .object({
      entity: z.enum([
        "market_cells",
        "acquisition_partners",
        "acquisition_sources",
      ]),
      entityId: text,
      dataKind: z.enum(dataKinds),
      evidence: text,
    })
    .parse(raw);
  await db.transaction(async (tx) => {
    const [row] = await tx.query(
      `select id,data_kind from ${d.entity} where id=$1 for update`,
      [d.entityId],
    );
    if (!row) throw new RequestError("This record is unavailable.");
    const [used] =
      d.entity === "market_cells"
        ? await tx.query(
            "select id from pilot_runs where market_id=$1 union all select id from uptick_members where market_id=$1 limit 1",
            [d.entityId],
          )
        : d.entity === "acquisition_sources"
          ? await tx.query(
              "select id from uptick_members where source_id=$1 union all select id from partner_commitments where source_id=$1 limit 1",
              [d.entityId],
            )
          : await tx.query(
              "select id from partner_commitments where partner_id=$1 limit 1",
              [d.entityId],
            );
    if (used)
      throw new RequestError(
        "This record already has pilot/member obligations. Create a correctly classified record instead of relabeling history.",
      );
    await tx.query(`update ${d.entity} set data_kind=$2 where id=$1`, [
      d.entityId,
      d.dataKind,
    ]);
    await audit(tx, actor.id, null, "pilot.data_classified", d.entityId, {
      entity: d.entity,
      from: row.data_kind,
      to: d.dataKind,
      evidence: d.evidence,
    });
  });
}
export async function pilotOperations(
  db: DB,
  actor: Actor,
  selectedRun?: string,
) {
  requirePilotOperator(actor);
  const runs = await db.query<PilotRun>(
    "select r.*,r.starts_on::text starts_on,r.ends_on::text ends_on,m.timezone from pilot_runs r join market_cells m on m.id=r.market_id order by r.created_at desc",
  );
  const run = selectedRun
    ? runs.find((r) => r.id === selectedRun) || null
    : runs.find((r) => r.data_kind === "real") || runs[0] || null;
  const markets = await db.query<{
    id: string;
    name: string;
    data_kind: string;
  }>("select id,name,data_kind from market_cells order by name");
  const sources = await db.query<{
    id: string;
    name: string;
    partner_id: string;
    partner: string;
    data_kind: string;
    market_id: string;
  }>(
    "select s.id,s.name,s.partner_id,p.name partner,s.data_kind,s.market_id from acquisition_sources s join acquisition_partners p on p.id=s.partner_id where s.state='active' and p.state='active' order by p.name,s.name",
  );
  const supplies = await db.query<{
    id: string;
    market_id: string;
    reward: string;
    merchant: string;
    state: string;
    data_kind: string;
    quantity: number;
    week_key: string | null;
  }>(
    "select s.id,s.market_id,v.reward,o.name merchant,s.state,t.data_kind,s.quantity,p.week_key from network_drop_supplies s join organizations o on o.id=s.organization_id join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version join pilot_supply_terms t on t.supply_id=s.id left join effective_pilot_week_supplies p on p.supply_id=s.id order by s.created_at desc",
  );
  if (!run) return { runs, run, markets, sources, supplies, detail: null };
  const [
    capacity,
    scorecard,
    partners,
    commitments,
    plans,
    admissions,
    waitlist,
    ledger,
  ] = await Promise.all([
    pilotCapacity(db, run),
    pilotScorecard(db, actor, run.id),
    partnerSummary(db, actor, run.id),
    db.query<{
      id: string;
      partner: string;
      channel: string;
      planned_at: string;
      owner: string;
      state: string;
      evidence: string;
    }>(
      "select c.*,p.name partner from partner_commitments c join acquisition_partners p on p.id=c.partner_id where c.run_id=$1 order by planned_at",
      [run.id],
    ),
    db.query<{
      week_key: string;
      supply_id: string;
      committed_quantity: number;
      merchant: string;
      reward: string;
    }>(
      "select p.*,o.name merchant,v.reward from effective_pilot_week_supplies p join network_drop_supplies s on s.id=p.supply_id join organizations o on o.id=s.organization_id join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version where p.run_id=$1 order by p.week_key,o.name",
      [run.id],
    ),
    db.query<{
      member_id: string;
      admitted_at: string;
      source: string | null;
      phone_hint: string;
      home_zip: string;
      data_kind: string;
    }>(
      "select a.member_id,a.admitted_at,s.name source,right(c.phone,4) phone_hint,m.home_zip,m.data_kind from pilot_admissions a join uptick_members m on m.id=a.member_id join customers c on c.id=m.customer_id left join acquisition_sources s on s.id=a.source_id where a.run_id=$1 order by a.admitted_at",
      [run.id],
    ),
    db.query<{ member_id: string; reason: string }>(
      "select member_id,reason from pilot_waitlist where run_id=$1 order by requested_at",
      [run.id],
    ),
    db.query<{
      id: string;
      category: string;
      amount: string;
      basis: string;
      payer: string;
      payee: string;
      evidence: string;
      occurred_on: string;
      reversed: boolean;
    }>(
      "select e.*,exists(select 1 from economic_entries r where r.reversal_of=e.id) reversed from economic_entries e where run_id=$1 order by created_at desc limit 100",
      [run.id],
    ),
  ]);
  /* The shared proof, so this page, the run-state gate, the amendment guard and
     the readiness map all mean the same thing by "backed". Measuring against
     `target_members` here said a frozen twenty-member pilot with five
     withdrawals was blocked at 15 of 20, while `amendPilotSupply` had correctly
     accepted a 15-unit amendment for the same weeks. */
  const backing = await pilotBacking(db, run, capacity);
  const ready = launchChecks.every((key) => run.checklist[key]) && !backing.short;
  // Structured so the command centre can group, rank and route each blocker.
  // `text` stays the single truthful sentence; nothing is summarised into a score.
  const constraints: PilotConstraint[] = [];
  const raise = (
    category: PilotConstraint["category"],
    urgency: PilotConstraint["urgency"],
    text: string,
    href?: string,
  ) => constraints.push({ category, urgency, text, href });
  const [openIncidents, unready, jobs, failures] = await Promise.all([
    db.query<{ owner: string; n: number }>(
      "select i.owner,count(*)::int n from fulfillment_incidents i join fulfillment_grants g on g.id=i.grant_id join weekly_releases r on r.id=g.release_id where r.run_id=$1 and i.state in ('open','recovering') group by i.owner",
      [run.id],
    ),
    db.query<{ merchant: string; state: string | null }>(
      "select o.name merchant,r.state from effective_pilot_week_supplies p join network_drop_supplies s on s.id=p.supply_id join organizations o on o.id=s.organization_id left join destination_readiness r on r.supply_id=s.id left join pilot_supply_fallbacks f on f.supply_id=s.id where p.run_id=$1 and s.expires_at>now() and (s.state<>'approved' or r.state is distinct from 'ready' or r.valid_until<=now() or f.state is distinct from 'approved')",
      [run.id],
    ),
    db.query<{ job_key: string; state: string; last_success: string | null }>(
      "select distinct on (job_key) j.job_key,j.state,(select max(s.finished_at) from scheduled_job_runs s where s.job_key=j.job_key and s.state='succeeded') last_success from scheduled_job_runs j order by job_key,started_at desc",
    ),
    db.query<{ n: number }>(
      "select count(*)::int n from member_messages m join pilot_admissions a on a.member_id=m.member_id where a.run_id=$1 and m.state in ('unknown','failed','undelivered')",
      [run.id],
    ),
  ]);
  for (const incident of openIncidents)
    raise(
      "Incidents",
      "bad",
      `${incident.n} unresolved fulfillment incident(s). Owner: ${incident.owner}. Open fulfillment recovery.`,
      "/operator/pilot/fulfillment",
    );
  for (const destination of unready)
    raise(
      "Destinations",
      "warn",
      `${destination.merchant}: readiness or fallback is unavailable. Confirm before new releases.`,
      "/operator/pilot/fulfillment",
    );
  if (failures[0]?.n)
    raise(
      "Messaging",
      "bad",
      `${failures[0].n} failed or uncertain messages need review. Do not blindly retry unknown delivery.`,
      "/operator/network/messaging",
    );
  if (run.state === "live") {
    for (const key of ["membership_prepare", "membership_dispatch"]) {
      const job = jobs.find((j) => j.job_key === key);
      if (
        !job?.last_success ||
        job.state !== "succeeded" ||
        Date.now() - new Date(job.last_success).getTime() > 15 * 60 * 1000
      )
        raise(
          "Scheduler",
          "bad",
          `${key.replaceAll("_", " ")}: scheduler health needs attention.`,
        );
    }
    const currentWeek = marketWeekWindow(new Date(), run.timezone!).weekKey;
    if (pilotWeeks(run).includes(currentWeek)) {
      const [{ n }] = await db.query<{ n: number }>(
        "select count(*)::int n from pilot_admissions a where a.run_id=$1 and not exists(select 1 from fulfillment_grants g join weekly_releases r on r.id=g.release_id where r.run_id=a.run_id and r.week_key=$2 and g.member_id=a.member_id)",
        [run.id, currentWeek],
      );
      if (n)
        raise(
          "Supply",
          "warn",
          `${n} admitted members await this week's backed release.`,
        );
    }
  }
  if (backing.short)
    raise(
      "Supply",
      "bad",
      `Supply backs ${backing.available} of the ${backing.required} members this run owes a benefit. ${backing.evidence}`,
    );
  for (const c of commitments)
    if (c.state === "planned" && new Date(c.planned_at) < new Date())
      raise(
        "Partners",
        "warn",
        `${c.partner}: ${c.channel.replaceAll("_", " ")} is overdue. Owner: ${c.owner}.`,
      );
  if (!commitments.length)
    raise("Partners", "warn", "Record a partner distribution commitment.");
  for (const key of launchChecks)
    if (!run.checklist[key])
      raise(
        "Readiness",
        "warn",
        `Confirm ${key.replace(/([A-Z])/g, " $1").toLowerCase()}.`,
      );
  return {
    runs,
    run,
    markets,
    sources,
    supplies,
    detail: {
      capacity,
      scorecard,
      partners,
      commitments,
      plans,
      admissions,
      waitlist,
      ledger,
      ready,
      constraints,
    },
  };
}
