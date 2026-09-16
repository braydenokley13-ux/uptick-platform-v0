/* Local Network Command Centre.

   One assembled read for the operator overview. It exists so the overview can
   answer decision questions directly — what needs attention, is next week
   actually backed, which counter is unreliable, is messaging healthy, is
   support falling behind — instead of asking the operator to reconstruct the
   answer from several tables.

   Two rules hold throughout:
   1. No invented composite score. Every state shown is a real underlying
      constraint, and the constraint's own sentence travels with it.
   2. Nothing is rounded into reassurance. A week that is short says how short. */
import type { DB } from "./db";
import type { Actor } from "./domain";
import { pilotCapacity, pilotWeeks, type PilotRun } from "./pilot-operations";
import { marketWeekWindow } from "./network";

export type DestinationPin = {
  supplyId: string;
  organizationId: string;
  label: string;
  item: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  driveMinutes: number | null;
  /** The worst true thing about this destination right now. */
  state: "active" | "low_supply" | "outage" | "not_ready";
  /** Plain sentence naming the constraint behind `state`. */
  why: string;
  issued: number;
  redeemed: number;
  remaining: number;
  fallbackAvailable: number;
  openIncidents: number;
};

export type WeekBacking = {
  week: string;
  label: string;
  index: number;
  capacity: number;
  required: number;
  released: boolean;
  current: boolean;
  short: number;
};

/** Destinations in this Market Cell with their real current state. */
export async function destinationPins(
  db: DB,
  run: PilotRun,
  weekKey: string,
): Promise<DestinationPin[]> {
  const rows = await db.query<{
    supply_id: string;
    organization_id: string;
    label: string;
    item: string;
    address: string;
    latitude: string | null;
    longitude: string | null;
    drive_minutes: number | null;
    committed: number;
    inventory: number;
    ready_state: string | null;
    valid_until: string | null;
    stock_confirmed_at: string | null;
    outage_reason: string | null;
    fallback_available: number;
    issued: number;
    redeemed: number;
    open_incidents: number;
  }>(
    `select s.id supply_id, s.organization_id, o.name label,
       coalesce(t.exact_item,'Benefit not yet configured') item,
       coalesce(l.address,'') address, l.latitude, l.longitude, ml.drive_minutes,
       p.committed_quantity committed,
       (coalesce(s.quantity,0)+(select coalesce(sum(delta),0)::int from supply_adjustments where supply_id=s.id)) inventory,
       d.state ready_state, d.valid_until, d.stock_confirmed_at,
       (select outage.reason from location_outages outage where outage.location_id=s.location_id and outage.closed_at is null limit 1) outage_reason,
       greatest(0,coalesce(f.usable_capacity,0)-(select count(*)::int from recovery_grants rg where rg.fallback_id=f.id and (rg.state='redeemed' or (rg.superseded_at is null and rg.expires_at>now())))) fallback_available,
       (select count(*)::int from fulfillment_grants g join weekly_releases r on r.id=g.release_id
         where g.supply_id=s.id and r.run_id=$1 and r.week_key=$2) issued,
       (select count(*)::int from fulfillment_grants g join weekly_releases r on r.id=g.release_id
         where g.supply_id=s.id and r.run_id=$1 and r.week_key=$2 and g.state='redeemed') redeemed,
       (select count(*)::int from fulfillment_incidents i join fulfillment_grants g on g.id=i.grant_id
         join weekly_releases r on r.id=g.release_id
         where g.supply_id=s.id and r.run_id=$1 and i.state in ('open','recovering')) open_incidents
     from effective_pilot_week_supplies p
     join network_drop_supplies s on s.id=p.supply_id
     join organizations o on o.id=s.organization_id
     join locations l on l.id=s.location_id
     left join market_locations ml on ml.market_id=s.market_id and ml.location_id=s.location_id
     left join pilot_supply_terms t on t.supply_id=s.id
     left join destination_readiness d on d.supply_id=s.id
     left join pilot_supply_fallbacks f on f.supply_id=s.id
     where p.run_id=$1 and p.week_key=$2
     order by o.name`,
    [run.id, weekKey],
  );
  return rows.map((row) => {
    const remaining = Math.max(0, row.inventory - row.issued);
    let state: DestinationPin["state"] = "active";
    let why = `${remaining} of ${row.inventory} backed units remain this week.`;
    if (row.outage_reason) {
      state = "outage";
      why = `Closed to routing. ${row.outage_reason}`;
    } else if (
      row.ready_state !== "ready" ||
      (row.valid_until && new Date(row.valid_until) <= new Date())
    ) {
      state = "not_ready";
      why =
        row.ready_state === "ready"
          ? "Readiness confirmation has expired. Re-confirm stock and staff."
          : `Destination readiness is ${(row.ready_state || "not recorded").replaceAll("_", " ")}. Confirm before the next release.`;
    } else if (remaining <= Math.max(3, Math.round(row.inventory * 0.15))) {
      state = "low_supply";
      why = `Only ${remaining} of ${row.inventory} backed units remain this week.`;
    }
    if (row.open_incidents && state === "active") {
      why = `${row.open_incidents} open incident(s) at this counter. ${why}`;
    }
    return {
      supplyId: row.supply_id,
      organizationId: row.organization_id,
      label: row.label,
      item: row.item,
      address: row.address,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      driveMinutes: row.drive_minutes,
      state,
      why,
      issued: row.issued,
      redeemed: row.redeemed,
      remaining,
      fallbackAvailable: row.fallback_available,
      openIncidents: row.open_incidents,
    };
  });
}

