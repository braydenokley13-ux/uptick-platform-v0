import { z } from "zod";
import type { DB } from "./db";
import {
  authorize,
  audit,
  offerSelect,
  type Actor,
  type Offer,
} from "./domain";
import { id } from "./security";
import { RequestError } from "./http";
import { supplyUsage } from "./network";

export const growthObjectives = [
  ["store_visits", "More store visits"],
  ["morning_traffic", "Busier mornings"],
  ["afternoon_traffic", "Busier afternoons"],
  ["trial", "Trial of a product"],
  ["repeat_visits", "More return visits"],
] as const;
const amount = z.number().min(0).max(1000000).multipleOf(0.01).nullable();
const verification = z.enum(["staff_tap", "public_tap", "self_confirm"]);
export type GrowthPreferences = {
  objective: string;
  objective_note: string;
  fixed_fee_budget: number | null;
  reward_spend_cap: number | null;
  verification_preference: string;
};
export async function saveGrowthPreferences(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  const data = z
    .object({
      organizationId: z.string().min(1),
      objective: z.enum([
        "store_visits",
        "morning_traffic",
        "afternoon_traffic",
        "trial",
        "repeat_visits",
      ]),
      objectiveNote: z.string().trim().max(1000),
      fixedFeeBudget: amount,
      rewardSpendCap: amount,
      verificationPreference: verification,
    })
    .parse(raw);
  authorize(actor, data.organizationId);
  await db.transaction(async (tx) => {
    await tx.query(
      "insert into merchant_growth_preferences(organization_id,objective,objective_note,fixed_fee_budget,reward_spend_cap,verification_preference,updated_by) values($1,$2,$3,$4,$5,$6,$7) on conflict(organization_id) do update set objective=excluded.objective,objective_note=excluded.objective_note,fixed_fee_budget=excluded.fixed_fee_budget,reward_spend_cap=excluded.reward_spend_cap,verification_preference=excluded.verification_preference,updated_by=excluded.updated_by,updated_at=now()",
      [
        data.organizationId,
        data.objective,
        data.objectiveNote.trim(),
        data.fixedFeeBudget,
        data.rewardSpendCap,
        data.verificationPreference,
        actor.id,
      ],
    );
    await audit(
      tx,
      actor.id,
      data.organizationId,
      "growth.preferences_saved",
      data.organizationId,
      { ...data, amountsArePlanningInputs: true },
    );
  });
}

