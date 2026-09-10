import { z } from "zod";
import type { DB } from "./db";
import {
  audit,
  authorize,
  offerSelect,
  rateLimit,
  weekKey,
  type Actor,
  type Offer,
} from "./domain";
import { RequestError } from "./http";
import { id, token, hash, normalizePhone } from "./security";
import { allocateMember, marketCoverage, supplyUsage } from "./network";
import { prepareMembershipWeek } from "./member-experience";
import {
  configureMemberSender,
  dispatchMemberMessages,
  memberMessagingReadiness,
} from "./member-messaging";

const text = (max = 200) => z.string().trim().max(max);
const optionalNumber = (minimum: number, maximum: number) =>
  z.preprocess(
    (value) =>
      value === "" || value === undefined || value === null
        ? null
        : Number(value),
    z.number().min(minimum).max(maximum).nullable(),
  );
const yes = z.preprocess(
  (value) => value === true || value === "on" || value === "true",
  z.boolean(),
);
const nullableId = text(100)
  .nullish()
  .transform((value) => value || null);
const coordinate = {
  latitude: optionalNumber(-90, 90),
  longitude: optionalNumber(-180, 180),
};
function requireOperator(actor: Actor) {
  authorize(actor, actor.organizationId, true);
}
function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new RequestError(
      "Choose a valid time zone, such as America/New_York.",
    );
  }
}
function zipList(raw: string) {
  const zips = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  if (
    !zips.length ||
    zips.length > 100 ||
    zips.some((zip) => !/^\d{5}$/.test(zip))
  )
    throw new RequestError(
      "Add one to 100 five-digit ZIP codes, separated by commas.",
    );
  return zips;
}
function pairedCoordinates(latitude: number | null, longitude: number | null) {
  if ((latitude === null) !== (longitude === null))
    throw new RequestError(
      "Enter both latitude and longitude, or leave both blank.",
    );
}
export async function saveMarket(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const data = z
    .object({
      id: nullableId,
      name: text(120).min(3),
      slug: text(80)
        .min(3)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      timezone: text(80).min(3),
      state: z.enum(["draft", "building", "pilot", "live", "paused"]),
      boundaryNote: text(1500).min(10),
      zips: text(1200).min(5),
      ...coordinate,
    })
    .parse(raw);
  validTimezone(data.timezone);
  pairedCoordinates(data.latitude, data.longitude);
  const zips = zipList(data.zips),
    marketId = data.id || id();
  await db.transaction(async (tx) => {
    if (
      data.id &&
      !(
        await tx.query("select id from market_cells where id=$1 for update", [
          data.id,
        ])
      ).length
    )
      throw new RequestError("Market not found.");
    await tx.query(
      `insert into market_cells(id,name,slug,timezone,state,boundary_note,center_latitude,center_longitude) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do update set name=excluded.name,slug=excluded.slug,timezone=excluded.timezone,state=excluded.state,boundary_note=excluded.boundary_note,center_latitude=excluded.center_latitude,center_longitude=excluded.center_longitude`,
      [
        marketId,
        data.name,
        data.slug,
        data.timezone,
        data.state,
        data.boundaryNote,
        data.latitude,
        data.longitude,
      ],
    );
    await tx.query("delete from market_zips where market_id=$1", [marketId]);
    for (const zip of zips)
      await tx.query("insert into market_zips(market_id,zip) values($1,$2)", [
        marketId,
        zip,
      ]);
    await audit(
      tx,
      actor.id,
      null,
      data.id ? "market_updated" : "market_created",
      marketId,
      { ...data, zips, readinessStateIsManual: true },
    );
  });
  return marketId;
}
export async function saveMarketLocation(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const data = z
    .object({
      marketId: text(100).min(1),
      locationId: text(100).min(1),
      postalCode: text(5).regex(/^\d{5}$/),
      driveMinutes: optionalNumber(1, 180),
      active: yes,
      ...coordinate,
    })
    .parse(raw);
  pairedCoordinates(data.latitude, data.longitude);
  if (data.driveMinutes !== null && !Number.isInteger(data.driveMinutes))
    throw new RequestError(
      "Use a whole number of minutes for the manual estimate.",
    );
  await db.transaction(async (tx) => {
    const [location] = await tx.query<{
      organization_id: string;
      capabilities: string[];
    }>(
      "select l.organization_id,g.capabilities from locations l join organizations g on g.id=l.organization_id where l.id=$1 for update of l",
      [data.locationId],
    );
    if (!location || !location.capabilities.includes("merchant"))
      throw new RequestError("Choose a merchant location.");
    await tx.query(
      "update locations set postal_code=$2,latitude=$3,longitude=$4 where id=$1",
      [data.locationId, data.postalCode, data.latitude, data.longitude],
    );
    await tx.query(
      `insert into market_locations(market_id,location_id,organization_id,drive_minutes,active) values($1,$2,$3,$4,$5) on conflict(market_id,location_id) do update set drive_minutes=excluded.drive_minutes,active=excluded.active`,
      [
        data.marketId,
        data.locationId,
        location.organization_id,
        data.driveMinutes,
        data.active,
      ],
    );
    await audit(
      tx,
      actor.id,
      location.organization_id,
      "market_location_saved",
      data.locationId,
      { ...data, driveMinutesEvidence: "manual_estimate" },
    );
  });
}
export async function savePartner(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const data = z
    .object({
      id: nullableId,
      marketId: text(100).min(1),
      name: text(150).min(2),
      kind: text(80).min(2),
      state: z.enum(["active", "paused"]),
      agreementNote: text(1500),
      address: text(300),
      ...coordinate,
    })
    .parse(raw);
  pairedCoordinates(data.latitude, data.longitude);
  const partnerId = data.id || id();
  await db.transaction(async (tx) => {
    if (
      data.id &&
      !(
        await tx.query(
          "select id from acquisition_partners where id=$1 for update",
          [data.id],
        )
      ).length
    )
      throw new RequestError("Partner not found.");
    await tx.query(
      `insert into acquisition_partners(id,name,kind,state,agreement_note,address,latitude,longitude) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do update set name=excluded.name,kind=excluded.kind,state=excluded.state,agreement_note=excluded.agreement_note,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude`,
      [
        partnerId,
        data.name,
        data.kind,
        data.state,
        data.agreementNote,
        data.address,
        data.latitude,
        data.longitude,
      ],
    );
    await tx.query(
      "insert into partner_markets(partner_id,market_id) values($1,$2) on conflict do nothing",
      [partnerId, data.marketId],
    );
    await audit(
      tx,
      actor.id,
      null,
      data.id ? "acquisition_partner_updated" : "acquisition_partner_created",
      partnerId,
      data,
    );
  });
  return partnerId;
}
export async function saveAcquisitionSource(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  requireOperator(actor);
  const data = z
    .object({
      id: nullableId,
      marketId: text(100).min(1),
      partnerId: nullableId,
      name: text(150).min(2),
      channel: text(80).min(2),
      campaign: text(180).min(2),
      cost: optionalNumber(0, 10000000),
      state: z.enum(["active", "paused"]),
    })
    .parse(raw);
  const sourceId = data.id || id();
  await db.transaction(async (tx) => {
    if (data.id) {
      const [existing] = await tx.query<{
        market_id: string;
        partner_id: string | null;
        channel: string;
        campaign: string;
      }>(
        "select market_id,partner_id,channel,campaign from acquisition_sources where id=$1 for update",
        [data.id],
      );
      if (!existing) throw new RequestError("Acquisition source not found.");
      if (
        existing.market_id !== data.marketId ||
        existing.partner_id !== data.partnerId
      )
        throw new RequestError(
          "Keep the source's original market and partner. Create a new source for different attribution.",
        );
      if (
        existing.channel !== data.channel ||
        existing.campaign !== data.campaign
      )
        throw new RequestError(
          "Keep the source's original channel and campaign so past acquisition remains truthful. Create a new source for a new campaign.",
        );
      await tx.query(
        "update acquisition_sources set name=$2,channel=$3,campaign=$4,cost=$5,state=$6 where id=$1",
        [
          data.id,
          data.name,
          data.channel,
          data.campaign,
          data.cost,
          data.state,
        ],
      );
    } else {
      await tx.query(
        "insert into acquisition_sources(id,market_id,partner_id,token,name,channel,campaign,cost,state) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          sourceId,
          data.marketId,
          data.partnerId,
          token(),
          data.name,
          data.channel,
          data.campaign,
          data.cost,
          data.state,
        ],
      );
    }
    await audit(
      tx,
      actor.id,
      null,
      data.id ? "acquisition_source_updated" : "acquisition_source_created",
      sourceId,
      data,
    );
  });
  return sourceId;
}
const supplyInput = z.object({
  id: nullableId,
  marketId: text(100).min(1),
  offerId: text(100).min(1),
  inventoryPolicy: z.enum(["unlimited", "redemption", "claim", "timed"]),
  quantity: optionalNumber(1, 1000000),
  reservationMinutes: optionalNumber(5, 10080),
  verificationMode: z.enum(["staff_tap", "public_tap", "self_confirm"]),
  selfConfirmApproved: yes,
  staffInstructions: text(2000).min(10),
  fallbackPlan: text(1500),
  fundingSource: z.enum(["merchant", "uptick", "partner", "brand"]),
  shareable: yes,
  referralCap: z.coerce.number().int().min(0).max(100),
  growthFee: optionalNumber(0, 10000000),
  spendCap: optionalNumber(0, 10000000),
  submit: yes,
});
export async function saveSupply(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const data = supplyInput.parse(raw),
    supplyId = data.id || id();
  if (
    data.inventoryPolicy !== "unlimited" &&
    (data.quantity === null || !Number.isInteger(data.quantity))
  )
    throw new RequestError(
      "Capped Drops need a positive whole-number quantity.",
    );
  if (
    data.inventoryPolicy === "timed" &&
    (data.reservationMinutes === null ||
      !Number.isInteger(data.reservationMinutes))
  )
    throw new RequestError(
      "Set a whole-number reservation window of five minutes to seven days.",
    );
  if (data.shareable && data.referralCap < 1)
    throw new RequestError(
      "A shareable Drop needs at least one permitted referral join.",
    );
  await db.transaction(async (tx) => {
    const [offer] = await tx.query<Offer>(
      `${offerSelect} where o.id=$1 for update of o`,
      [data.offerId],
    );
    if (!offer || offer.kind !== "drop")
      throw new RequestError("Choose a saved Weekly Drop from Offer Studio.");
    if (
      (
        await tx.query(
          "select id from broadcasts where offer_id=$1 union all select id from claims where offer_id=$1 and not exists(select 1 from member_claims mc where mc.claim_id=claims.id)",
          [offer.id],
        )
      ).length
    )
      throw new RequestError(
        "This offer already belongs to a legacy campaign or issued pass. Create a new Drop for Uptick membership supply.",
      );
    if (!/\bfree\b/i.test(offer.reward))
      throw new RequestError("An Uptick Drop must name a free reward.");
    if (
      !(
        await tx.query(
          "select location_id from market_locations where market_id=$1 and location_id=$2 and organization_id=$3 and active=true",
          [data.marketId, offer.location_id, offer.organization_id],
        )
      ).length
    )
      throw new RequestError(
        "Connect this merchant location to the market before adding its Drop.",
      );
    if (data.id) {
      const [existing] = await tx.query<{
        offer_id: string;
        market_id: string;
        state: string;
      }>(
        "select offer_id,market_id,state from network_drop_supplies where id=$1 for update",
        [data.id],
      );
      if (!existing) throw new RequestError("Drop supply not found.");
      if (
        existing.offer_id !== data.offerId ||
        existing.market_id !== data.marketId
      )
        throw new RequestError("Keep this supply's original offer and market.");
      if (!["draft", "review"].includes(existing.state))
        throw new RequestError(
          "Approved Drop promises are fixed. Adjust inventory or pause this Drop, or create a new offer.",
        );
    }
    await tx.query(
      `insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,reservation_minutes,verification_mode,self_confirm_approved,staff_instructions,fallback_plan,funding_source,shareable,referral_cap,growth_fee,spend_cap) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) on conflict(id) do update set offer_version=excluded.offer_version,state=excluded.state,starts_at=excluded.starts_at,expires_at=excluded.expires_at,inventory_policy=excluded.inventory_policy,quantity=excluded.quantity,reservation_minutes=excluded.reservation_minutes,verification_mode=excluded.verification_mode,self_confirm_approved=excluded.self_confirm_approved,staff_instructions=excluded.staff_instructions,fallback_plan=excluded.fallback_plan,funding_source=excluded.funding_source,shareable=excluded.shareable,referral_cap=excluded.referral_cap,growth_fee=excluded.growth_fee,spend_cap=excluded.spend_cap`,
      [
        supplyId,
        data.marketId,
        offer.organization_id,
        offer.location_id,
        offer.id,
        offer.current_version,
        data.submit ? "review" : "draft",
        offer.starts_at,
        offer.expires_at,
        data.inventoryPolicy,
        data.inventoryPolicy === "unlimited" ? null : data.quantity,
        data.inventoryPolicy === "timed" ? data.reservationMinutes : null,
        data.verificationMode,
        data.selfConfirmApproved,
        data.staffInstructions,
        data.fallbackPlan,
        data.fundingSource,
        data.shareable,
        data.referralCap,
        data.growthFee,
        data.spendCap,
      ],
    );
    await audit(
      tx,
      actor.id,
      offer.organization_id,
      data.id ? "network_supply_updated" : "network_supply_created",
      supplyId,
      {
        ...data,
        offerVersion: offer.current_version,
        startsAt: offer.starts_at,
        expiresAt: offer.expires_at,
      },
    );
  });
  return supplyId;
}
export async function approveSupply(db: DB, actor: Actor, supplyId: string) {
  requireOperator(actor);
  await db.transaction(async (tx) => {
    const [supply] = await tx.query<SupplyRow>(
      `${supplySelect} where s.id=$1 for update of s`,
      [supplyId],
    );
    if (!supply || supply.state !== "review")
      throw new RequestError(
        "Submit this Drop supply for review before approval.",
      );
    if (supply.offer_version !== supply.current_offer_version)
      throw new RequestError(
        "This offer changed after its supply was submitted. Save the supply again to review the latest offer version before approval.",
      );
    await assertSupplyTapReady(tx, supply);
    if (new Date(supply.expires_at).getTime() <= Date.now())
      throw new RequestError(
        "This Drop has already expired. Create a new offer window.",
      );
    if (
      supply.verification_mode === "self_confirm" &&
      !supply.self_confirm_approved
    )
      throw new RequestError(
        "Explicitly approve self-confirmation before using this verification policy.",
      );
    if (
      supply.verification_mode === "public_tap" &&
      supply.fallback_plan.trim().length < 10
    )
      throw new RequestError(
        "Add a staff fallback plan for the public redemption point.",
      );
    if (
      !/\bfree\b/i.test(supply.reward) ||
      supply.staff_instructions.trim().length < 10
    )
      throw new RequestError(
        "Name the free item and add clear staff instructions before approval.",
      );
    if (
      !(
        await tx.query(
          "select location_id from market_locations where market_id=$1 and location_id=$2 and active=true",
          [supply.market_id, supply.location_id],
        )
      ).length
    )
      throw new RequestError("This merchant location is paused in the market.");
    if (supply.spend_cap !== null) {
      if (
        supply.reward_cost === null ||
        supply.inventory_policy === "unlimited" ||
        supply.quantity === null
      )
        throw new RequestError(
          "A reward spend guardrail needs a saved per-item reward cost and finite inventory. Add the cost in Offer Studio or remove the unverified guardrail.",
        );
      if (
        Math.round(Number(supply.reward_cost) * 100) * supply.quantity >
        Math.round(Number(supply.spend_cap) * 100)
      )
        throw new RequestError(
          "The saved reward cost and quantity exceed this Drop's spend guardrail.",
        );
    }
    await tx.query(
      "update network_drop_supplies set state='approved',approved_by=$2 where id=$1",
      [supplyId, actor.id],
    );
    await audit(
      tx,
      actor.id,
      supply.organization_id,
      "network_supply_approved",
      supplyId,
      {
        offerId: supply.offer_id,
        offerVersion: supply.offer_version,
        startsAt: supply.starts_at,
        expiresAt: supply.expires_at,
        inventoryPolicy: supply.inventory_policy,
        quantity: supply.quantity,
        verificationMode: supply.verification_mode,
        selfConfirmApproved: supply.self_confirm_approved,
        staffInstructions: supply.staff_instructions,
        fallbackPlan: supply.fallback_plan,
        fundingSource: supply.funding_source,
        shareable: supply.shareable,
        referralCap: supply.referral_cap,
        growthFee: supply.growth_fee,
        spendCap: supply.spend_cap,
      },
    );
  });
}
export async function adjustSupply(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const data = z
    .object({
      supplyId: text(100).min(1),
      delta: z.coerce
        .number()
        .int()
        .min(-1000000)
        .max(1000000)
        .refine((value) => value !== 0),
      reason: text(800).min(10),
    })
    .parse(raw);
  await db.transaction(async (tx) => {
    const [supply] = await tx.query<{
      organization_id: string;
      inventory_policy: string;
      state: string;
      spend_cap: number | null;
      reward_cost: number | null;
    }>(
      "select s.organization_id,s.inventory_policy,s.state,s.spend_cap,pm.reward_cost from network_drop_supplies s left join offer_product_metadata pm on pm.offer_id=s.offer_id and pm.version=s.offer_version where s.id=$1 for update of s",
      [data.supplyId],
    );
    if (!supply || supply.inventory_policy === "unlimited")
      throw new RequestError("Choose a capped Drop to adjust inventory.");
    const usage = await supplyUsage(tx, data.supplyId);
    if (
      usage.quantity === null ||
      usage.quantity + data.delta < usage.redeemed + usage.reserved ||
      usage.quantity + data.delta < 1
    )
      throw new RequestError(
        "Inventory cannot fall below redeemed items and active reservations.",
      );
    if (
      supply.spend_cap !== null &&
      data.delta > 0 &&
      (supply.reward_cost === null ||
        Math.round(Number(supply.reward_cost) * 100) *
          (usage.quantity + data.delta) >
          Math.round(Number(supply.spend_cap) * 100))
    )
      throw new RequestError(
        "The adjusted inventory would exceed the saved reward spend guardrail.",
      );
    await tx.query(
      "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values($1,$2,$3,$4,$5)",
      [id(), data.supplyId, data.delta, data.reason, actor.id],
    );
    await audit(
      tx,
      actor.id,
      supply.organization_id,
      "network_supply_inventory_adjusted",
      data.supplyId,
      data,
    );
  });
}
export async function pauseSupply(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const data = z
    .object({ supplyId: text(100).min(1), reason: text(800).min(10) })
    .parse(raw);
  await db.transaction(async (tx) => {
    const [supply] = await tx.query<{ organization_id: string }>(
      "select organization_id from network_drop_supplies where id=$1 for update",
      [data.supplyId],
    );
    if (!supply) throw new RequestError("Drop supply not found.");
    await tx.query(
      "update network_drop_supplies set state='paused' where id=$1",
      [data.supplyId],
    );
    await audit(
      tx,
      actor.id,
      supply.organization_id,
      "network_supply_paused",
      data.supplyId,
      { reason: data.reason, existingPassesKeepSavedTerms: true },
    );
  });
}
export async function resumeSupply(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const data = z
    .object({ supplyId: text(100).min(1), reason: text(800).min(10) })
    .parse(raw);
  await db.transaction(async (tx) => {
    const [supply] = await tx.query<{
      organization_id: string;
      market_id: string;
      location_id: string;
      state: string;
      approved_by: string | null;
      expires_at: string;
      verification_mode: string;
    }>(
      "select organization_id,market_id,location_id,state,approved_by,expires_at,verification_mode from network_drop_supplies where id=$1 for update",
      [data.supplyId],
    );
    if (!supply || supply.state !== "paused" || !supply.approved_by)
      throw new RequestError(
        "Only a previously approved, paused Drop can be resumed.",
      );
    if (new Date(supply.expires_at).getTime() <= Date.now())
      throw new RequestError(
        "This Drop has expired. Create a new offer window.",
      );
    await assertSupplyTapReady(tx, supply);
    if (
      !(
        await tx.query(
          "select location_id from market_locations where market_id=$1 and location_id=$2 and active=true",
          [supply.market_id, supply.location_id],
        )
      ).length
    )
      throw new RequestError(
        "Connect and activate this merchant location before resuming supply.",
      );
    await tx.query(
      "update network_drop_supplies set state='approved' where id=$1",
      [data.supplyId],
    );
    await audit(
      tx,
      actor.id,
      supply.organization_id,
      "network_supply_resumed",
      data.supplyId,
      { reason: data.reason, existingApprovedTermsPreserved: true },
    );
  });
}
export async function allocateMarket(db: DB, actor: Actor, marketId: string) {
  requireOperator(actor);
  const [market] = await db.query<{ timezone: string }>(
    "select timezone from market_cells where id=$1",
    [marketId],
  );
  if (!market) throw new RequestError("Market not found.");
  const week = weekKey(new Date(), market.timezone);
  const members = await db.query<{ id: string }>(
    `select m.id from uptick_members m where m.market_id=$1 and m.state='active' and m.verified_at is not null and (select accepted from member_consents c where c.member_id=m.id order by c.sequence desc limit 1)=true and not exists(select 1 from member_allocations a where a.member_id=m.id and a.week_key=$2) order by m.created_at limit 250`,
    [marketId, week],
  );
  let allocated = 0,
    withoutOptions = 0;
  for (const member of members) {
    const result = await allocateMember(db, member.id);
    if (result?.options.length) allocated++;
    else withoutOptions++;
  }
  await audit(db, actor.id, null, "market_allocation_prepared", marketId, {
    checked: members.length,
    allocated,
    withoutOptions,
    limit: 250,
    sendsMessages: false,
  });
  return { checked: members.length, allocated, withoutOptions };
}

