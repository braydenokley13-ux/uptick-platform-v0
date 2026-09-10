import type { DB } from "./db";
import { authorize, offerSelect, type Actor, type Offer } from "./domain";
export type SourceRow = {
  id: string;
  token: string;
  host: string;
  placement: string;
  status: string;
  state: string;
  visits: number;
  claims: number;
  redemptions: number;
  subscribers: number;
  offer_id: string;
  creative: string;
  campaign: string;
  created_at: string;
  confirmed_at: string | null;
  placement_id: string | null;
  address: string;
  offer_title: string;
  host_category: string | null;
};
export type DropHistory = {
  id: string;
  title: string;
  qualification: string;
  reward: string;
  state: string;
  starts_at: string;
  expires_at: string;
  timezone: string;
  current_version: number;
  scheduled_at: string | null;
  broadcast_state: string | null;
  prepared: number;
  delivered: number;
  redemptions: number;
  returns: number;
  review_decision: string | null;
  review_note: string | null;
};
export type Audience = {
  subscribers: number;
  pending: number;
  eligible: number;
  joined30: number;
  joined7: number;
  unsubscribed30: number;
  initial_redeemers: number;
  returners: number;
  return_redemptions: number;
  initial_joined: number;
  never_drop: number;
  observation_start: string | null;
};
export type Recommendation = {
  title: string;
  detail: string;
  action: string;
  href: string;
  tone: "mint" | "amber" | "neutral";
};
export type MerchantPlacementHistory = {
  id: string;
  status: string;
  created_at: string;
};
export async function merchantSourceContext(
  db: DB,
  actor: Actor,
  sourceId: string,
) {
  const history = await db.query<MerchantPlacementHistory>(
    `select distinct e.id,e.status,e.created_at from placement_events e join sources s on s.placement_id=e.placement_id join offers o on o.id=s.offer_id where s.id=$1 and o.organization_id=$2 order by e.created_at desc`,
    [sourceId, actor.organizationId],
  );
  const [creative] = await db.query<{
    headline: string;
    version: number;
    created_at: string;
  }>(
    `select cr.headline,cr.version,cr.created_at from source_creatives cr join sources s on s.id=cr.source_id join offers o on o.id=s.offer_id where s.id=$1 and o.organization_id=$2`,
    [sourceId, actor.organizationId],
  );
  return { history, creative };
}
export async function overview(
  db: DB,
  actor: Actor,
  organizationId = actor.organizationId,
) {
  authorize(actor, organizationId);
  const [
    organizationRows,
    offers,
    sources,
    countRows,
    audienceRows,
    dropHistory,
    activity,
  ] = await Promise.all([
    db.query<{
      id: string;
      name: string;
      timezone: string;
      is_demo: boolean;
      created_at: string;
    }>("select * from organizations where id=$1", [organizationId]),
    db.query<Offer>(
      `${offerSelect} where o.organization_id=$1 order by o.created_at desc`,
      [organizationId],
    ),
    db.query<SourceRow>(
      `select s.*,g.name host,p.name placement,p.status,p.confirmed_at,l.address,o.title offer_title,bp.category host_category,
 (select count(*)::int from source_visits v where v.source_id=s.id) visits,
 (select count(*)::int from claims c where c.source_id=s.id) claims,
 (select count(*)::int from claims c where c.source_id=s.id and c.state='redeemed') redemptions,
 (select count(*)::int from relationships r join claims c on c.id=r.acquisition_claim_id join subscriptions sub on sub.customer_id=r.customer_id and sub.organization_id=r.organization_id and sub.state='subscribed' where c.source_id=s.id) subscribers
 from sources s join offers o on o.id=s.offer_id left join placements p on p.id=s.placement_id left join locations l on l.id=p.location_id left join organizations g on g.id=l.organization_id left join business_profiles bp on bp.organization_id=g.id where o.organization_id=$1 order by s.created_at`,
      [organizationId],
    ),
    db.query<{
      claims: number;
      redemptions: number;
      subscribers: number;
      delivered: number;
      returns: number;
    }>(
      `select
 (select count(*)::int from claims where organization_id=$1) claims,
 (select count(*)::int from redemptions where organization_id=$1) redemptions,
 (select count(*)::int from subscriptions where organization_id=$1 and state='subscribed') subscribers,
 (select count(*)::int from messages where organization_id=$1 and state='delivered') delivered,
 (select count(*)::int from claims c where c.organization_id=$1 and c.state='redeemed' and c.broadcast_id is not null and exists(select 1 from claims initial join offers o on o.id=initial.offer_id where initial.customer_id=c.customer_id and initial.organization_id=c.organization_id and o.kind='anchor' and initial.state='redeemed' and initial.redeemed_at<c.redeemed_at)) returns`,
      [organizationId],
    ),
    db.query<Audience>(
      `with initial as (
 select c.customer_id,min(c.redeemed_at) first_redemption from claims c join offers o on o.id=c.offer_id where c.organization_id=$1 and o.kind='anchor' and c.state='redeemed' group by c.customer_id
 ), returns as (select c.customer_id,c.id from claims c join initial i on i.customer_id=c.customer_id where c.organization_id=$1 and c.broadcast_id is not null and c.state='redeemed' and c.redeemed_at>i.first_redemption), first_join as (
 select customer_id,min(created_at) joined_at from consent_events where organization_id=$1 and purpose='merchant' and accepted group by customer_id
 ) select
 (select count(*)::int from subscriptions where organization_id=$1 and state='subscribed') subscribers,
 (select count(*)::int from subscriptions where organization_id=$1 and state='pending') pending,
 (select count(*)::int from subscriptions s join relationships r on r.customer_id=s.customer_id and r.organization_id=s.organization_id join customers c on c.id=s.customer_id where s.organization_id=$1 and s.state='subscribed' and r.possession_confirmed_at is not null and not exists(select 1 from suppressions x join senders snd on snd.id=x.sender_id where snd.organization_id=$1 and x.phone=c.phone and x.suppressed)) eligible,
 (select count(*)::int from first_join f join subscriptions s on s.customer_id=f.customer_id and s.organization_id=$1 and s.state='subscribed' where f.joined_at>=now()-interval '30 days') joined30,
 (select count(*)::int from first_join f join subscriptions s on s.customer_id=f.customer_id and s.organization_id=$1 and s.state='subscribed' where f.joined_at>=now()-interval '7 days') joined7,
 (select count(distinct customer_id)::int from consent_events where organization_id=$1 and purpose='merchant' and not accepted and source_ui in ('preferences','twilio-inbound') and created_at>=now()-interval '30 days') unsubscribed30,
 (select count(*)::int from initial) initial_redeemers,
 (select count(distinct customer_id)::int from returns) returners,
 (select count(*)::int from returns) return_redemptions,
 (select count(*)::int from initial i where exists(select 1 from subscriptions s where s.customer_id=i.customer_id and s.organization_id=$1 and s.state='subscribed')) initial_joined,
 (select count(*)::int from subscriptions s where s.organization_id=$1 and s.state='subscribed' and not exists(select 1 from claims c where c.organization_id=$1 and c.customer_id=s.customer_id and c.broadcast_id is not null and c.state='redeemed')) never_drop,
 (select min(first_redemption) from initial) observation_start`,
      [organizationId],
    ),
    db.query<DropHistory>(
      `select o.id,o.title,o.state,o.current_version,v.qualification,v.reward,v.starts_at,v.expires_at,g.timezone,b.scheduled_at,b.state broadcast_state,
 (select count(*)::int from messages m where m.broadcast_id=b.id) prepared,
 (select count(*)::int from messages m where m.broadcast_id=b.id and m.state='delivered') delivered,
 (select count(*)::int from claims c where c.broadcast_id=b.id and c.state='redeemed') redemptions,
 (select count(*)::int from claims c where c.broadcast_id=b.id and c.state='redeemed' and exists(select 1 from claims first join offers ao on ao.id=first.offer_id where first.organization_id=o.organization_id and first.customer_id=c.customer_id and first.state='redeemed' and ao.kind='anchor' and first.redeemed_at<c.redeemed_at)) returns,
 (select decision from offer_reviews r where r.offer_id=o.id and r.offer_version=o.current_version order by r.created_at desc limit 1) review_decision,
 (select note from offer_reviews r where r.offer_id=o.id and r.offer_version=o.current_version order by r.created_at desc limit 1) review_note
 from offers o join offer_versions v on v.offer_id=o.id and v.version=o.current_version join organizations g on g.id=o.organization_id left join broadcasts b on b.offer_id=o.id where o.organization_id=$1 and o.kind='drop' order by v.starts_at desc`,
      [organizationId],
    ),
    db.query<{
      id: string;
      action: string;
      entity_id: string;
      created_at: string;
      detail: Record<string, unknown>;
    }>(
      `select id,action,entity_id,created_at,detail from audit_events where organization_id=$1 and actor <> $2
 union select distinct e.id,'placement.updated' action,e.placement_id entity_id,e.created_at,jsonb_build_object('status',e.status) detail from placement_events e join sources s on s.placement_id=e.placement_id join offers o on o.id=s.offer_id where o.organization_id=$1
 order by created_at desc limit 40`,
      [organizationId, "customer"],
    ),
  ]);
  const organization = organizationRows[0];
  if (!organization) throw Error("Business not found.");
  const counts = countRows[0],
    audience = audienceRows[0];
  const data = {
    asOf: new Date().toISOString(),
    organization,
    offers,
    sources,
    counts,
    audience,
    dropHistory,
    activity,
    visits: sources.reduce((sum, x) => sum + x.visits, 0),
    sourceClaims: sources.reduce((sum, x) => sum + x.claims, 0),
    sourceRedemptions: sources.reduce((sum, x) => sum + x.redemptions, 0),
  };
  return { ...data, recommendations: recommendations(data) };
}
function recommendations(data: {
  offers: Offer[];
  sources: SourceRow[];
  audience: Audience;
  dropHistory: DropHistory[];
}): Recommendation[] {
  const result: Recommendation[] = [];
  const anchor = data.offers.find(
    (o) =>
      o.kind === "anchor" &&
      o.state === "live" &&
      new Date(o.starts_at) <= new Date() &&
      new Date(o.expires_at) > new Date(),
  );
  const pending = data.sources.filter(
    (s) =>
      s.state === "active" &&
      ![
        "confirmed",
        "external_confirmed",
        "externally_confirmed",
        "paused",
      ].includes(s.status),
  );
  const draft = data.dropHistory.find((d) => d.state === "draft");
  const activeDrop = data.dropHistory.find(
    (d) =>
      ["review", "scheduled", "live"].includes(d.state) &&
      new Date(d.expires_at) > new Date(),
  );
  if (!anchor)
    result.push({
      title: "Give your neighborhood a first reason to visit.",
      detail:
        "Your Growth Plan needs an active Anchor. Uptick can set up the offer and its host placements.",
      action: "Review your Growth Plan",
      href: "/merchant/plan",
      tone: "amber",
    });
  if (draft)
    result.push({
      title:
        draft.review_decision === "returned"
          ? "Your Drop has feedback from Uptick."
          : "Your next Drop is taking shape.",
      detail:
        draft.review_note ||
        `Finish “${draft.title}” so Uptick can review the offer and timing.`,
      action: "Open your draft",
      href: `/merchant/create?id=${draft.id}`,
      tone: "mint",
    });
  else if (!activeDrop)
    result.push({
      title: "Give them a reason to come back this week.",
      detail:
        "There is no upcoming Drop in review or on the schedule. Start with a simple purchase and a free extra.",
      action: "Create a Weekly Drop",
      href: "/merchant/create",
      tone: "mint",
    });
  if (pending.length)
    result.push({
      title: `${pending.length} placement${pending.length === 1 ? " is" : "s are"} awaiting confirmation.`,
      detail:
        "Uptick has recorded the intended placement. Screen handoff still needs confirmation.",
      action: "See your Local Network",
      href: "/merchant/network",
      tone: "amber",
    });
  const oldQuiet = data.sources.find(
    (s) =>
      s.state === "active" &&
      s.status === "confirmed" &&
      new Date(s.created_at).getTime() < Date.now() - 14 * 86400000 &&
      s.claims === 0,
  );
  if (oldQuiet)
    result.push({
      title: `Check the placement at ${oldQuiet.host}.`,
      detail:
        "This source is at least 14 days old and has no accepted claims. Ask Uptick to check the creative and placement; this does not prove no one saw it.",
      action: "Review the placement",
      href: `/merchant/network?id=${oldQuiet.id}`,
      tone: "amber",
    });
  if (
    anchor &&
    new Date(anchor.starts_at).getTime() < Date.now() - 30 * 86400000
  )
    result.push({
      title: "Your Anchor is ready for a creative check.",
      detail:
        "The current offer window began over 30 days ago. Review the message with Uptick while keeping a useful offer in place.",
      action: "Review your Anchor",
      href: "/merchant/anchor",
      tone: "neutral",
    });
  const ranked = [...data.sources].sort(
    (a, b) => b.redemptions - a.redemptions,
  );
  if (
    ranked[0]?.redemptions >= 5 &&
    ranked[0].redemptions > (ranked[1]?.redemptions || 0)
  )
    result.push({
      title: `${ranked[0].host} leads recorded redemptions.`,
      detail: `${ranked[0].redemptions} recorded redemptions are linked to this source. Different exposure and running periods mean this is not a controlled comparison.`,
      action: "See placement activity",
      href: `/merchant/network?id=${ranked[0].id}`,
      tone: "neutral",
    });
  const previous = data.dropHistory.filter(
    (d) => d.broadcast_state === "complete",
  );
  if (
    previous.length >= 2 &&
    previous[0].reward.toLowerCase() === previous[1].reward.toLowerCase()
  )
    result.push({
      title: "Try another free extra next time.",
      detail:
        "Your two most recent completed Drops used the same reward. A different item would add a useful comparison.",
      action: "Explore offer templates",
      href: "/merchant/create",
      tone: "neutral",
    });
  if (data.audience.returners < 10)
    result.push({
      title: "Still learning what brings people back.",
      detail: `${data.audience.returners} customers have a recorded return after an initial Anchor redemption. Keep the loop running before drawing comparisons.`,
      action: "See the Uptick Loop",
      href: "/merchant/loop",
      tone: "neutral",
    });
  if (!result.length)
    result.push({
      title: "Your next steps are in place.",
      detail:
        "Your Anchor is active and a Drop is in review, scheduled, or live. Review the recorded response before changing the offer.",
      action: "Review results",
      href: "/merchant/results",
      tone: "neutral",
    });
  return result;
}
