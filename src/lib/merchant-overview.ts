/* The merchant's whole story, in the order they ask it.

     1. What are we trying to accomplish?   → objective
     2. What do I need to provide?          → commitment
     3. What is Uptick doing?               → activity
     4. What happened?                      → results
     5. What should we do next?             → next

   Deliberately absent: impressions, reach, audience segments, member lists,
   attribution, or any "new customers" figure.

   What this file may and may not claim
   ------------------------------------
   The only fact the database independently holds is that a grant reached
   `state='redeemed'` — a redemption was *recorded*. That is weaker than it
   sounds, and the schema says so itself: `redemption_evidence` carries
   `transaction_verified boolean ... check(transaction_verified=false)`, a
   column the database forbids from ever being true. So Uptick cannot prove a
   purchase, a visit, an incremental visit, or that an item physically changed
   hands. It can prove that a redemption was recorded, and separately that some
   of those recordings were staff-gated at a registered counter device
   (`verification_level >= 1`), which is stronger evidence but still not proof
   of physical handoff.

   Every merchant-facing number below is therefore named for the event that was
   recorded, never for the commercial outcome someone might hope it implies. */
import type { DB } from "./db";
import type { Actor } from "./domain";
import { marketWeekWindow } from "./network";

/** Where an incident's make-good actually stands. A recovery that merely
    exists is not a recovery that worked, so these are kept distinct. */
export type RecoveryState =
  | "none" // no make-good has been issued at all
  | "active" // issued, still live, not yet used
  | "completed" // redeemed — the only state that means "made good"
  | "expired" // issued, never used, and the window has closed
  | "superseded"; // every attempt was replaced, none is current

export type MerchantIncident = {
  id: string;
  incident_type: string;
  state: string;
  occurred_at: string;
  recoveryState: RecoveryState;
  /** How many make-goods have been issued for this incident, including ones
      that failed and were superseded. */
  recoveryAttempts: number;
  /** True only when a recovery was actually redeemed. */
  madeGood: boolean;
  /** True when nothing has closed this out: no redeemed recovery and no
      operator resolution. An expired make-good lands here, not in "made good". */
  unresolved: boolean;
};

export type MerchantWeek = {
  weekKey: string;
  index: number;
  label: string;
  current: boolean;
  issued: number;
  /** Redemptions recorded. Not visits, not purchases, not handoffs. */
  recorded: number;
  /** The subset of those recorded at a staff-gated counter device. */
  staffVerified: number;
  released: boolean;
};

type IncidentRow = {
  id: string;
  incident_type: string;
  state: string;
  occurred_at: string;
  recovery_attempts: number;
  current_state: string | null;
  current_live: boolean | null;
};

function recoveryStateOf(row: IncidentRow): RecoveryState {
  if (!row.current_state) return row.recovery_attempts ? "superseded" : "none";
  if (row.current_state === "redeemed") return "completed";
  return row.current_live ? "active" : "expired";
}