export type MarketRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  state: string;
  boundary_note: string;
  center_latitude: number | null;
  center_longitude: number | null;
  zips: string[];
};
export type LocationRow = {
  id: string;
  organization_id: string;
  name: string;
  merchant: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  postal_code: string | null;
  is_demo: boolean;
  active: boolean | null;
  drive_minutes: number | null;
};
export type PartnerRow = {
  id: string;
  name: string;
  kind: string;
  state: string;
  agreement_note: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  joins: number;
  claimed: number;
  redeemed: number;
};
export type SourceRow = {
  id: string;
  market_id: string;
  partner_id: string | null;
  partner: string | null;
  token: string;
  name: string;
  channel: string;
  campaign: string;
  cost: number | null;
  state: string;
  created_at: string;
  joins: number;
  verified: number;
  claimed: number;
  redeemed: number;
  allocated: number;
  loads: number;
  mature2: number;
  retained2: number;
  mature4: number;
  retained4: number;
};
export type SupplyRow = {
  id: string;
  market_id: string;
  organization_id: string;
  location_id: string;
  offer_id: string;
  offer_version: number;
  current_offer_version: number;
  staff_tap_count: number;
  public_tap_count: number;
  state: string;
  starts_at: string;
  expires_at: string;
  inventory_policy: string;
  quantity: number | null;
  reward_cost: number | null;
  reservation_minutes: number | null;
  verification_mode: string;
  self_confirm_approved: boolean;
  staff_instructions: string;
  fallback_plan: string;
  funding_source: string;
  shareable: boolean;
  referral_cap: number;
  growth_fee: number | null;
  spend_cap: number | null;
  title: string;
  reward: string;
  qualification: string;
  terms: string;
  merchant: string;
  address: string;
  timezone: string;
};
const supplySelect = `select s.*,o.current_version current_offer_version,(select count(*)::int from redemption_points rp where rp.organization_id=s.organization_id and rp.location_id=s.location_id and rp.state='active' and rp.exposure='staff' and exists(select 1 from redemption_credentials rc where rc.point_id=rp.id and rc.state='active')) staff_tap_count,(select count(*)::int from redemption_points rp where rp.organization_id=s.organization_id and rp.location_id=s.location_id and rp.state='active' and rp.exposure='public' and exists(select 1 from redemption_credentials rc where rc.point_id=rp.id and rc.state='active')) public_tap_count,o.title,v.reward,v.qualification,v.terms,g.name merchant,g.timezone,l.address,pm.reward_cost from network_drop_supplies s left join offer_product_metadata pm on pm.offer_id=s.offer_id and pm.version=s.offer_version join offers o on o.id=s.offer_id join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version join organizations g on g.id=s.organization_id join locations l on l.id=s.location_id`;