export async function requestGrowthSupply(db: DB, actor: Actor, raw: unknown) {
  const data = z
    .object({
      offerId: z.string().min(1),
      marketId: z.string().min(1),
      startsAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      inventoryPolicy: z.enum(["unlimited", "redemption", "claim", "timed"]),
      quantity: z.number().int().positive().max(1000000).nullable(),
      reservationMinutes: z.number().int().min(5).max(10080).nullable(),
      verificationPreference: verification,
      staffInstructions: z.string().trim().min(10).max(1500),
      fallbackPlan: z.string().trim().max(1500),
      rewardCost: amount,
      fixedFeeBudget: amount,
      rewardSpendCap: amount,
      submit: z.boolean(),
    })
    .parse(raw);
  if (
    new Date(data.expiresAt) <= new Date(data.startsAt) ||
    new Date(data.expiresAt) <= new Date()
  )
    throw new RequestError(
      "Choose a future Drop window with the end after its start.",
    );
  if (data.inventoryPolicy !== "unlimited" && !data.quantity)
    throw new RequestError("Choose a whole-number quantity for this Drop.");
  if (data.inventoryPolicy === "timed" && !data.reservationMinutes)
    throw new RequestError("Choose how many minutes the reservation lasts.");
  if (data.rewardSpendCap !== null) {
    if (
      data.rewardCost === null ||
      data.inventoryPolicy === "unlimited" ||
      !data.quantity
    )
      throw new RequestError(
        "A reward budget needs a per-item cost and a fixed quantity.",
      );
    if (
      Math.round(data.rewardCost * 100) * data.quantity >
      Math.round(data.rewardSpendCap * 100)
    )
      throw new RequestError(
        "The item cost and quantity exceed your reward budget. Reduce the quantity or update the budget.",
      );
  }
  return db.transaction(async (tx) => {
    const [offer] = await tx.query<Offer>(
      `${offerSelect} where o.id=$1 for update of o`,
      [data.offerId],
    );
    if (!offer)
      throw new RequestError("Choose a saved offer from Offer Studio.");
    authorize(actor, offer.organization_id);
    if (offer.kind !== "drop" || !["draft", "review"].includes(offer.state))
      throw new RequestError(
        "Choose a draft Drop. Published promises need a new offer.",
      );
    if (!/\bfree\b/i.test(offer.reward))
      throw new RequestError(
        "Name the free item in Offer Studio before submitting this Drop.",
      );
    const [market] = await tx.query(
      "select market_id from market_locations where market_id=$1 and location_id=$2 and organization_id=$3 and active=true",
      [data.marketId, offer.location_id, offer.organization_id],
    );
    if (!market)
      throw new RequestError(
        "Uptick must connect this store to the selected market first.",
      );
    if (
      (
        await tx.query(
          "select id from broadcasts where offer_id=$1 union all select id from claims where offer_id=$1",
          [offer.id],
        )
      ).length
    )
      throw new RequestError(
        "This offer already has a campaign or issued pass. Create a new Drop.",
      );
    const [existing] = await tx.query<{
      id: string;
      state: string;
      market_id: string;
    }>(
      "select id,state,market_id from network_drop_supplies where offer_id=$1 for update",
      [offer.id],
    );
    if (
      existing &&
      (!["draft", "review"].includes(existing.state) ||
        existing.market_id !== data.marketId)
    )
      throw new RequestError(
        "The approved plan or original market cannot be changed. Create a new Drop.",
      );
    const version = offer.current_version + 1;
    await tx.query(
      "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity) select offer_id,$2,qualification,reward,terms,$3,$4,$5,$6 from offer_versions where offer_id=$1 and version=$7",
      [
        offer.id,
        version,
        data.startsAt,
        data.expiresAt,
        data.inventoryPolicy === "unlimited"
          ? "unlimited"
          : data.inventoryPolicy === "redemption"
            ? "redemption"
            : "claim",
        data.inventoryPolicy === "unlimited" ? null : data.quantity,
        offer.current_version,
      ],
    );
    await tx.query(
      "insert into offer_product_metadata(offer_id,version,goal,template_id,customer_value,reward_cost,required_purchase,staff_instructions) select $1,$2,coalesce(m.goal,'return'),m.template_id,m.customer_value,$3,m.required_purchase,$4 from (select 1) x left join offer_product_metadata m on m.offer_id=$1 and m.version=$5",
      [
        offer.id,
        version,
        data.rewardCost,
        data.staffInstructions.trim(),
        offer.current_version,
      ],
    );
    await tx.query(
      "update offers set current_version=$2,state=$3 where id=$1",
      [offer.id, version, data.submit ? "review" : "draft"],
    );
    const supplyId = existing?.id || id();
    await tx.query(
      "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,reservation_minutes,verification_mode,self_confirm_approved,staff_instructions,fallback_plan,funding_source,growth_fee,spend_cap) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14,$15,'merchant',$16,$17) on conflict(id) do update set offer_version=excluded.offer_version,state=excluded.state,starts_at=excluded.starts_at,expires_at=excluded.expires_at,inventory_policy=excluded.inventory_policy,quantity=excluded.quantity,reservation_minutes=excluded.reservation_minutes,verification_mode=excluded.verification_mode,self_confirm_approved=false,staff_instructions=excluded.staff_instructions,fallback_plan=excluded.fallback_plan,growth_fee=excluded.growth_fee,spend_cap=excluded.spend_cap",
      [
        supplyId,
        data.marketId,
        offer.organization_id,
        offer.location_id,
        offer.id,
        version,
        data.submit ? "review" : "draft",
        data.startsAt,
        data.expiresAt,
        data.inventoryPolicy,
        data.inventoryPolicy === "unlimited" ? null : data.quantity,
        data.inventoryPolicy === "timed" ? data.reservationMinutes : null,
        data.verificationPreference,
        data.staffInstructions.trim(),
        data.fallbackPlan.trim(),
        data.fixedFeeBudget,
        data.rewardSpendCap,
      ],
    );
    await audit(
      tx,
      actor.id,
      offer.organization_id,
      data.submit ? "growth.drop_requested" : "growth.drop_saved",
      supplyId,
      { ...data, offerVersion: version, approvalRequired: true },
    );
    return supplyId;
  });
}

