import type { DB } from "./db";
import {
  audit,
  getPass,
  rateLimit,
  weekKey,
  type Claim,
  type Snapshot,
} from "./domain";
import { id, token, hash, encrypt, normalizePhone } from "./security";
import { RequestError } from "./http";

export const MEMBERSHIP_DISCLOSURE_VERSION = "uptick-membership-2026-09-v1";
export const MEMBERSHIP_DISCLOSURE =
  "Join the free Uptick Local membership and receive recurring automated texts about your local Uptick Drops, up to one featured Drop message per week. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to stop or HELP for help. Participating stores fulfill the perks; this does not subscribe you to their separate marketing. See Uptick’s Terms, Privacy Policy and SMS terms.";
export type Member = {
  id: string;
  customer_id: string;
  home_zip: string;
  work_zip: string | null;
  market_id: string | null;
  source_id: string | null;
  state: "pending" | "active" | "paused";
  verified_at: string | null;
  created_at: string;
};
export type Access = {
  id: string;
  member_id: string;
  token_encrypted: string;
  purpose: "access" | "drop";
  expires_at: string;
  confirmed_at: string | null;
  consent_requested: boolean;
  disclosure: string;
  home_zip: string;
  work_zip: string | null;
  source_id: string | null;
  created_at: string;
};
export type Supply = {
  id: string;
  market_id: string;
  organization_id: string;
  location_id: string;
  offer_id: string;
  offer_version: number;
  state: string;
  starts_at: string;
  expires_at: string;
  inventory_policy: string;
  quantity: number | null;
  reservation_minutes: number | null;
  verification_mode: string;
  self_confirm_approved: boolean;
  staff_instructions: string;
  fallback_plan: string;
  shareable: boolean;
  referral_cap: number;
  growth_fee: string | null;
  spend_cap: string | null;
  title: string;
  qualification: string;
  reward: string;
  terms: string;
  merchant: string;
  address: string;
  timezone: string;
  is_demo: boolean;
  drive_minutes: number | null;
  latitude: string | null;
  longitude: string | null;
  customer_value: string | null;
  reward_cost: string | null;
  rank?: number;
  reason?: Record<string, unknown>;
};
export type Allocation = {
  id: string;
  member_id: string;
  market_id: string;
  week_key: string;
  created_at: string;
};
export const supplySelect = `select s.*,o.title,v.qualification,v.reward,v.terms,g.name merchant,g.timezone,g.is_demo,l.address,l.latitude,l.longitude,ml.drive_minutes,p.customer_value,p.reward_cost from network_drop_supplies s join offers o on o.id=s.offer_id join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version join organizations g on g.id=s.organization_id join locations l on l.id=s.location_id join market_locations ml on ml.market_id=s.market_id and ml.location_id=s.location_id left join offer_product_metadata p on p.offer_id=s.offer_id and p.version=s.offer_version`;
const zip = (value: string) => {
  if (!/^\d{5}$/.test(value))
    throw new RequestError("Enter a five-digit ZIP code.");
  return value;
};
export async function demandEvent(
  db: DB,
  input: {
    kind: string;
    memberId?: string | null;
    marketId?: string | null;
    organizationId?: string | null;
    locationId?: string | null;
    sourceId?: string | null;
    supplyId?: string | null;
    allocationId?: string | null;
    claimId?: string | null;
    detail?: object;
    dedupKey?: string;
    evidenceClass?: string;
  },
) {
  await db.query(
    `insert into demand_events(id,kind,member_id,market_id,organization_id,location_id,source_id,supply_id,allocation_id,claim_id,detail,dedup_key,evidence_class) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(dedup_key) do nothing`,
    [
      id(),
      input.kind,
      input.memberId || null,
      input.marketId || null,
      input.organizationId || null,
      input.locationId || null,
      input.sourceId || null,
      input.supplyId || null,
      input.allocationId || null,
      input.claimId || null,
      input.detail || {},
      input.dedupKey || null,
      input.evidenceClass || "observed",
    ],
  );
}
export async function resolveMarket(
  db: DB,
  homeZip: string,
  workZip: string | null,
) {
  const [market] = await db.query<{ id: string }>(
    `select m.id from market_cells m join market_zips z on z.market_id=m.id where m.state in ('building','pilot','live') and (z.zip=$1 or z.zip=$2) order by case when z.zip=$1 then 0 else 1 end,m.slug limit 1`,
    [homeZip, workZip],
  );
  return market?.id || null;
}
export async function acquisitionSource(db: DB, sourceToken: string) {
  const [source] = await db.query<{
    id: string;
    name: string;
    market_id: string;
    partner_id: string | null;
    partner: string | null;
    market: string;
    state: string;
  }>(
    `select s.*,p.name partner,m.name market from acquisition_sources s join market_cells m on m.id=s.market_id left join acquisition_partners p on p.id=s.partner_id where s.token=$1 and s.state='active' and m.state in ('building','pilot','live') and (p.id is null or p.state='active')`,
    [sourceToken],
  );
  if (!source)
    throw new RequestError(
      "This Uptick invitation is not available right now.",
      404,
    );
  return source;
}
export async function requestMemberAccess(
  db: DB,
  input: {
    phone: string;
    homeZip?: string;
    workZip?: string;
    sourceToken?: string;
    consentRequested: boolean;
  },
) {
  const phone = normalizePhone(input.phone);
  await rateLimit(db, `member-access:${hash(phone)}`, 6, 3600);
  return db.transaction(async (tx) => {
    const source = input.sourceToken
      ? await acquisitionSource(tx, input.sourceToken)
      : null;
    const [customer] = await tx.query<{ id: string }>(
      "insert into customers(id,phone) values($1,$2) on conflict(phone) do update set phone=excluded.phone returning id",
      [id(), phone],
    );
    let [member] = await tx.query<Member>(
      "select * from uptick_members where customer_id=$1 for update",
      [customer.id],
    );
    if (!member && !input.homeZip)
      throw new RequestError("Enter your home ZIP to join Uptick.");
    const homeZip = zip(input.homeZip || member.home_zip),
      workZip =
        input.workZip === undefined
          ? member?.work_zip || null
          : input.workZip
            ? zip(input.workZip)
            : null;
    if (!member) {
      [member] = await tx.query<Member>(
        "insert into uptick_members(id,customer_id,home_zip,work_zip,market_id,source_id) values($1,$2,$3,$4,$5,$6) returning *",
        [
          id(),
          customer.id,
          homeZip,
          workZip,
          await resolveMarket(tx, homeZip, workZip),
          source?.id || null,
        ],
      );
      await demandEvent(tx, {
        kind: "membership_requested",
        memberId: member.id,
        marketId: member.market_id,
        sourceId: member.source_id,
        dedupKey: `requested:${member.id}`,
      });
    }
    const credential = token();
    const [access] = await tx.query<Access>(
      `insert into member_access(id,member_id,token_hash,token_encrypted,expires_at,consent_requested,disclosure,home_zip,work_zip,source_id) values($1,$2,$3,$4,now()+interval '30 minutes',$5,$6,$7,$8,$9) returning *`,
      [
        id(),
        member.id,
        hash(credential),
        encrypt(credential),
        input.consentRequested,
        MEMBERSHIP_DISCLOSURE,
        homeZip,
        workZip,
        source?.id || null,
      ],
    );
    return { member, access, credential };
  });
}
export async function memberAccess(
  db: DB,
  credential: string,
  confirmed = false,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential))
    throw new RequestError("This private Uptick link is not valid.", 404);
  const [access] = await db.query<Access>(
    "select * from member_access where token_hash=$1 and expires_at>now()",
    [hash(credential)],
  );
  if (!access || (confirmed && !access.confirmed_at))
    throw new RequestError("Open your private Uptick link to continue.", 401);
  const [member] = await db.query<Member>(
    "select * from uptick_members where id=$1",
    [access.member_id],
  );
  if (!member) throw new RequestError("This membership is unavailable.", 404);
  return { access, member };
}
export async function confirmMemberAccess(
  db: DB,
  credential: string,
  acceptMembership: boolean,
) {
  return db.transaction(async (tx) => {
    const initial = await memberAccess(tx, credential);
    await tx.query("select id from uptick_members where id=$1 for update", [
      initial.member.id,
    ]);
    const { access, member } = await memberAccess(tx, credential);
    if (access.confirmed_at) return member;
    await tx.query(
      "update member_access set confirmed_at=now(),expires_at=greatest(expires_at,now()+interval '30 days') where id=$1",
      [access.id],
    );
    // A weekly message is not a new consent request. Reopening an old link cannot resubscribe.
    const subscribe =
      access.purpose === "access" &&
      access.consent_requested &&
      acceptMembership;
    const marketId =
      access.purpose === "access"
        ? await resolveMarket(tx, access.home_zip, access.work_zip)
        : member.market_id;
    await tx.query(
      `update uptick_members set verified_at=coalesce(verified_at,now()),home_zip=$2,work_zip=$3,market_id=$4,state=case when $5 then 'active' else state end,updated_at=now() where id=$1`,
      [
        member.id,
        access.purpose === "access" ? access.home_zip : member.home_zip,
        access.purpose === "access" ? access.work_zip : member.work_zip,
        marketId,
        subscribe,
      ],
    );
    if (
      access.purpose === "access" &&
      access.consent_requested &&
      (subscribe || member.state === "pending")
    )
      await recordMemberConsent(
        tx,
        member.id,
        subscribe,
        "private-membership-confirmation",
        access.disclosure,
      );
    await demandEvent(tx, {
      kind: subscribe ? "member_joined" : "member_access_confirmed",
      memberId: member.id,
      marketId,
      sourceId: member.source_id,
      dedupKey: subscribe ? `joined:${member.id}` : `access:${access.id}`,
    });
    return (
      await tx.query<Member>("select * from uptick_members where id=$1", [
        member.id,
      ])
    )[0];
  });
}
export async function recordMemberConsent(
  db: DB,
  memberId: string,
  accepted: boolean,
  sourceUi: string,
  disclosure = MEMBERSHIP_DISCLOSURE,
) {
  await db.query(
    "insert into member_consents(id,member_id,accepted,disclosure_version,disclosure,source_ui) values($1,$2,$3,$4,$5,$6)",
    [
      id(),
      memberId,
      accepted,
      MEMBERSHIP_DISCLOSURE_VERSION,
      disclosure,
      sourceUi,
    ],
  );
}
export async function memberPreferences(
  db: DB,
  credential: string,
  input: { homeZip: string; workZip: string; subscribed: boolean },
) {
  return db.transaction(async (tx) => {
    const { member } = await memberAccess(tx, credential, true);
    await tx.query("select id from uptick_members where id=$1 for update", [
      member.id,
    ]);
    const homeZip = zip(input.homeZip),
      workZip = input.workZip ? zip(input.workZip) : null;
    await tx.query(
      `update uptick_members set home_zip=$2,work_zip=$3,market_id=$4,state=$5,updated_at=now() where id=$1`,
      [
        member.id,
        homeZip,
        workZip,
        await resolveMarket(tx, homeZip, workZip),
        input.subscribed ? "active" : "paused",
      ],
    );
    await recordMemberConsent(
      tx,
      member.id,
      input.subscribed,
      "member-preferences",
    );
    await demandEvent(tx, {
      kind: "member_preferences_saved",
      memberId: member.id,
      detail: { subscribed: input.subscribed },
    });
  });
}
export async function supplyUsage(db: DB, supplyId: string, at = new Date()) {
  const [s] = await db.query<{
    quantity: number | null;
    inventory_policy: string;
    adjustment: number;
  }>(
    "select s.quantity,s.inventory_policy,coalesce((select sum(delta)::int from supply_adjustments a where a.supply_id=s.id),0) adjustment from network_drop_supplies s where id=$1",
    [supplyId],
  );
  if (!s) throw new RequestError("This Drop is unavailable.", 404);
  const [n] = await db.query<{
    claimed: number;
    redeemed: number;
    reserved: number;
  }>(
    `select count(*)::int claimed,count(*) filter(where c.state='redeemed')::int redeemed,count(*) filter(where c.state='active' and (mc.reserved_until is null or mc.reserved_until>$2) and (c.snapshot->>'expires_at')::timestamptz>$2)::int reserved from member_claims mc join claims c on c.id=mc.claim_id where mc.supply_id=$1`,
    [supplyId, at.toISOString()],
  );
  const quantity =
    s.inventory_policy === "unlimited"
      ? null
      : Math.max(0, (s.quantity || 0) + s.adjustment);
  const reserved = ["claim", "timed"].includes(s.inventory_policy)
    ? n.reserved
    : 0;
  return {
    ...n,
    reserved,
    quantity,
    remaining:
      quantity === null ? null : Math.max(0, quantity - n.redeemed - reserved),
    policy: s.inventory_policy,
  };
}
export async function eligibleDrops(db: DB, memberId: string, at = new Date()) {
  const [member] = await db.query<Member>(
    `select m.* from uptick_members m join market_cells k on k.id=m.market_id where m.id=$1 and m.state='active' and m.verified_at is not null and k.state in ('pilot','live') and exists(select 1 from market_zips z where z.market_id=k.id and (z.zip=m.home_zip or z.zip=m.work_zip))`,
    [memberId],
  );
  if (!member) return [];
  const supplies = await db.query<Supply>(
    `${supplySelect} where s.market_id=$1 and s.state='approved' and ml.active and s.starts_at<=$2 and s.expires_at>$2 and not exists(select 1 from claims c where c.customer_id=$3 and c.offer_id=s.offer_id) order by s.expires_at,s.id`,
    [member.market_id, at.toISOString(), member.customer_id],
  );
  const output: Supply[] = [];
  for (const supply of supplies) {
    const usage = await supplyUsage(db, supply.id, at);
    if (usage.remaining === null || usage.remaining > 0) output.push(supply);
  }
  return output;
}
export async function allocationView(db: DB, allocation: Allocation) {
  const options = await db.query<Supply>(
    `${supplySelect} join allocation_options a on a.supply_id=s.id where a.allocation_id=$1 order by a.rank`,
    [allocation.id],
  );
  // Select rank/reasons separately to avoid ambiguous s.* column names.
  const reasons = await db.query<{
    supply_id: string;
    rank: number;
    reason: Record<string, unknown>;
  }>("select * from allocation_options where allocation_id=$1", [
    allocation.id,
  ]);
  return {
    allocation,
    options: options.map((s) => ({
      ...s,
      ...reasons.find((r) => r.supply_id === s.id),
    })),
  };
}
export async function allocateMember(
  db: DB,
  memberId: string,
  at = new Date(),
) {
  return db.transaction(async (tx) => {
    const [member] = await tx.query<Member & { timezone: string }>(
      `select m.*,k.timezone from uptick_members m join market_cells k on k.id=m.market_id where m.id=$1 for update of m`,
      [memberId],
    );
    if (!member) return null;
    const week = weekKey(at, member.timezone);
    const [existing] = await tx.query<Allocation>(
      "select * from member_allocations where member_id=$1 and week_key=$2",
      [memberId, week],
    );
    if (existing) return allocationView(tx, existing);
    const eligible = await eligibleDrops(tx, memberId, at);
    if (!eligible.length) return null;
    const history = await tx.query<{ organization_id: string; n: number }>(
      `select c.organization_id,count(*)::int n from member_claims mc join claims c on c.id=mc.claim_id where mc.member_id=$1 and c.state='redeemed' and c.redeemed_at>$2::timestamptz-interval '28 days' group by c.organization_id`,
      [memberId, at.toISOString()],
    );
    const ranked = await Promise.all(
      eligible.map(async (s) => ({
        s,
        usage: await supplyUsage(tx, s.id, at),
        recent:
          history.find((h) => h.organization_id === s.organization_id)?.n || 0,
      })),
    );
    ranked.sort(
      (a, b) =>
        a.recent - b.recent ||
        (a.s.drive_minutes ?? 999) - (b.s.drive_minutes ?? 999) ||
        a.s.id.localeCompare(b.s.id),
    );
    const [allocation] = await tx.query<Allocation>(
      "insert into member_allocations(id,member_id,market_id,week_key) values($1,$2,$3,$4) returning *",
      [id(), memberId, member.market_id, week],
    );
    for (const [index, { s, usage, recent }] of ranked.slice(0, 3).entries()) {
      const reason = {
        rule: "local-v1",
        market: "Home or work ZIP is in this Market Cell",
        recentMerchantRedemptions28d: recent,
        driveMinutesEstimate: s.drive_minutes,
        remainingAtAllocation: usage.remaining,
        inventoryReserved: false,
        ranking:
          "Local relevance, merchant variety, then operator drive-time estimate",
      };
      await tx.query(
        "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values($1,$2,$3,$4,$5)",
        [allocation.id, s.id, member.market_id, index + 1, reason],
      );
      await demandEvent(tx, {
        kind: "drop_allocated",
        memberId,
        marketId: member.market_id,
        supplyId: s.id,
        organizationId: s.organization_id,
        allocationId: allocation.id,
        detail: { rank: index + 1, ...reason },
        dedupKey: `allocation:${allocation.id}:${s.id}`,
      });
    }
    return allocationView(tx, allocation);
  });
}
export async function claimMemberDrop(
  db: DB,
  credential: string,
  supplyId: string,
) {
  return db.transaction(async (tx) => {
    const { member } = await memberAccess(tx, credential, true);
    await tx.query("select id from uptick_members where id=$1 for update", [
      member.id,
    ]);
    const [supply] = await tx.query<Supply>(`${supplySelect} where s.id=$1`, [
      supplyId,
    ]);
    if (!supply) throw new RequestError("This Drop is unavailable.");
    // Match Tap's lock order: offer, supply, then entitlement.
    await tx.query("select id from offers where id=$1 for update", [
      supply.offer_id,
    ]);
    await tx.query(
      "select id from network_drop_supplies where id=$1 for update",
      [supplyId],
    );
    const [allocation] = await tx.query<Allocation>(
      `select a.* from member_allocations a join allocation_options o on o.allocation_id=a.id where a.member_id=$1 and a.week_key=$2 and o.supply_id=$3`,
      [member.id, weekKey(new Date(), supply.timezone), supplyId],
    );
    if (!allocation)
      throw new RequestError("Open Your Uptick to see this week’s choices.");
    const [existing] = await tx.query<Claim>(
      `select c.* from claims c join member_claims mc on mc.claim_id=c.id where mc.allocation_id=$1`,
      [allocation.id],
    );
    if (existing) {
      if (existing.offer_id !== supply.offer_id)
        throw new RequestError(
          "You already chose your Uptick this week. Open your saved pass.",
        );
      return existing;
    }
    if (!(await eligibleDrops(tx, member.id)).some((s) => s.id === supplyId))
      throw new RequestError(
        "This Drop is no longer available. Your other choices may still be available.",
      );
    const usage = await supplyUsage(tx, supplyId);
    if (usage.remaining !== null && usage.remaining < 1)
      throw new RequestError("This Drop has reached its available quantity.");
    const pass = token(),
      claimId = id();
    const reserveUntil =
      supply.inventory_policy === "timed"
        ? new Date(
            Math.min(
              Date.now() + (supply.reservation_minutes || 30) * 60000,
              new Date(supply.expires_at).getTime(),
            ),
          ).toISOString()
        : null;
    const snapshot: Snapshot = {
      merchant: supply.merchant,
      qualification: supply.qualification,
      reward: supply.reward,
      terms: supply.terms,
      starts_at: supply.starts_at,
      expires_at: supply.expires_at,
      address: supply.address,
      timezone: supply.timezone,
      limit_mode:
        supply.inventory_policy === "unlimited"
          ? "unlimited"
          : supply.inventory_policy === "redemption"
            ? "redemption"
            : "claim",
      quantity: usage.quantity,
      is_demo: supply.is_demo,
      origin: {
        network: true,
        market_id: supply.market_id,
        supply_id: supply.id,
        allocation_id: allocation.id,
        source_id: member.source_id,
        verification_mode: supply.verification_mode,
        inventory_policy: supply.inventory_policy,
        reserved_until: reserveUntil,
      },
    };
    const [claim] = await tx.query<Claim>(
      "insert into claims(id,customer_id,organization_id,offer_id,offer_version,token_hash,token_encrypted,snapshot,opened_at) values($1,$2,$3,$4,$5,$6,$7,$8,now()) returning *",
      [
        claimId,
        member.customer_id,
        supply.organization_id,
        supply.offer_id,
        supply.offer_version,
        hash(pass),
        encrypt(pass),
        snapshot,
      ],
    );
    await tx.query(
      "insert into member_claims(claim_id,member_id,customer_id,organization_id,supply_id,offer_id,allocation_id,reserved_until) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        claimId,
        member.id,
        member.customer_id,
        supply.organization_id,
        supply.id,
        supply.offer_id,
        allocation.id,
        reserveUntil,
      ],
    );
    await demandEvent(tx, {
      kind: "drop_claimed",
      memberId: member.id,
      marketId: supply.market_id,
      organizationId: supply.organization_id,
      locationId: supply.location_id,
      sourceId: member.source_id,
      supplyId: supply.id,
      allocationId: allocation.id,
      claimId,
      detail: {
        reservationUntil: reserveUntil,
        policy: supply.inventory_policy,
      },
      dedupKey: `claim:${claimId}`,
    });
    await audit(
      tx,
      "member",
      supply.organization_id,
      "network.claimed",
      claimId,
      { supplyId, allocationId: allocation.id },
    );
    return claim;
  });
}
export function marketWeekWindow(at: Date, timezone: string) {
  const startKey = weekKey(at, timezone);
  const localMidnight = (date: string) => {
    const target = Date.parse(`${date}T00:00:00Z`);
    let instant = target;
    for (let n = 0; n < 3; n++) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(instant));
      const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
      const rendered = Date.parse(
        `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
      );
      instant += target - rendered;
    }
    return new Date(instant);
  };
  const nextKey = new Date(Date.parse(`${startKey}T12:00:00Z`) + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  return {
    start: localMidnight(startKey),
    end: localMidnight(nextKey),
    weekKey: startKey,
  };
}
export async function marketCoverage(
  db: DB,
  marketId: string,
  at = new Date(),
) {
  const [market] = await db.query<{ timezone: string }>(
    "select timezone from market_cells where id=$1",
    [marketId],
  );
  if (!market) throw new RequestError("Market not found.", 404);
  const members = await db.query<Member>(
    "select * from uptick_members where market_id=$1 and state='active' and verified_at is not null",
    [marketId],
  );
  const window = marketWeekWindow(at, market.timezone);
  const checkAt = new Date(Math.max(window.start.getTime(), Date.now()));
  const supplyRows = await db.query<{
    id: string;
    starts_at: string;
    expires_at: string;
  }>(
    "select id,starts_at,expires_at from network_drop_supplies where market_id=$1 and state='approved' and starts_at<$2 and expires_at>$3",
    [marketId, window.end.toISOString(), checkAt.toISOString()],
  );
  const usages = new Map<string, Awaited<ReturnType<typeof supplyUsage>>>();
  for (const s of supplyRows)
    usages.set(s.id, await supplyUsage(db, s.id, checkAt));
  const fulfilled = await db.query<{ member_id: string }>(
    `select mc.member_id from member_claims mc join member_allocations a on a.id=mc.allocation_id join claims c on c.id=mc.claim_id where a.market_id=$1 and a.week_key=$2 and (c.state='redeemed' or (c.state='active' and (c.snapshot->>'expires_at')::timestamptz>$3 and (mc.reserved_until is null or mc.reserved_until>$3)))`,
    [marketId, window.weekKey, checkAt.toISOString()],
  );
  const alreadyCovered = new Set(fulfilled.map((x) => x.member_id));
  const candidates = [];
  for (const m of members) {
    if (alreadyCovered.has(m.id)) continue;
    const options = new Set<string>();
    for (const s of supplyRows) {
      const moment = new Date(
        Math.max(new Date(s.starts_at).getTime(), checkAt.getTime()),
      );
      for (const available of await eligibleDrops(db, m.id, moment))
        if (available.id === s.id) options.add(s.id);
    }
    candidates.push({ member: m.id, supplies: [...options] });
  }
  const slots = new Map<string, string[]>(),
    assigned = new Map<string, string[]>();
  for (const c of candidates) assigned.set(c.member, c.supplies);
  const match = (member: string, seen: Set<string>): boolean => {
    for (const sid of assigned.get(member) || []) {
      if (seen.has(sid)) continue;
      seen.add(sid);
      const occupants = slots.get(sid) || [],
        capacity = usages.get(sid)?.remaining ?? members.length;
      if (occupants.length < capacity) {
        slots.set(sid, [...occupants, member]);
        return true;
      }
      for (let i = 0; i < occupants.length; i++)
        if (match(occupants[i], seen)) {
          occupants[i] = member;
          slots.set(sid, occupants);
          return true;
        }
    }
    return false;
  };
  let coveredMembers = members.filter((m) => alreadyCovered.has(m.id)).length;
  for (const c of candidates.sort(
    (a, b) => a.supplies.length - b.supplies.length,
  ))
    if (match(c.member, new Set())) coveredMembers++;
  const capacity = [...usages.values()].some((u) => u.remaining === null)
    ? null
    : [...usages.values()].reduce((n, u) => n + (u.remaining || 0), 0);
  return {
    marketId,
    weekKey: window.weekKey,
    activeMembers: members.length,
    eligibleMembers:
      candidates.filter((c) => c.supplies.length).length +
      members.filter((m) => alreadyCovered.has(m.id)).length,
    coveredMembers,
    uncoveredMembers: members.length - coveredMembers,
    capacity,
    coveragePercent: members.length
      ? Math.round((coveredMembers / members.length) * 100)
      : null,
    supplies: supplyRows.length,
    method: "capacity-constrained-matching" as const,
    asOf: at.toISOString(),
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
  };
}
export async function networkPass(db: DB, credential: string) {
  const claim = await getPass(db, credential);
  const [mapping] = await db.query<{
    member_id: string;
    supply_id: string;
    reserved_until: string | null;
  }>("select * from member_claims where claim_id=$1", [claim.id]);
  if (!mapping) return null;
  const [supply] = await db.query<Supply>(`${supplySelect} where s.id=$1`, [
    mapping.supply_id,
  ]);
  return { claim, mapping, supply };
}