async function assertSupplyTapReady(
  db: DB,
  supply: {
    organization_id: string;
    location_id: string;
    verification_mode: string;
  },
) {
  if (supply.verification_mode === "self_confirm") return;
  const points = await db.query<{ exposure: string }>(
    "select distinct p.exposure from redemption_points p join redemption_credentials c on c.point_id=p.id where p.organization_id=$1 and p.location_id=$2 and p.state='active' and c.state='active'",
    [supply.organization_id, supply.location_id],
  );
  if (!points.some((point) => point.exposure === "staff"))
    throw new RequestError(
      "Configure an active staff-controlled Uptick Tap at this location before approval. A public Tap also needs its staff fallback.",
    );
  if (
    supply.verification_mode === "public_tap" &&
    !points.some((point) => point.exposure === "public")
  )
    throw new RequestError(
      "Configure an active public Uptick Tap at this location before approving the public Tap policy.",
    );
}
export type MemberSummary = {
  joined: number;
  verified: number;
  permissioned: number;
  active28: number;
  claimed: number;
  redeemed: number;
  returned: number;
};
export async function networkOperations(
  db: DB,
  actor: Actor,
  selectedMarket?: string,
) {
  requireOperator(actor);
  const markets = await db.query<MarketRow>(
    `select m.*,coalesce(array_agg(z.zip order by z.zip) filter(where z.zip is not null),'{}') zips from market_cells m left join market_zips z on z.market_id=m.id group by m.id order by m.created_at`,
  );
  const market =
    markets.find((item) => item.id === selectedMarket) || markets[0] || null;
  const marketId = market?.id || "";
  const [
    locations,
    partners,
    sources,
    supplies,
    offers,
    memberRows,
    allocations,
    activity,
  ] = await Promise.all([
    db.query<LocationRow>(
      `select l.*,g.name merchant,g.is_demo,ml.active,ml.drive_minutes from locations l join organizations g on g.id=l.organization_id left join market_locations ml on ml.location_id=l.id and ml.market_id=$1 where 'merchant'=any(g.capabilities) order by g.name,l.name`,
      [marketId],
    ),
    db.query<PartnerRow>(
      `select p.*,(select count(*)::int from uptick_members m join acquisition_sources s on s.id=m.source_id where s.partner_id=p.id and s.market_id=$1) joins,(select count(distinct m.id)::int from uptick_members m join acquisition_sources s on s.id=m.source_id join member_claims mc on mc.member_id=m.id where s.partner_id=p.id and s.market_id=$1) claimed,(select count(distinct m.id)::int from uptick_members m join acquisition_sources s on s.id=m.source_id join member_claims mc on mc.member_id=m.id join claims c on c.id=mc.claim_id where s.partner_id=p.id and s.market_id=$1 and c.redeemed_at is not null) redeemed from acquisition_partners p join partner_markets pm on pm.partner_id=p.id where pm.market_id=$1 order by p.created_at`,
      [marketId],
    ),
    db.query<SourceRow>(
      `select s.*,p.name partner,(select count(*)::int from uptick_members m where m.source_id=s.id) joins,(select count(*)::int from uptick_members m where m.source_id=s.id and m.verified_at is not null) verified,(select count(distinct mc.member_id)::int from member_claims mc join uptick_members m on m.id=mc.member_id where m.source_id=s.id) claimed,(select count(distinct mc.member_id)::int from member_claims mc join uptick_members m on m.id=mc.member_id join claims c on c.id=mc.claim_id where m.source_id=s.id and c.redeemed_at is not null) redeemed,(select count(distinct a.member_id)::int from member_allocations a join uptick_members m on m.id=a.member_id where m.source_id=s.id) allocated,(select count(*)::int from demand_events e where e.source_id=s.id and e.kind='source_loaded') loads,(select count(*)::int from uptick_members m where m.source_id=s.id and m.created_at <= now()-interval '21 days') mature2,(select count(*)::int from uptick_members m where m.source_id=s.id and m.created_at <= now()-interval '21 days' and exists(select 1 from member_claims mc join claims c on c.id=mc.claim_id where mc.member_id=m.id and ((mc.created_at>=m.created_at+interval '14 days' and mc.created_at<m.created_at+interval '21 days') or (c.redeemed_at>=m.created_at+interval '14 days' and c.redeemed_at<m.created_at+interval '21 days')))) retained2,(select count(*)::int from uptick_members m where m.source_id=s.id and m.created_at<=now()-interval '35 days') mature4,(select count(*)::int from uptick_members m where m.source_id=s.id and m.created_at<=now()-interval '35 days' and exists(select 1 from member_claims mc join claims c on c.id=mc.claim_id where mc.member_id=m.id and ((mc.created_at>=m.created_at+interval '28 days' and mc.created_at<m.created_at+interval '35 days') or (c.redeemed_at>=m.created_at+interval '28 days' and c.redeemed_at<m.created_at+interval '35 days')))) retained4 from acquisition_sources s left join acquisition_partners p on p.id=s.partner_id where s.market_id=$1 order by s.created_at`,
      [marketId],
    ),
    db.query<SupplyRow>(
      `${supplySelect} where s.market_id=$1 order by s.starts_at,s.created_at`,
      [marketId],
    ),
    db.query<Offer>(
      `${offerSelect} where o.kind='drop' and exists(select 1 from market_locations ml where ml.market_id=$1 and ml.location_id=o.location_id and ml.active=true) order by o.created_at desc`,
      [marketId],
    ),
    db.query<MemberSummary>(
      `select count(*)::int joined,count(*) filter(where m.verified_at is not null)::int verified,count(*) filter(where m.state='active' and m.verified_at is not null and (select c.accepted from member_consents c where c.member_id=m.id order by c.sequence desc limit 1)=true)::int permissioned,count(*) filter(where exists(select 1 from member_claims mc join claims c on c.id=mc.claim_id where mc.member_id=m.id and (mc.created_at>now()-interval '28 days' or c.redeemed_at>now()-interval '28 days')))::int active28,count(*) filter(where exists(select 1 from member_claims mc where mc.member_id=m.id))::int claimed,count(*) filter(where exists(select 1 from member_claims mc join claims c on c.id=mc.claim_id where mc.member_id=m.id and c.redeemed_at is not null))::int redeemed,count(*) filter(where exists(select 1 from member_claims mc join claims c on c.id=mc.claim_id where mc.member_id=m.id and c.redeemed_at is not null group by c.organization_id having count(*)>1))::int returned from uptick_members m where m.market_id=$1`,
      [marketId],
    ),
    db.query<{
      id: string;
      week_key: string;
      member_ref: string;
      created_at: string;
      titles: string[];
      reasons: unknown[];
      claimed: boolean;
    }>(
      `select a.id,a.week_key,upper(right(a.member_id,6)) member_ref,a.created_at,array_agg(o.title order by ao.rank) filter(where o.id is not null) titles,jsonb_agg(ao.reason order by ao.rank) filter(where ao.supply_id is not null) reasons,exists(select 1 from member_claims mc where mc.allocation_id=a.id) claimed from member_allocations a left join allocation_options ao on ao.allocation_id=a.id left join network_drop_supplies s on s.id=ao.supply_id left join offers o on o.id=s.offer_id where a.market_id=$1 group by a.id order by a.created_at desc limit 40`,
      [marketId],
    ),
    db.query<{
      id: string;
      kind: string;
      evidence_class: string;
      created_at: string;
      title: string | null;
      source: string | null;
      member_ref: string | null;
    }>(
      `select e.id,e.kind,e.evidence_class,e.created_at,o.title,s.name source,upper(right(e.member_id,6)) member_ref from demand_events e left join network_drop_supplies d on d.id=e.supply_id left join offers o on o.id=d.offer_id left join acquisition_sources s on s.id=e.source_id where e.market_id=$1 order by e.created_at desc limit 40`,
      [marketId],
    ),
  ]);
  const asOf = new Date();
  const coverage = market
    ? await Promise.all(
        [0, 1, 2, 3, 4].map((offset) =>
          marketCoverage(
            db,
            market.id,
            new Date(asOf.getTime() + offset * 7 * 86400000),
          ),
        ),
      )
    : [];
  const usage = Object.fromEntries(
    await Promise.all(
      supplies.map(async (supply) => [
        supply.id,
        await supplyUsage(db, supply.id),
      ]),
    ),
  );
  return {
    markets,
    market,
    locations,
    partners,
    sources,
    supplies,
    offers,
    members: memberRows[0],
    allocations,
    activity,
    coverage,
    usage,
    asOf: asOf.toISOString(),
  };
}
export type NetworkOperations = Awaited<ReturnType<typeof networkOperations>>;