export async function merchantOverview(db: DB, actor: Actor) {
  const organizationId = actor.organizationId;
  const [organization] = await db.query<{
    id: string;
    name: string;
    timezone: string;
  }>("select id,name,timezone from organizations where id=$1", [
    organizationId,
  ]);

  /* The pilot this merchant is backing. A finished pilot is still the
     merchant's pilot: its results are exactly what a renewal conversation is
     about, so a completed run is selected rather than hidden.

     Ordering is by what the merchant needs to act on, not by date. Sorting on
     starts_on alone would let a draft pencilled in for next month outrank the
     live run whose counter has to be ready this morning. */
  const [run] = await db.query<{
    id: string;
    name: string;
    state: string;
    starts_on: string;
    timezone: string;
    support_owner: string;
    data_kind: string;
  }>(
    `select r.id,r.name,r.state,r.starts_on::text starts_on,m.timezone,r.support_owner,r.data_kind
       from pilot_runs r
       join market_cells m on m.id=r.market_id
      where exists(
        select 1 from effective_pilot_week_supplies p
          join network_drop_supplies s on s.id=p.supply_id
         where p.run_id=r.id and s.organization_id=$1)
      order by case r.state
                 when 'live' then 0 when 'paused' then 1 when 'enrolling' then 2
                 when 'complete' then 3 else 4 end,
               r.starts_on desc
      limit 1`,
    [organizationId],
  );
  if (!organization || !run)
    return {
      organization,
      run: null as null,
      completed: false,
      commitment: null,
      weeks: [],
      activeWeek: null,
      totals: null,
      incidents: [] as MerchantIncident[],
      location: null,
    };

  const completed = run.state === "complete";
  const weekKeys = [0, 7, 14, 21].map((days) =>
    new Date(Date.parse(`${run.starts_on}T12:00:00Z`) + days * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const currentWeek = marketWeekWindow(new Date(), run.timezone).weekKey;

  /* What this merchant owes at the counter *for the week being shown*.
     `effective_pilot_week_supplies` resolves the amendment chain per week, so
     a supply amended for a future week cannot become today's instructions.
     Selecting the newest supply row instead would do exactly that.

     Only approved rows are read. A draft or paused supply, or an unapproved
     fallback, is not something staff should be told to hand over — printing it
     here would put an item on the counter that nobody agreed to provide. */
  const commitmentWeek = weekKeys.includes(currentWeek)
    ? currentWeek
    : weekKeys.filter((key) => key <= currentWeek).pop() || weekKeys[0];
  const [commitment] = await db.query<{
    exact_item: string;
    size_label: string;
    usable_hours: string;
    qualification: string;
    terms: string;
    substitute_item: string | null;
    fallback_available: number | null;
    address: string;
    week_key: string;
    committed_quantity: number | null;
  }>(
    `select t.exact_item,t.size_label,t.usable_hours,v.qualification,v.terms,
            f.substitute_item,
            greatest(0,f.usable_capacity-(select count(*)::int from recovery_grants rg where rg.fallback_id=f.id and (rg.state='redeemed' or (rg.superseded_at is null and rg.expires_at>now())))) fallback_available,
            coalesce(l.address,'') address,
            p.week_key, p.committed_quantity
       from effective_pilot_week_supplies p
       join network_drop_supplies s on s.id=p.supply_id
       join pilot_supply_terms t on t.supply_id=s.id
       join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version
       join locations l on l.id=s.location_id
       left join pilot_supply_fallbacks f on f.supply_id=s.id and f.state='approved'
      where p.run_id=$1 and p.week_key=$2 and s.organization_id=$3
        and s.state='approved'
      limit 1`,
    [run.id, commitmentWeek, organizationId],
  );

  /* Week activity, scoped to the run's own classification.

     `releaseWeeklyBenefits` already refuses to issue a grant whose data_kind
     differs from its run, so in a healthy database this filter changes
     nothing. It is written explicitly anyway, because the one thing a
     merchant's numbers must never do is absorb an internal commissioning
     record into a real pilot's totals — and stating the invariant here means a
     row that somehow escapes that guard is excluded rather than counted.

     Note this is deliberately `= run.data_kind` and not `= 'real'`: a
     rehearsal run is supposed to show its own rehearsal numbers. The rule is
     that classifications never mix, not that only real data is ever shown. */
  const perWeek = await db.query<{
    week_key: string;
    issued: number;
    recorded: number;
    staff_verified: number;
  }>(
    `select r.week_key,count(*)::int issued,
            count(*) filter(where g.state='redeemed')::int recorded,
            count(*) filter(where g.state='redeemed' and exists(
              select 1 from member_claims mc
                join redemption_evidence re on re.claim_id=mc.claim_id
               where mc.grant_id=g.id and re.staff_gated and re.verification_level>=1))::int staff_verified
       from fulfillment_grants g
       join weekly_releases r on r.id=g.release_id
       join network_drop_supplies s on s.id=g.supply_id
      where r.run_id=$1 and s.organization_id=$2 and g.data_kind=$3
      group by r.week_key`,
    [run.id, organizationId, run.data_kind],
  );
  const released = await db.query<{ week_key: string }>(
    "select week_key from weekly_releases where run_id=$1",
    [run.id],
  );

  const weeks: MerchantWeek[] = weekKeys.map((weekKey, i) => {
    const row = perWeek.find((w) => w.week_key === weekKey);
    return {
      weekKey,
      index: i + 1,
      label: `Week ${i + 1}`,
      current: !completed && weekKey === currentWeek,
      issued: row?.issued || 0,
      recorded: row?.recorded || 0,
      staffVerified: row?.staff_verified || 0,
      released: released.some((r) => r.week_key === weekKey),
    };
  });

  /* Anything that went wrong at this counter, and where its make-good actually
     stands. The current attempt is the one that has not been superseded;
     supersession is permanent and enforced by trigger, so there is at most one.

     This query is written once and used twice: the recent slice the merchant
     reads, and the totals above it. The headline figures must count every
     incident in the run, not the twenty most recent — deriving "No outstanding
     problems" from a capped list is how a merchant with unresolved members
     gets shown a green check. */
  const incidentSelect = `
    select i.id,i.incident_type,i.state,i.occurred_at::text occurred_at,
           (select count(*)::int from recovery_grants rg where rg.incident_id=i.id) recovery_attempts,
           current.state current_state,
           (current.expires_at>now()) current_live
      from fulfillment_incidents i
      join fulfillment_grants g on g.id=i.grant_id
      join network_drop_supplies s on s.id=g.supply_id
      join weekly_releases r on r.id=g.release_id
      left join lateral (
        select rg.state,rg.expires_at from recovery_grants rg
         where rg.incident_id=i.id and rg.superseded_at is null
         order by rg.issued_at desc limit 1
      ) current on true
     where r.run_id=$1 and s.organization_id=$2 and g.data_kind=$3
     order by i.occurred_at desc`;
  const allIncidentRows = await db.query<IncidentRow>(incidentSelect, [
    run.id,
    organizationId,
    run.data_kind,
  ]);

  const allIncidents: MerchantIncident[] = allIncidentRows.map((row) => {
    const recoveryState = recoveryStateOf(row);
    const madeGood = recoveryState === "completed";
    return {
      id: row.id,
      incident_type: row.incident_type,
      state: row.state,
      occurred_at: row.occurred_at,
      recoveryState,
      recoveryAttempts: row.recovery_attempts,
      madeGood,
      /* Operator resolution and a redeemed recovery are the only two things
         that close an incident. An expired or superseded make-good leaves it
         open, which is the whole point of tracking these separately. */
      unresolved: !madeGood && !["resolved", "closed"].includes(row.state),
    };
  });
  /* The list is what a merchant reads; the totals are what they trust. */
  const incidents = allIncidents.slice(0, 20);

  const issued = weeks.reduce((n, w) => n + w.issued, 0);
  const recorded = weeks.reduce((n, w) => n + w.recorded, 0);
  const staffVerified = weeks.reduce((n, w) => n + w.staffVerified, 0);
  const activeWeek = weeks.find((w) => w.current) || null;
  const count = (state: RecoveryState) =>
    allIncidents.filter((i) => i.recoveryState === state).length;

  return {
    organization,
    run,
    completed,
    commitment: commitment || null,
    location: commitment?.address || null,
    weeks,
    activeWeek,
    totals: {
      issued,
      /* Named for the event the database actually holds. */
      recorded,
      staffVerified,
      /* Only ever "of issued". Never framed as customers or visits. */
      redemptionRate: issued ? Math.round((recorded / issued) * 100) : null,
      incidentsTotal: allIncidents.length,
      /* Nothing here is inferred from another figure: each counts incidents
         whose make-good is genuinely in that state. */
      unresolvedIncidents: allIncidents.filter((i) => i.unresolved).length,
      recoveriesCompleted: count("completed"),
      recoveriesActive: count("active"),
      recoveriesExpired: count("expired"),
      recoveriesSuperseded: count("superseded"),
    },
    incidents,
  };
}
