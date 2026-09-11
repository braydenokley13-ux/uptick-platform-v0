import { disclosure } from "./consent-copy";
export { disclosure } from "./consent-copy";
import type { DB } from "./db";
import { RequestError } from "./http";
import { id, token, hash, encrypt, normalizePhone } from "./security";
import { assertApprovalReady, assertClaimReady } from "./launch";
export type Actor = {
  id: string;
  role: "merchant" | "operator";
  organizationId: string;
  canExport?: boolean;
};
export type Offer = {
  id: string;
  organization_id: string;
  location_id: string;
  kind: "anchor" | "drop";
  state: string;
  title: string;
  current_version: number;
  qualification: string;
  reward: string;
  terms: string;
  starts_at: string;
  expires_at: string;
  limit_mode: string;
  quantity: number | null;
  merchant: string;
  address: string;
  timezone: string;
  is_demo: boolean;
};
export type Snapshot = {
  merchant: string;
  qualification: string;
  reward: string;
  terms: string;
  expires_at: string;
  starts_at: string;
  address: string;
  timezone: string;
  limit_mode: string;
  quantity: number | null;
  origin: Record<string, unknown>;
  is_demo: boolean;
};
export type Claim = {
  id: string;
  customer_id: string;
  organization_id: string;
  offer_id: string;
  offer_version: number;
  state: string;
  token_encrypted: string;
  snapshot: Snapshot;
  created_at: string;
  redeemed_at: string | null;
  opened_at: string | null;
  broadcast_id: string | null;
};
export const offerSelect = `select o.*,v.qualification,v.reward,v.terms,v.starts_at,v.expires_at,v.limit_mode,v.quantity,g.name merchant,g.timezone,g.is_demo,l.address from offers o join offer_versions v on v.offer_id=o.id and v.version=o.current_version join organizations g on g.id=o.organization_id join locations l on l.id=o.location_id`;
export function authorize(actor: Actor, org: string, operator = false) {
  if (
    (operator && actor.role !== "operator") ||
    (actor.role !== "operator" && actor.organizationId !== org)
  )
    throw Error("You do not have access to this business.");
}
export async function audit(
  db: DB,
  actor: string,
  org: string | null,
  action: string,
  entity: string,
  detail: object = {},
) {
  await db.query(
    "insert into audit_events(id,organization_id,actor,action,entity_id,detail) values($1,$2,$3,$4,$5,$6)",
    [id(), org, actor, action, entity, detail],
  );
}
export async function sourceOffer(db: DB, sourceToken: string) {
  const [source] = await db.query<{
    id: string;
    offer_id: string;
    placement_id: string;
    state: string;
    campaign: string;
    creative: string;
    host: string | null;
    creative_offer_version: number | null;
  }>(
    `select s.*,g.name host,sc.offer_version creative_offer_version from sources s left join placements p on p.id=s.placement_id left join locations l on l.id=p.location_id left join organizations g on g.id=l.organization_id left join source_creatives sc on sc.source_id=s.id where s.token=$1`,
    [sourceToken],
  );
  if (!source || source.state !== "active")
    throw Error("This offer link is no longer available.");
  const [offer] = await db.query<Offer>(`${offerSelect} where o.id=$1`, [
    source.offer_id,
  ]);
  if (
    !offer ||
    (source.creative_offer_version !== null &&
      source.creative_offer_version !== offer.current_version)
  )
    throw Error("This offer link is no longer available.");
  return { source, offer };
}
export function offerAvailable(o: Offer, now = new Date()) {
  return (
    o.state === "live" &&
    new Date(o.starts_at) <= now &&
    new Date(o.expires_at) > now
  );
}
export async function rateLimit(
  db: DB,
  key: string,
  max: number,
  seconds: number,
) {
  const [r] = await db.query<{ count: number }>(
    `insert into rate_limits(key) values($1) on conflict(key) do update set count=case when rate_limits.window_at < now()-($2 * interval '1 second') then 1 else rate_limits.count+1 end, window_at=case when rate_limits.window_at < now()-($2 * interval '1 second') then now() else rate_limits.window_at end returning count`,
    [key, seconds],
  );
  if (r.count > max)
    throw Error(
      "Too many attempts. Please wait a few minutes before trying again.",
    );
}
export async function consent(
  db: DB,
  customerId: string,
  org: string,
  phone: string,
  purpose: "fulfillment" | "merchant" | "network",
  accepted: boolean,
  merchant: string,
  ui: string,
  verified = false,
) {
  await db.query(
    "insert into consent_events(id,customer_id,organization_id,purpose,accepted,disclosure_version,disclosure,source_ui,phone) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      id(),
      customerId,
      purpose === "network" ? null : org,
      purpose,
      accepted,
      "2026-09-v1",
      disclosure(purpose, merchant),
      ui,
      phone,
    ],
  );
  if (purpose === "fulfillment") return;
  const scope = purpose === "network" ? "network" : org;
  if (accepted)
    await db.query(
      `insert into subscriptions(customer_id,scope,organization_id,state) values($1,$2,$3,$4) on conflict(customer_id,scope) do update set state=case when subscriptions.state='subscribed' then 'subscribed' else excluded.state end,updated_at=now()`,
      [
        customerId,
        scope,
        purpose === "network" ? null : org,
        verified ? "subscribed" : "pending",
      ],
    );
  // An unchecked optional box on a new claim records a decline; it does not revoke an earlier subscription.
  else if (ui === "preferences")
    await db.query(
      `update subscriptions set state='unsubscribed',updated_at=now() where customer_id=$1 and scope=$2`,
      [customerId, scope],
    );
  else if (ui === "pass-open")
    await db.query(
      `update subscriptions set state='unsubscribed',updated_at=now() where customer_id=$1 and scope=$2 and state='pending'`,
      [customerId, scope],
    );
}
function snapshot(offer: Offer, origin: Record<string, unknown>): Snapshot {
  return {
    merchant: offer.merchant,
    qualification: offer.qualification,
    reward: offer.reward,
    terms: offer.terms,
    expires_at: offer.expires_at,
    starts_at: offer.starts_at,
    address: offer.address,
    timezone: offer.timezone,
    limit_mode: offer.limit_mode,
    quantity: offer.quantity,
    origin,
    is_demo: offer.is_demo,
  };
}
export async function createEntitlement(
  db: DB,
  offer: Offer,
  customerId: string,
  sourceId: string | null,
  origin: Record<string, unknown>,
  broadcastId: string | null = null,
) {
  // Every caller shares the same offer lock, including broadcast expansion and claim limits.
  await db.query("select id from offers where id=$1 for update", [offer.id]);
  const [current] = await db.query<Offer>(`${offerSelect} where o.id=$1`, [
    offer.id,
  ]);
  if (!current) throw Error("Offer not found.");
  offer = current;
  const [existing] = await db.query<Claim>(
    "select * from claims where customer_id=$1 and offer_id=$2",
    [customerId, offer.id],
  );
  if (existing) return existing;
  if (offer.limit_mode === "claim") {
    const [r] = await db.query<{ n: number }>(
      "select count(*)::int n from claims where offer_id=$1",
      [offer.id],
    );
    if (r.n >= (offer.quantity || 0))
      throw Error("All passes for this offer have been claimed.");
  }
  const pass = token(),
    claimId = id();
  const [claim] = await db.query<Claim>(
    "insert into claims(id,customer_id,organization_id,offer_id,offer_version,source_id,broadcast_id,token_hash,token_encrypted,snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *",
    [
      claimId,
      customerId,
      offer.organization_id,
      offer.id,
      offer.current_version,
      sourceId,
      broadcastId,
      hash(pass),
      encrypt(pass),
      snapshot(offer, origin),
    ],
  );
  await db.query(
    `insert into relationships(customer_id,organization_id,acquisition_claim_id) values($1,$2,$3) on conflict do nothing`,
    [customerId, offer.organization_id, claimId],
  );
  await audit(
    db,
    "customer",
    offer.organization_id,
    "claim.accepted",
    claimId,
    {
      offerId: offer.id,
      version: offer.current_version,
      sourceId,
      broadcastId,
    },
  );
  return claim;
}
export async function assertLegacyOffer(db: DB, offerId: string) {
  if (
    (
      await db.query("select id from network_drop_supplies where offer_id=$1", [
        offerId,
      ])
    ).length
  )
    throw new RequestError(
      "Manage this network Drop in Network control. Merchant campaign approval and messaging do not apply.",
      409,
    );
}
export async function queueMessage(
  db: DB,
  claim: Claim,
  purpose: "fulfillment" | "merchant",
  broadcastId: string | null = null,
) {
  await assertLegacyOffer(db, claim.offer_id);
  const [sender] = await db.query<{ id: string }>(
    "select id from senders where organization_id=$1",
    [claim.organization_id],
  );
  if (!sender) throw Error("This business is not ready to send passes.");
  await db.query(
    "insert into messages(id,organization_id,customer_id,sender_id,claim_id,broadcast_id,purpose) values($1,$2,$3,$4,$5,$6,$7) on conflict(claim_id,purpose) do nothing",
    [
      id(),
      claim.organization_id,
      claim.customer_id,
      sender.id,
      claim.id,
      broadcastId,
      purpose,
    ],
  );
}
export async function acceptClaim(
  db: DB,
  input: {
    sourceToken: string;
    phone: string;
    merchantConsent: boolean;
    networkConsent: boolean;
  },
) {
  const phone = normalizePhone(input.phone);
  await rateLimit(db, `phone:${hash(phone)}`, 6, 3600);
  return db.transaction(async (tx) => {
    const { source, offer: initial } = await sourceOffer(tx, input.sourceToken);
    await tx.query("select id from offers where id=$1 for update", [
      initial.id,
    ]);
    const { offer } = await sourceOffer(tx, input.sourceToken);
    if (!offerAvailable(offer))
      throw Error("This offer is not accepting new claims right now.");
    if (
      (
        await tx.query(
          "select id from network_drop_supplies where offer_id=$1",
          [offer.id],
        )
      ).length
    )
      throw Error("Join Uptick to see your local Drop choices.");
    await assertClaimReady(tx, offer.organization_id);
    const [customer] = await tx.query<{ id: string }>(
      "insert into customers(id,phone) values($1,$2) on conflict(phone) do update set phone=excluded.phone returning id",
      [id(), phone],
    );
    const [existing] = await tx.query<{ id: string }>(
      "select id from claims where customer_id=$1 and offer_id=$2",
      [customer.id, offer.id],
    );
    const claim = await createEntitlement(tx, offer, customer.id, source.id, {
      source_id: source.id,
      host: source.host,
      placement_id: source.placement_id,
      campaign: source.campaign,
      creative: source.creative,
    });
    const [suppressed] = await tx.query(
      `select 1 from suppressions x join senders s on s.id=x.sender_id where s.organization_id=$1 and x.phone=$2 and x.suppressed`,
      [offer.organization_id, phone],
    );
    if (suppressed)
      throw Error(
        "Texts to this number are stopped. Reply START to the Uptick number from your earlier text, then try again.",
      );
    await consent(
      tx,
      customer.id,
      offer.organization_id,
      phone,
      "fulfillment",
      true,
      offer.merchant,
      "claim",
    );
    // Knowing a phone number and public QR does not authorize changes to an existing pass's
    // marketing choices. Only its first claim records those choices; changes use the private pass.
    if (!existing) {
      await tx.query(
        "insert into claim_consent_choices(claim_id,merchant_requested,network_requested) values($1,$2,$3)",
        [claim.id, input.merchantConsent, input.networkConsent],
      );
      for (const [purpose, value] of [
        ["merchant", input.merchantConsent],
        ["network", input.networkConsent],
      ] as const)
        await consent(
          tx,
          customer.id,
          offer.organization_id,
          phone,
          purpose,
          value,
          offer.merchant,
          "claim",
        );
    }
    await queueMessage(tx, claim, "fulfillment");
    return claim;
  });
}
export async function getPass(db: DB, credential: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential))
    throw Error("This pass link is not valid.");
  const [claim] = await db.query<Claim>(
    "select * from claims where token_hash=$1",
    [hash(credential)],
  );
  if (!claim) throw Error("This pass link is not valid.");
  return claim;
}
export function passState(claim: Claim, now = new Date()) {
  if (claim.state !== "active") return claim.state;
  if (new Date(claim.snapshot.expires_at) <= now) return "expired";
  if (new Date(claim.snapshot.starts_at) > now) return "upcoming";
  return "active";
}
export async function confirmPossession(db: DB, claim: Claim) {
  await db.query(
    "update claims set opened_at=coalesce(opened_at,now()) where id=$1",
    [claim.id],
  );
  await db.query(
    "update relationships set possession_confirmed_at=coalesce(possession_confirmed_at,now()) where customer_id=$1 and organization_id=$2",
    [claim.customer_id, claim.organization_id],
  );
}
export async function getClaimChoices(db: DB, claimId: string) {
  const [choices] = await db.query<{ merchant: boolean; network: boolean }>(
    "select merchant_requested merchant,network_requested network from claim_consent_choices where claim_id=$1",
    [claimId],
  );
  return choices || { merchant: false, network: false };
}
export async function confirmPassChoices(
  db: DB,
  credential: string,
  merchant: boolean,
  network: boolean,
) {
  return db.transaction(async (tx) => {
    const claim = await getPass(tx, credential);
    await confirmPossession(tx, claim);
    const [customer] = await tx.query<{ phone: string }>(
      "select phone from customers where id=$1",
      [claim.customer_id],
    );
    // These are the explicit choices displayed on the private pass. Opening or redeeming
    // alone never confirms marketing, including pending intent created at another merchant.
    await consent(
      tx,
      claim.customer_id,
      claim.organization_id,
      customer.phone,
      "merchant",
      merchant,
      claim.snapshot.merchant,
      "pass-open",
      true,
    );
    await consent(
      tx,
      claim.customer_id,
      claim.organization_id,
      customer.phone,
      "network",
      network,
      claim.snapshot.merchant,
      "pass-open",
      true,
    );
  });
}
export async function redeem(db: DB, credential: string) {
  return db.transaction(async (tx) => {
    const initial = await getPass(tx, credential);
    if (
      (
        await tx.query("select claim_id from member_claims where claim_id=$1", [
          initial.id,
        ])
      ).length
    )
      throw Error(
        "Use the Uptick Tap at the participating store to redeem this pass.",
      );
    await tx.query("select id from offers where id=$1 for update", [
      initial.offer_id,
    ]);
    const claim = await getPass(tx, credential);
    if (claim.state === "redeemed") return claim;
    if (passState(claim) !== "active")
      throw Error("This pass cannot be redeemed. Check its status and dates.");
    if (claim.snapshot.limit_mode === "redemption") {
      const [n] = await tx.query<{ n: number }>(
        "select count(*)::int n from claims where offer_id=$1 and state=$2",
        [claim.offer_id, "redeemed"],
      );
      if (n.n >= (claim.snapshot.quantity || 0))
        throw Error("This offer’s redemption limit has been reached.");
    }
    await confirmPossession(tx, claim);
    const [updated] = await tx.query<Claim>(
      `update claims set state='redeemed',redeemed_at=now() where id=$1 and state='active' returning *`,
      [claim.id],
    );
    await tx.query(
      "insert into redemptions(id,claim_id,organization_id) values($1,$2,$3) on conflict(claim_id) do nothing",
      [id(), claim.id, claim.organization_id],
    );
    await audit(
      tx,
      "customer",
      claim.organization_id,
      "redemption.completed",
      claim.id,
    );
    return updated;
  });
}
export async function joinMerchantDrop(db: DB, credential: string) {
  return db.transaction(async (tx) => {
    const claim = await getPass(tx, credential);
    if (claim.state !== "redeemed")
      throw Error(
        "Redeem this pass before joining from the redemption screen.",
      );
    await confirmPossession(tx, claim);
    const [customer] = await tx.query<{ phone: string }>(
      "select phone from customers where id=$1",
      [claim.customer_id],
    );
    // This CTA displays only the merchant disclosure. It cannot record, confirm,
    // or change a network choice that is absent from that customer action.
    await consent(
      tx,
      claim.customer_id,
      claim.organization_id,
      customer.phone,
      "merchant",
      true,
      claim.snapshot.merchant,
      "post-redemption",
      true,
    );
  });
}
export async function preferences(
  db: DB,
  credential: string,
  merchant: boolean,
  network: boolean,
) {
  return db.transaction(async (tx) => {
    const claim = await getPass(tx, credential);
    await confirmPossession(tx, claim);
    const [c] = await tx.query<{ phone: string }>(
      "select phone from customers where id=$1",
      [claim.customer_id],
    );
    await consent(
      tx,
      claim.customer_id,
      claim.organization_id,
      c.phone,
      "merchant",
      merchant,
      claim.snapshot.merchant,
      "preferences",
      true,
    );
    await consent(
      tx,
      claim.customer_id,
      claim.organization_id,
      c.phone,
      "network",
      network,
      claim.snapshot.merchant,
      "preferences",
      true,
    );
  });
}
export function weekKey(date: Date, timezone: string) {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const d = new Date(`${local}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function isQuietHours(date: Date, timezone: string) {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
  return h < 9 || h >= 20;
}
export type DraftInput = {
  id?: string;
  organizationId: string;
  title: string;
  qualification: string;
  reward: string;
  terms: string;
  startsAt: string;
  expiresAt: string;
  limitMode: "unlimited" | "claim" | "redemption";
  quantity?: number | null;
  submit: boolean;
  kind?: "anchor" | "drop";
  productMetadata?: {
    goal: string;
    templateId: string | null;
    customerValue: number | null;
    rewardCost: number | null;
    requiredPurchase: number | null;
    staffInstructions: string;
  };
};
export async function saveDraft(db: DB, actor: Actor, input: DraftInput) {
  authorize(actor, input.organizationId);
  if (input.kind === "anchor" && actor.role !== "operator")
    throw Error("Only Uptick can create an Anchor.");
  if (
    !input.title.trim() ||
    !input.qualification.trim() ||
    !input.reward.trim() ||
    !input.terms.trim()
  )
    throw Error("Complete the offer and terms.");
  if (
    !Number.isFinite(Date.parse(input.startsAt)) ||
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    new Date(input.expiresAt) <= new Date(input.startsAt)
  )
    throw Error("Choose a valid offer window.");
  if (
    !["unlimited", "claim", "redemption"].includes(input.limitMode) ||
    (input.limitMode !== "unlimited" &&
      (!Number.isInteger(input.quantity) || Number(input.quantity) <= 0))
  )
    throw Error("Choose a positive whole-number offer limit.");
  return db.transaction(async (tx) => {
    let offerId = input.id;
    let version = 1;
    if (offerId) {
      const [old] = await tx.query<Offer>(
        "select * from offers where id=$1 for update",
        [offerId],
      );
      if (!old) throw Error("Draft not found.");
      authorize(actor, old.organization_id);
      if (old.kind === "anchor" && actor.role !== "operator")
        throw Error("Only Uptick can edit an Anchor.");
      if (old.organization_id !== input.organizationId)
        throw Error("Business cannot change.");
      if (input.kind && input.kind !== old.kind)
        throw Error("Offer type cannot change.");
      if (!["draft", "review"].includes(old.state))
        throw Error("Published terms cannot be edited. Create a new offer.");
      if (
        (
          await tx.query(
            "select id from network_drop_supplies where offer_id=$1 and approved_by is not null",
            [offerId],
          )
        ).length
      )
        throw Error(
          "This network Drop has an approved commitment. Create a new offer to change its promise.",
        );
      version = old.current_version + 1;
      await tx.query(
        "update offers set title=$2,current_version=$3,state=$4 where id=$1",
        [offerId, input.title, version, input.submit ? "review" : "draft"],
      );
    } else {
      offerId = id();
      const [location] = await tx.query<{ id: string }>(
        "select id from locations where organization_id=$1 order by created_at limit 1",
        [input.organizationId],
      );
      if (!location) throw Error("Add a business location first.");
      await tx.query(
        "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,$4,$5,$6)",
        [
          offerId,
          input.organizationId,
          location.id,
          input.kind || "drop",
          input.submit ? "review" : "draft",
          input.title,
        ],
      );
    }
    await tx.query(
      "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        offerId,
        version,
        input.qualification,
        input.reward,
        input.terms,
        input.startsAt,
        input.expiresAt,
        input.limitMode,
        input.limitMode === "unlimited" ? null : input.quantity,
      ],
    );
    if (input.productMetadata) {
      const m = input.productMetadata;
      await tx.query(
        "insert into offer_product_metadata(offer_id,version,goal,template_id,customer_value,reward_cost,required_purchase,staff_instructions) values($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          offerId,
          version,
          m.goal,
          m.templateId,
          m.customerValue,
          m.rewardCost,
          m.requiredPurchase,
          m.staffInstructions,
        ],
      );
    } else if (version > 1)
      await tx.query(
        "insert into offer_product_metadata(offer_id,version,goal,template_id,customer_value,reward_cost,required_purchase,staff_instructions) select offer_id,$2,goal,template_id,customer_value,reward_cost,required_purchase,staff_instructions from offer_product_metadata where offer_id=$1 and version=$3",
        [offerId, version, version - 1],
      );
    await audit(
      tx,
      actor.id,
      input.organizationId,
      input.submit ? "offer.submitted" : "offer.drafted",
      offerId,
      { version },
    );
    return offerId;
  });
}
export async function approve(
  db: DB,
  actor: Actor,
  offerId: string,
  scheduledAt: string,
) {
  return db.transaction(async (tx) => {
    await tx.query("select id from offers where id=$1 for update", [offerId]);
    const [offer] = await tx.query<Offer>(`${offerSelect} where o.id=$1`, [
      offerId,
    ]);
    if (!offer) throw Error("Offer not found.");
    authorize(actor, offer.organization_id, true);
    await assertLegacyOffer(tx, offer.id);
    await tx.query("select id from organizations where id=$1 for update", [
      offer.organization_id,
    ]);
    if (offer.state !== "review")
      throw Error("Only submitted offers can be approved.");
    await assertApprovalReady(tx, offer.organization_id);
    if (!/\bfree\b/i.test(offer.reward))
      throw Error(
        "Name the free item in the reward before approving this offer.",
      );
    const when = new Date(scheduledAt);
    if (
      !Number.isFinite(when.getTime()) ||
      when < new Date() ||
      when >= new Date(offer.expires_at) ||
      when < new Date(offer.starts_at)
    )
      throw Error("Schedule within the offer window and in the future.");
    if (offer.kind === "drop") {
      if (isQuietHours(when, offer.timezone))
        throw Error(
          "Schedule between 9 AM and 8 PM in the business’s time zone.",
        );
      const week = weekKey(when, offer.timezone);
      const used = await tx.query(
        "select id from broadcasts where organization_id=$1 and week_key=$2 and state <> 'paused'",
        [offer.organization_id, week],
      );
      if (used.length)
        throw Error(
          "This business already has a Weekly Drop scheduled or sent for that week.",
        );
      await tx.query(
        "insert into broadcasts(id,offer_id,organization_id,scheduled_at,week_key,approved_by) values($1,$2,$3,$4,$5,$6)",
        [id(), offer.id, offer.organization_id, scheduledAt, week, actor.id],
      );
    }
    await tx.query(`update offers set state=$2 where id=$1`, [
      offerId,
      offer.kind === "anchor" ? "live" : "scheduled",
    ]);
    await tx.query(
      "insert into offer_reviews(id,offer_id,offer_version,decision,note,actor) values($1,$2,$3,'approved',$4,$5)",
      [
        id(),
        offerId,
        offer.current_version,
        `Approved for ${scheduledAt}.`,
        actor.id,
      ],
    );
    await audit(
      tx,
      actor.id,
      offer.organization_id,
      "offer.approved",
      offerId,
      { scheduledAt, version: offer.current_version },
    );
  });
}
export async function pauseOffer(db: DB, actor: Actor, offerId: string) {
  return db.transaction(async (tx) => {
    const [o] = await tx.query<Offer>(
      "select * from offers where id=$1 for update",
      [offerId],
    );
    if (!o) throw Error("Offer not found.");
    authorize(actor, o.organization_id, true);
    await assertLegacyOffer(tx, o.id);
    await tx.query("update offers set state='paused' where id=$1", [offerId]);
    await tx.query(
      "update broadcasts set state='paused' where offer_id=$1 and state='scheduled'",
      [offerId],
    );
    await tx.query(
      "update messages set state='canceled',suppression_reason='Offer paused',updated_at=now() where broadcast_id in(select id from broadcasts where offer_id=$1) and state='queued'",
      [offerId],
    );
    await audit(tx, actor.id, o.organization_id, "offer.paused", offerId, {
      existingClaims: "remain valid",
    });
  });
}