export async function saveMembershipSender(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const input = z
    .object({ serviceSid: text(34), phone: text(20), approved: yes })
    .parse(raw);
  return configureMemberSender(db, actor, input);
}

export async function prepareMembershipMessages(db: DB, actor: Actor) {
  requireOperator(actor);
  if (!(await memberMessagingReadiness(db)).ready)
    throw new RequestError(
      "Complete membership messaging setup before preparing a delivery batch.",
    );
  const queued = await prepareMembershipWeek(db, 100);
  await audit(db, actor.id, null, "membership.week_prepared", "membership", {
    queued,
    limit: 100,
    sendsMessages: false,
  });
  return queued;
}

export async function dispatchMembershipMessages(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  requireOperator(actor);
  const { reviewed } = z.object({ reviewed: yes }).parse(raw);
  if (!reviewed)
    throw new RequestError(
      "Review the membership queue and confirm the delivery step.",
    );
  const readiness = await memberMessagingReadiness(db);
  if (!readiness.ready)
    throw new RequestError(
      "Complete membership messaging setup before dispatching.",
    );
  const processed = await dispatchMemberMessages(db, 20);
  await audit(db, actor.id, null, "membership.queue_dispatched", "membership", {
    processed,
    limit: 20,
    environment: readiness.environment,
    simulated: readiness.simulated,
  });
  return { processed, simulated: readiness.simulated };
}

