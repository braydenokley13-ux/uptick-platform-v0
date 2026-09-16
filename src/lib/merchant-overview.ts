/* The merchant's whole story, in the order they ask it.

     1. What are we trying to accomplish?   → objective
     2. What do I need to provide?          → commitment
     3. What is Uptick doing?               → activity
     4. What happened?                      → results
     5. What should we do next?             → next

   Deliberately absent: impressions, reach, audience segments, member lists,
   attribution, or any "new customers" figure. Uptick can prove that a benefit
   was issued and that a specific benefit was handed over at this counter. It
   cannot prove someone became a customer, so it does not say so. */
import type { DB } from "./db";
import type { Actor } from "./domain";
import { marketWeekWindow } from "./network";

export type MerchantWeek = {
  weekKey: string;
  index: number;
  label: string;
  current: boolean;
  issued: number;
  redeemed: number;
  released: boolean;
};

export async function merchantOverview(db: DB, actor: Actor) {
  const organizationId = actor.organizationId;
  const [organization] = await db.query<{
    id: string;
    name: string;
    timezone: string;
  }>("select id,name,timezone from organizations where id=$1", [
    organizationId,
  ]);

  /* The pilot this merchant is actually backing, if any. */
  const [run] = await db.query<{
    id: string;
    name: string;
    state: string;
    starts_on: string;
    timezone: string;
    support_owner: string;
  }>(
    `select distinct r.id,r.name,r.state,r.starts_on::text starts_on,m.timezone,r.support_owner
       from pilot_runs r
       join market_cells m on m.id=r.market_id
       join effective_pilot_week_supplies p on p.run_id=r.id
       join network_drop_supplies s on s.id=p.supply_id
      where s.organization_id=$1 and r.state<>'complete'
      order by starts_on desc limit 1`,
    [organizationId],
  );
  if (!organization || !run)
    return {
      organization,
      run: null as null,
      commitment: null,
      weeks: [],
      totals: null,
      incidents: [],
      location: null,
    };

  const weekKeys = [0, 7, 14, 21].map((days) =>
    new Date(Date.parse(`${run.starts_on}T12:00:00Z`) + days * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const currentWeek = marketWeekWindow(new Date(), run.timezone).weekKey;

  const [commitment] = await db.query<{
    exact_item: string;
    size_label: string;
    usable_hours: string;
    qualification: string;
    terms: string;
    substitute_item: string | null;
    fallback_available: number | null;
    address: string;
  }>(
    `select t.exact_item,t.size_label,t.usable_hours,v.qualification,v.terms,
            f.substitute_item,
            greatest(0,f.usable_capacity-(select count(*)::int from recovery_grants rg where rg.fallback_id=f.id and (rg.state='redeemed' or (rg.superseded_at is null and rg.expires_at>now())))) fallback_available,
            coalesce(l.address,'') address
       from network_drop_supplies s
       join pilot_supply_terms t on t.supply_id=s.id
       join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version
       join locations l on l.id=s.location_id
       left join pilot_supply_fallbacks f on f.supply_id=s.id
      where s.organization_id=$1 and s.market_id=(select market_id from pilot_runs where id=$2)
      order by s.created_at desc limit 1`,
    [organizationId, run.id],
  );

  const perWeek = await db.query<{
    week_key: string;
    issued: number;
    redeemed: number;
  }>(
    `select r.week_key,count(*)::int issued,count(*) filter(where g.state='redeemed')::int redeemed
       from fulfillment_grants g
       join weekly_releases r on r.id=g.release_id
       join network_drop_supplies s on s.id=g.supply_id
      where r.run_id=$1 and s.organization_id=$2
      group by r.week_key`,
    [run.id, organizationId],
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
      current: weekKey === currentWeek,
      issued: row?.issued || 0,
      redeemed: row?.redeemed || 0,
      released: released.some((r) => r.week_key === weekKey),
    };
  });

  /* Anything that went wrong at this counter, and whether it was made good. */
  const incidents = await db.query<{
    id: string;
    incident_type: string;
    state: string;
    occurred_at: string;
    recovered: boolean;
  }>(
    `select i.id,i.incident_type,i.state,i.occurred_at,
            exists(select 1 from recovery_grants rg where rg.incident_id=i.id and rg.superseded_at is null) recovered
       from fulfillment_incidents i
       join fulfillment_grants g on g.id=i.grant_id
       join network_drop_supplies s on s.id=g.supply_id
       join weekly_releases r on r.id=g.release_id
      where r.run_id=$1 and s.organization_id=$2
      order by i.occurred_at desc limit 20`,
    [run.id, organizationId],
  );

  const issued = weeks.reduce((n, w) => n + w.issued, 0);
  const redeemed = weeks.reduce((n, w) => n + w.redeemed, 0);
  const activeWeek = weeks.find((w) => w.current) || null;

  return {
    organization,
    run,
    commitment: commitment || null,
    location: commitment?.address || null,
    weeks,
    activeWeek,
    totals: {
      issued,
      redeemed,
      /* Only ever "of issued". Never framed as customers or visits. */
      redemptionRate: issued ? Math.round((redeemed / issued) * 100) : null,
      /* An incident that already has a live make-good is not still "being
         resolved" from the merchant's point of view, and must not be counted
         in both figures. */
      openIncidents: incidents.filter(
        (i) => ["open", "recovering"].includes(i.state) && !i.recovered,
      ).length,
      recoveredIncidents: incidents.filter((i) => i.recovered).length,
    },
    incidents,
  };
}