/** Week-by-week backing against the cohort actually owed a benefit. */
export function weekBacking(
  run: PilotRun,
  capacity: Awaited<ReturnType<typeof pilotCapacity>>,
  released: string[],
  owed: number,
  currentWeek: string,
): WeekBacking[] {
  return pilotWeeks(run).map((week, index) => {
    const found = capacity.weeks.find((w) => w.week === week);
    const available = found?.capacity ?? 0;
    return {
      week,
      index: index + 1,
      label: `Week ${index + 1}`,
      capacity: available,
      required: owed,
      released: released.includes(week),
      current: week === currentWeek,
      short: Math.max(0, owed - available),
    };
  });
}

export async function commandCentre(
  db: DB,
  actor: Actor,
  run: PilotRun,
  weekKey?: string,
) {
  void actor;
  const weeks = pilotWeeks(run);
  const currentWeek = marketWeekWindow(new Date(), run.timezone!).weekKey;
  const week = weeks.includes(weekKey || "")
    ? weekKey!
    : weeks.includes(currentWeek)
      ? currentWeek
      : weeks[0];
  const [
    capacity,
    pins,
    releases,
    admitted,
    waitlisted,
    thisWeek,
    lastWeek,
    support,
    messaging,
    incidents,
  ] = await Promise.all([
    pilotCapacity(db, run),
    destinationPins(db, run, week),
    db.query<{ week_key: string }>(
      "select week_key from weekly_releases where run_id=$1",
      [run.id],
    ),
    db.query<{ n: number }>(
      "select count(*)::int n from pilot_admissions where run_id=$1",
      [run.id],
    ),
    db.query<{ n: number }>(
      "select count(*)::int n from pilot_waitlist where run_id=$1",
      [run.id],
    ),
    db.query<{ issued: number; redeemed: number }>(
      `select count(*)::int issued,count(*) filter(where g.state='redeemed')::int redeemed
       from fulfillment_grants g join weekly_releases r on r.id=g.release_id
       where r.run_id=$1 and r.week_key=$2`,
      [run.id, week],
    ),
    db.query<{ issued: number; redeemed: number }>(
      `select count(*)::int issued,count(*) filter(where g.state='redeemed')::int redeemed
       from fulfillment_grants g join weekly_releases r on r.id=g.release_id
       where r.run_id=$1 and r.week_key<$2`,
      [run.id, week],
    ),
    db.query<{ open: number; oldest: string | null }>(
      "select count(*)::int open,min(created_at) oldest from member_support_requests where state in ('queued','working')",
    ),
    db.query<{ state: string; n: number }>(
      `select m.state,count(*)::int n from member_messages m
       join pilot_admissions a on a.member_id=m.member_id
       where a.run_id=$1 group by m.state`,
      [run.id],
    ),
    db.query<{ n: number }>(
      `select count(*)::int n from fulfillment_incidents i
       join fulfillment_grants g on g.id=i.grant_id
       join weekly_releases r on r.id=g.release_id
       where r.run_id=$1 and i.state in ('open','recovering')`,
      [run.id],
    ),
  ]);
  const released = releases.map((r) => r.week_key);
  const owed = admitted[0]?.n || run.target_members;
  const backing = weekBacking(run, capacity, released, owed, currentWeek);
  const index = weeks.indexOf(week);
  const failedMessages = messaging
    .filter((m) => ["failed", "undelivered", "unknown"].includes(m.state))
    .reduce((n, m) => n + m.n, 0);
  return {
    week,
    weekIndex: index + 1,
    weekWindow: marketWeekWindow(new Date(`${week}T12:00:00Z`), run.timezone!),
    prevWeek: index > 0 ? weeks[index - 1] : undefined,
    nextWeek: index < weeks.length - 1 ? weeks[index + 1] : undefined,
    isCurrentWeek: week === currentWeek,
    released: released.includes(week),
    backing,
    pins,
    capacity,
    admitted: admitted[0]?.n || 0,
    waitlisted: waitlisted[0]?.n || 0,
    issued: thisWeek[0]?.issued || 0,
    redeemed: thisWeek[0]?.redeemed || 0,
    priorIssued: lastWeek[0]?.issued || 0,
    priorRedeemed: lastWeek[0]?.redeemed || 0,
    openIncidents: incidents[0]?.n || 0,
    support: support[0] || { open: 0, oldest: null },
    failedMessages,
    atRisk:
      (incidents[0]?.n || 0) +
      pins.filter((p) => p.state === "outage" || p.state === "not_ready")
        .length,
  };
}