/** Operator-only cross-market delivery ledger. Never select private access credentials. */
export async function membershipMessagingOperations(db: DB, actor: Actor) {
  requireOperator(actor);
  const [readiness, counts, messages, preparations] = await Promise.all([
    memberMessagingReadiness(db),
    db.query<{ state: string; count: number }>(
      "select state,count(*)::int count from member_messages group by state order by state",
    ),
    db.query<{
      id: string;
      member_ref: string;
      phone_hint: string;
      market: string | null;
      purpose: string;
      week_key: string | null;
      state: string;
      environment: string;
      scheduled_at: string;
      expires_at: string;
      created_at: string;
      error_code: string | null;
      suppression_reason: string | null;
      provider_sid: string | null;
    }>(
      `select msg.id,upper(right(msg.member_id,6)) member_ref,right(c.phone,4) phone_hint,k.name market,msg.purpose,msg.week_key,msg.state,msg.environment,msg.scheduled_at,msg.expires_at,msg.created_at,msg.error_code,msg.suppression_reason,msg.provider_sid from member_messages msg join uptick_members m on m.id=msg.member_id join customers c on c.id=m.customer_id left join market_cells k on k.id=m.market_id order by msg.created_at desc,msg.id limit 80`,
    ),
    db.query<{ state: string; count: number }>(
      "select p.state,count(*)::int count from member_week_preparations p join uptick_members m on m.id=p.member_id join market_cells k on k.id=m.market_id where p.week_key=to_char(date_trunc('week',now() at time zone k.timezone),'YYYY-MM-DD') group by p.state",
    ),
  ]);
  return { readiness, counts, messages, preparations };
}
export type MembershipMessagingOperations = Awaited<
  ReturnType<typeof membershipMessagingOperations>