export type GrowthSupply = {
  id: string;
  offer_id: string;
  market_id: string;
  offer_version: number;
  state: string;
  title: string;
  reward: string;
  qualification: string;
  starts_at: string;
  expires_at: string;
  inventory_policy: string;
  quantity: number | null;
  verification_mode: string;
  self_confirm_approved: boolean;
  staff_instructions: string;
  fallback_plan: string;
  growth_fee: number | null;
  spend_cap: number | null;
  reward_cost: number | null;
  reservation_minutes: number | null;
  market: string;
  location: string;
  claims: number;
  redemptions: number;
  allocated: number;
  usage: Awaited<ReturnType<typeof supplyUsage>>;
};
export type GrowthMarket = {
  id: string;
  name: string;
  state: string;
  boundary_note: string;
  members: number;
  partners: number;
  locations: number;
};
export async function merchantGrowth(db: DB, actor: Actor) {
  const org = actor.organizationId;
  authorize(actor, org);
  const [
    organizations,
    plans,
    markets,
    supplies,
    drafts,
    metrics,
    points,
    channels,
    activity,
  ] = await Promise.all([
    db.query<{ id: string; name: string; timezone: string; is_demo: boolean }>(
      "select id,name,timezone,is_demo from organizations where id=$1",
      [org],
    ),
    db.query<GrowthPreferences>(
      "select objective,objective_note,fixed_fee_budget,reward_spend_cap,verification_preference from merchant_growth_preferences where organization_id=$1",
      [org],
    ),
    db.query<GrowthMarket>(
      "select m.id,m.name,m.state,m.boundary_note,(select count(*)::int from uptick_members u where u.market_id=m.id and u.state='active' and u.verified_at is not null and (select c.accepted from member_consents c where c.member_id=u.id order by c.sequence desc limit 1)=true) members,(select count(*)::int from partner_markets pm join acquisition_partners p on p.id=pm.partner_id where pm.market_id=m.id and p.state='active') partners,(select count(*)::int from market_locations ml where ml.market_id=m.id and ml.active=true) locations from market_cells m where exists(select 1 from market_locations ml where ml.market_id=m.id and ml.organization_id=$1 and ml.active=true) order by m.name",
      [org],
    ),
    db.query<Omit<GrowthSupply, "usage">>(
      "select s.*,o.title,v.reward,v.qualification,pm.reward_cost,m.name market,l.name location,(select count(*)::int from member_claims mc where mc.supply_id=s.id) claims,(select count(*)::int from member_claims mc join claims c on c.id=mc.claim_id where mc.supply_id=s.id and c.state='redeemed') redemptions,(select count(*)::int from allocation_options a where a.supply_id=s.id) allocated from network_drop_supplies s join offers o on o.id=s.offer_id join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version left join offer_product_metadata pm on pm.offer_id=s.offer_id and pm.version=s.offer_version join market_cells m on m.id=s.market_id join locations l on l.id=s.location_id where s.organization_id=$1 order by s.starts_at desc,s.created_at desc",
      [org],
    ),
    db.query<
      Offer & { reward_cost: number | null; staff_instructions: string }
    >(
      `select base.*,pm.reward_cost,coalesce(pm.staff_instructions,'') staff_instructions from (${offerSelect}) base left join offer_product_metadata pm on pm.offer_id=base.id and pm.version=base.current_version where base.organization_id=$1 and base.kind='drop' and base.state in ('draft','review') and not exists(select 1 from network_drop_supplies s where s.offer_id=base.id and s.approved_by is not null) order by base.created_at desc`,
      [org],
    ),
    db.query<{
      claims: number;
      redemptions: number;
      visitors: number;
      returns: number;
      qr: number;
      secure: number;
      self_reported: number;
      overrides: number;
      allocated: number;
    }>(
      "select count(*)::int claims,count(*) filter(where c.state='redeemed')::int redemptions,count(distinct mc.member_id) filter(where c.state='redeemed')::int visitors,(select count(*)::int from (select mc2.member_id from member_claims mc2 join claims c2 on c2.id=mc2.claim_id where mc2.organization_id=$1 and c2.state='redeemed' group by mc2.member_id having count(*)>1) r) returns,count(*) filter(where e.method='qr')::int qr,count(*) filter(where e.method='secure_nfc')::int secure,count(*) filter(where e.method='self_confirm')::int self_reported,count(*) filter(where e.method='operator_override')::int overrides,(select count(*)::int from allocation_options a join network_drop_supplies s on s.id=a.supply_id where s.organization_id=$1) allocated from member_claims mc join claims c on c.id=mc.claim_id left join redemption_evidence e on e.claim_id=c.id where mc.organization_id=$1",
      [org],
    ),
    db.query<{
      id: string;
      name: string;
      exposure: string;
      state: string;
      location: string;
    }>(
      "select p.id,p.name,p.exposure,p.state,l.name location from redemption_points p join locations l on l.id=p.location_id where p.organization_id=$1 order by p.created_at",
      [org],
    ),
    db.query<{ channel: string; partners: number; sources: number }>(
      "select s.channel,count(distinct s.partner_id)::int partners,count(*)::int sources from acquisition_sources s where s.state='active' and exists(select 1 from market_locations ml where ml.market_id=s.market_id and ml.organization_id=$1 and ml.active=true) group by s.channel order by s.channel",
      [org],
    ),
    db.query<{ id: string; action: string; created_at: string }>(
      "select id,action,created_at from audit_events where organization_id=$1 and (action like 'growth.%' or action like 'network_supply%' or action='redemption.tap_completed') order by created_at desc limit 16",
      [org],
    ),
  ]);
  if (!organizations[0])
    throw new RequestError("Merchant workspace not found.", 404);
  const enriched: GrowthSupply[] = await Promise.all(
    supplies.map(async (supply) => ({
      ...supply,
      usage: await supplyUsage(db, supply.id),
    })),
  );
  return {
    organization: organizations[0],
    plan: plans[0] || {
      objective: "store_visits",
      objective_note: "",
      fixed_fee_budget: null,
      reward_spend_cap: null,
      verification_preference: "staff_tap",
    },
    markets,
    supplies: enriched,
    drafts,
    metrics: metrics[0],
    points,
    channels,
    activity,
    asOf: new Date().toISOString(),
  };
}
export type MerchantGrowth = Awaited<ReturnType<typeof merchantGrowth>>;