>;

export async function lookupNetworkMember(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const input = z.object({ phone: text(40).min(1) }).parse(raw);
  const phone = normalizePhone(input.phone);
  await rateLimit(db, `operator-member-lookup:${actor.id}`, 60, 3600);
  const [member] = await db.query<{
    id: string;
    reference: string;
    phone_hint: string;
    state: string;
    verified_at: string | null;
    created_at: string;
    home_zip: string;
    work_zip: string | null;
    market: string | null;
    source: string | null;
    channel: string | null;
    partner: string | null;
  }>(
    `select m.id,upper(right(m.id,6)) reference,right(c.phone,4) phone_hint,m.state,m.verified_at,m.created_at,m.home_zip,m.work_zip,k.name market,s.name source,s.channel,p.name partner from uptick_members m join customers c on c.id=m.customer_id left join market_cells k on k.id=m.market_id left join acquisition_sources s on s.id=m.source_id left join acquisition_partners p on p.id=s.partner_id where c.phone=$1`,
    [phone],
  );
  await audit(
    db,
    actor.id,
    null,
    "membership.support_lookup",
    member?.id || hash(phone),
    { found: !!member, purpose: "individual_member_support" },
  );
  if (!member) return null;
  const [consents, allocations, claims, events, messages, suppressions] =
    await Promise.all([
      db.query<{
        accepted: boolean;
        disclosure_version: string;
        disclosure: string;
        source_ui: string;
        created_at: string;
      }>(
        "select accepted,disclosure_version,disclosure,source_ui,created_at from member_consents where member_id=$1 order by sequence desc limit 5",
        [member.id],
      ),
      db.query<{
        week_key: string;
        created_at: string;
        algorithm_version: string;
        options: {
          rank: number;
          title: string;
          merchant: string;
          state: string;
        }[];
      }>(
        `select a.week_key,a.created_at,a.algorithm_version,coalesce(jsonb_agg(jsonb_build_object('rank',x.rank,'title',o.title,'merchant',g.name,'state',s.state) order by x.rank) filter(where x.supply_id is not null),'[]'::jsonb) options from member_allocations a left join allocation_options x on x.allocation_id=a.id left join network_drop_supplies s on s.id=x.supply_id left join offers o on o.id=s.offer_id left join organizations g on g.id=s.organization_id where a.member_id=$1 group by a.id order by a.week_key desc,a.created_at desc limit 3`,
        [member.id],
      ),
      db.query<{
        reference: string;
        merchant: string;
        reward: string;
        state: string;
        created_at: string;
        redeemed_at: string | null;
        verification_method: string | null;
        staff_gated: boolean | null;
        transaction_verified: boolean | null;
      }>(
        `select upper(right(c.id,6)) reference,c.snapshot->>'merchant' merchant,c.snapshot->>'reward' reward,c.state,c.created_at,c.redeemed_at,e.method verification_method,e.staff_gated,e.transaction_verified from member_claims mc join claims c on c.id=mc.claim_id left join redemption_evidence e on e.claim_id=c.id where mc.member_id=$1 order by c.created_at desc limit 10`,
        [member.id],
      ),
      db.query<{ kind: string; evidence_class: string; created_at: string }>(
        "select kind,evidence_class,created_at from demand_events where member_id=$1 order by created_at desc,id desc limit 20",
        [member.id],
      ),
      db.query<{
        purpose: string;
        state: string;
        created_at: string;
        error_code: string | null;
        suppression_reason: string | null;
      }>(
        "select purpose,state,created_at,error_code,suppression_reason from member_messages where member_id=$1 order by created_at desc,id desc limit 8",
        [member.id],
      ),
      db.query<{
        suppressed: boolean;
        active_sender: boolean;
        updated_at: string;
      }>(
        "select s.suppressed,ms.active active_sender,s.updated_at from member_suppressions s join member_senders ms on ms.id=s.sender_id where s.phone=$1 order by s.updated_at desc limit 5",
        [phone],
      ),
    ]);
  return {
    member,
    consents,
    allocations,
    claims,
    events,
    messages,
    suppressions,
  };
}
export type NetworkMemberSupport = NonNullable<
  Awaited<ReturnType<typeof lookupNetworkMember>>
>;
