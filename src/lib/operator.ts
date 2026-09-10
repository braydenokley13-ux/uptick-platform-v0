import type { DB } from "./db";
import {
  audit,
  authorize,
  offerSelect,
  type Actor,
  type Offer,
} from "./domain";
import { id, token, normalizePhone, hash } from "./security";
import { RequestError } from "./http";

export function operatorOnly(actor: Actor) {
  authorize(actor, actor.organizationId, true);
}
export type Business = {
  id: string;
  name: string;
  capabilities: string[];
  timezone: string;
  is_demo: boolean;
  category: string;
  growth_goal: string;
  locations: number;
  offers: number;
  subscribers: number;
  sender_approved: boolean;
};
export type PlacementSource = {
  id: string;
  token: string;
  offer_id: string;
  organization_id: string;
  merchant: string;
  offer_title: string;
  offer_state: string;
  host: string;
  placement_id: string;
  placement: string;
  status: string;
  confirmed_at: string | null;
  external_reference: string | null;
  campaign: string;
  creative: string;
  state: string;
  created_at: string;
  visits: number;
  claims: number;
  redemptions: number;
  optins: number;
  last_visit: string | null;
  placement_type: string;
  environment: string;
  dwell_context: string;
};
export const placementSelect = `select s.id,s.token,s.offer_id,o.organization_id,g.name merchant,o.title offer_title,o.state offer_state,h.name host,p.id placement_id,p.name placement,p.status,p.confirmed_at,p.external_reference,s.campaign,s.creative,s.state,s.created_at,coalesce(pc.placement_type,'wall TV') placement_type,coalesce(pc.environment,'') environment,coalesce(pc.dwell_context,'') dwell_context,(select count(*)::int from source_visits where source_id=s.id) visits,(select count(*)::int from claims where source_id=s.id) claims,(select count(*)::int from claims where source_id=s.id and state='redeemed') redemptions,(select count(distinct c.customer_id)::int from claims c join subscriptions su on su.customer_id=c.customer_id and su.organization_id=c.organization_id and su.state='subscribed' where c.source_id=s.id) optins,(select max(created_at) from source_visits where source_id=s.id) last_visit from sources s join offers o on o.id=s.offer_id join organizations g on g.id=o.organization_id left join placements p on p.id=s.placement_id left join locations l on l.id=p.location_id left join organizations h on h.id=l.organization_id left join placement_context pc on pc.placement_id=p.id`;
export async function operatorOverview(db: DB, actor: Actor) {
  operatorOnly(actor);
  const businesses = await db.query<Business>(
    `select g.id,g.name,g.capabilities,g.timezone,g.is_demo,coalesce(p.category,'') category,coalesce(p.growth_goal,'') growth_goal,(select count(*)::int from locations where organization_id=g.id) locations,(select count(*)::int from offers where organization_id=g.id and state in ('live','scheduled')) offers,(select count(*)::int from subscriptions where organization_id=g.id and state='subscribed') subscribers,coalesce(s.approved,false) sender_approved from organizations g left join business_profiles p on p.organization_id=g.id left join senders s on s.organization_id=g.id order by g.name`,
  );
  const offers = await db.query<Offer>(
    `${offerSelect} order by o.created_at desc`,
  );
  const sources = await db.query<PlacementSource>(
    `${placementSelect} order by s.created_at desc`,
  );
  const messages = await db.query<SafeMessage>(
    `${messageSelect} order by m.created_at desc limit 80`,
  );
  const broadcasts = await db.query<{
    id: string;
    offer_id: string;
    merchant: string;
    title: string;
    scheduled_at: string;
    state: string;
  }>(
    `select b.id,b.offer_id,g.name merchant,o.title,b.scheduled_at,b.state from broadcasts b join offers o on o.id=b.offer_id join organizations g on g.id=b.organization_id order by b.scheduled_at desc limit 30`,
  );
  const locations = await db.query<{
    id: string;
    organization_id: string;
    name: string;
    address: string;
    business: string;
    capabilities: string[];
    category: string;
  }>(
    `select l.*,g.name business,g.capabilities,coalesce(p.category,'') category from locations l join organizations g on g.id=l.organization_id left join business_profiles p on p.organization_id=g.id order by g.name,l.name`,
  );
  return {
    businesses,
    offers,
    sources,
    messages,
    broadcasts,
    locations,
    evaluatedAt: new Date().toISOString(),
  };
}
export type SafeMessage = {
  id: string;
  organization_id: string;
  customer_id: string;
  claim_id: string;
  merchant: string;
  phone_suffix: string;
  purpose: string;
  state: string;
  provider_sid: string | null;
  error_code: string | null;
  suppression_reason: string | null;
  created_at: string;
  updated_at: string;
};
const messageSelect = `select m.id,m.organization_id,m.customer_id,m.claim_id,g.name merchant,right(c.phone,4) phone_suffix,m.purpose,m.state,m.provider_sid,m.error_code,m.suppression_reason,m.created_at,m.updated_at from messages m join customers c on c.id=m.customer_id join organizations g on g.id=m.organization_id`;
export async function operatorMessage(db: DB, actor: Actor, messageId: string) {
  operatorOnly(actor);
  return db.query<SafeMessage>(`${messageSelect} where m.id=$1`, [messageId]);
}
export async function assertPlacementCompatible(
  db: DB,
  offerId: string,
  locationId: string,
) {
  const [match] = await db.query<{
    merchant: string;
    host: string;
    capabilities: string[];
    merchant_category: string | null;
    host_category: string | null;
  }>(
    `select o.organization_id merchant,l.organization_id host,g.capabilities,mp.category merchant_category,hp.category host_category from offers o cross join locations l join organizations g on g.id=l.organization_id left join business_profiles hp on hp.organization_id=l.organization_id left join business_profiles mp on mp.organization_id=o.organization_id where o.id=$1 and l.id=$2`,
    [offerId, locationId],
  );
  if (!match) throw Error("Choose an existing offer and host location.");
  if (!match.capabilities.includes("host"))
    throw Error("This location is not configured as a host.");
  if (match.merchant === match.host)
    throw Error("Choose a different host business for local acquisition.");
  if (
    match.merchant_category &&
    match.merchant_category !== "other" &&
    match.host_category &&
    match.merchant_category === match.host_category
  )
    throw Error(
      "Direct competitor — blocked. Choose a host in a different business category.",
    );
  return match;
}
export async function createPlacementSource(
  db: DB,
  actor: Actor,
  input: {
    offerId: string;
    locationId: string;
    placement: string;
    campaign: string;
    creative: string;
    placementType: string;
    environment: string;
    dwellContext: string;
  },
) {
  operatorOnly(actor);
  return db.transaction(async (tx) => {
    const match = await assertPlacementCompatible(
      tx,
      input.offerId,
      input.locationId,
    );
    const placementId = id(),
      sourceId = id();
    await tx.query(
      "insert into placements(id,location_id,name) values($1,$2,$3)",
      [placementId, input.locationId, input.placement],
    );
    await tx.query(
      "insert into placement_context(placement_id,placement_type,environment,dwell_context) values($1,$2,$3,$4)",
      [placementId, input.placementType, input.environment, input.dwellContext],
    );
    await tx.query(
      "insert into sources(id,token,offer_id,placement_id,campaign,creative) values($1,$2,$3,$4,$5,$6)",
      [
        sourceId,
        token().slice(0, 22),
        input.offerId,
        placementId,
        input.campaign,
        input.creative,
      ],
    );
    await tx.query(
      "insert into placement_events(id,placement_id,status,note,actor) values($1,$2,'intended','Placement created; external screen handoff not confirmed.',$3)",
      [id(), placementId, actor.id],
    );
    await audit(tx, actor.id, match.merchant, "source.created", sourceId, {
      placementId,
      categoryCheck:
        match.merchant_category && match.host_category
          ? "compatible"
          : "categories incomplete",
    });
    return sourceId;
  });
}
export async function confirmPlacement(
  db: DB,
  actor: Actor,
  input: {
    id: string;
    status: "confirmed" | "intended" | "paused";
    note: string;
    externalReference: string;
  },
) {
  operatorOnly(actor);
  return db.transaction(async (tx) => {
    if (
      !["confirmed", "intended", "paused"].includes(input.status) ||
      input.note.trim().length < 5
    )
      throw Error("Add a clear placement handoff note.");
    const [p] = await tx.query<{ id: string; location_id: string }>(
      "select id,location_id from placements where id=$1 for update",
      [input.id],
    );
    if (!p) throw Error("Placement not found.");
    // Business categories can change after a source is prepared. Check again at the actual handoff.
    if (input.status === "confirmed")
      for (const source of await tx.query<{ offer_id: string }>(
        "select distinct offer_id from sources where placement_id=$1 and state='active'",
        [input.id],
      ))
        await assertPlacementCompatible(tx, source.offer_id, p.location_id);
    await tx.query(
      "update placements set status=$2,external_reference=$3,confirmed_at=case when $2='confirmed' then now() else null end where id=$1",
      [input.id, input.status, input.externalReference || null],
    );
    await tx.query(
      "insert into placement_events(id,placement_id,status,note,external_reference,actor) values($1,$2,$3,$4,$5,$6)",
      [
        id(),
        input.id,
        input.status,
        input.note,
        input.externalReference || null,
        actor.id,
      ],
    );
    await audit(tx, actor.id, null, "placement.updated", input.id, {
      status: input.status,
      note: input.note,
    });
  });
}
export async function reviewDecision(
  db: DB,
  actor: Actor,
  input: { offerId: string; decision: "returned" | "rejected"; note: string },
) {
  operatorOnly(actor);
  return db.transaction(async (tx) => {
    const [o] = await tx.query<Offer>(
      "select * from offers where id=$1 for update",
      [input.offerId],
    );
    if (!o || o.state !== "review")
      throw Error("Only an offer awaiting review can be returned or rejected.");
    if (!input.note.trim()) throw Error("Add a clear note for the merchant.");
    await tx.query(
      "insert into offer_reviews(id,offer_id,offer_version,decision,note,actor) values($1,$2,$3,$4,$5,$6)",
      [id(), o.id, o.current_version, input.decision, input.note, actor.id],
    );
    await tx.query("update offers set state='draft' where id=$1", [o.id]);
    await audit(
      tx,
      actor.id,
      o.organization_id,
      `offer.${input.decision}`,
      o.id,
      { version: o.current_version, note: input.note },
    );
  });
}
export type Creative = {
  id: string;
  source_id: string;
  parent_source_id: string | null;
  version: number;
  offer_version: number;
  headline: string;
  cta: string;
  format: "landscape" | "countertop";
  notes: string;
  created_at: string;
  merchant_name: string;
  is_demo: boolean;
};
export async function createCreative(
  db: DB,
  actor: Actor,
  input: {
    sourceId: string;
    headline: string;
    cta: string;
    format: "landscape" | "countertop";
    notes: string;
  },
) {
  operatorOnly(actor);
  return db.transaction(async (tx) => {
    // Serialize first saves and replacements so one source cannot gain competing successor QR codes.
    const [locked] = await tx.query<{ offer_id: string }>(
      "select offer_id from sources where id=$1 for update",
      [input.sourceId],
    );
    if (!locked) throw Error("Source not found.");
    await tx.query("select id from offers where id=$1 for update", [
      locked.offer_id,
    ]);
    const [s] = await tx.query<PlacementSource>(
      `${placementSelect} where s.id=$1`,
      [input.sourceId],
    );
    if (!s) throw Error("Source not found.");
    const [offer] = await tx.query<Offer>(`${offerSelect} where o.id=$1`, [
      s.offer_id,
    ]);
    if (!["live", "scheduled", "review"].includes(offer.state))
      throw Error(
        "Submit or publish this offer before preparing screen creative.",
      );
    const [existing] = await tx.query<Creative>(
      "select * from source_creatives where source_id=$1",
      [s.id],
    );
    let sourceId = s.id;
    const version = (existing?.version || 0) + 1;
    if (
      existing &&
      (
        await tx.query(
          "select id from source_creatives where parent_source_id=$1",
          [s.id],
        )
      ).length
    )
      throw Error(
        "This creative already has a replacement. Open the latest creative source to make another version.",
      );
    if (existing) {
      sourceId = id();
      await tx.query(
        "insert into sources(id,token,offer_id,placement_id,campaign,creative) values($1,$2,$3,$4,$5,$6)",
        [
          sourceId,
          token().slice(0, 22),
          s.offer_id,
          s.placement_id,
          s.campaign,
          `${input.headline} · v${version}`,
        ],
      );
    }
    await tx.query(
      "insert into source_creatives(id,source_id,parent_source_id,version,offer_version,headline,cta,format,notes,created_by,merchant_name,is_demo) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        id(),
        sourceId,
        existing ? s.id : null,
        version,
        offer.current_version,
        input.headline,
        input.cta,
        input.format,
        input.notes,
        actor.id,
        offer.merchant,
        offer.is_demo,
      ],
    );
    if (s.placement_id) {
      await tx.query(
        "update placements set status='intended',confirmed_at=null where id=$1",
        [s.placement_id],
      );
      await tx.query(
        "insert into placement_events(id,placement_id,status,note,actor) values($1,$2,'intended',$3,$4)",
        [
          id(),
          s.placement_id,
          `Creative version ${version} prepared for source ${sourceId}. A fresh external handoff confirmation is needed.`,
          actor.id,
        ],
      );
    }
    await audit(tx, actor.id, s.organization_id, "creative.created", sourceId, {
      version,
      offerVersion: offer.current_version,
      replaces: existing ? s.id : null,
    });
    return sourceId;
  });
}
export async function creativeExportData(
  db: DB,
  actor: Actor,
  sourceId: string,
) {
  operatorOnly(actor);
  const [creative] = await db.query<
    Creative & {
      token: string;
      merchant: string;
      qualification: string;
      reward: string;
      terms: string;
      expires_at: string;
    }
  >(
    `select cr.*,s.token,cr.merchant_name merchant,v.qualification,v.reward,v.terms,v.expires_at from source_creatives cr join sources s on s.id=cr.source_id join offer_versions v on v.offer_id=s.offer_id and v.version=cr.offer_version where cr.source_id=$1`,
    [sourceId],
  );
  return creative || null;
}
export async function sourceDetail(db: DB, actor: Actor, sourceId: string) {
  operatorOnly(actor);
  const [source] = await db.query<PlacementSource>(
    `${placementSelect} where s.id=$1`,
    [sourceId],
  );
  if (!source) return null;
  const history = await db.query<{
    id: string;
    status: string;
    note: string;
    external_reference: string | null;
    created_at: string;
  }>(
    "select id,status,note,external_reference,created_at from placement_events where placement_id=$1 order by created_at desc",
    [source.placement_id],
  );
  const [creative] = await db.query<Creative>(
    "select * from source_creatives where source_id=$1",
    [sourceId],
  );
  const children = await db.query<Creative>(
    "select * from source_creatives where parent_source_id=$1 order by created_at desc",
    [sourceId],
  );
  const [offer] = await db.query<Offer>(`${offerSelect} where o.id=$1`, [
    source.offer_id,
  ]);
  return { source, history, creative, children, offer };
}
export type TimelineEvent = {
  id: string;
  at: string;
  title: string;
  detail: string;
  tone: string;
};
export async function customerTimeline(
  db: DB,
  actor: Actor,
  query: string,
  organizationId: string,
) {
  operatorOnly(actor);
  if (!query || !organizationId) return null;
  let phone = "";
  try {
    phone = normalizePhone(query);
  } catch {
    /* A support reference is also accepted. */
  }
  const reference = query.trim().split("/").pop() || "";
  let customer: { id: string; phone_suffix: string } | undefined;
  if (/^UP-[a-f0-9]{6}$/i.test(reference)) {
    // The printed suffix is convenient for support, but it is not globally unique.
    // Check claim matches within this merchant before returning any customer data.
    const matches = await db.query<{ id: string; phone_suffix: string }>(
      `select c.id,right(c.phone,4) phone_suffix from claims cl join customers c on c.id=cl.customer_id join relationships r on r.customer_id=c.id and r.organization_id=cl.organization_id where cl.organization_id=$1 and lower(right(cl.id,6))=$2 limit 2`,
      [organizationId, reference.slice(3).toLowerCase()],
    );
    if (matches.length > 1)
      throw new RequestError(
        "This short reference matches more than one pass for this merchant. Ask for the full pass reference or the customer's phone number.",
      );
    customer = matches[0];
  } else {
    [customer] = await db.query<{ id: string; phone_suffix: string }>(
      `select distinct c.id,right(c.phone,4) phone_suffix from customers c join relationships r on r.customer_id=c.id left join claims cl on cl.customer_id=c.id and cl.organization_id=r.organization_id left join messages m on m.claim_id=cl.id where r.organization_id=$1 and (c.phone=$2 or c.id=$3 or cl.id=$3 or m.id=$3 or m.provider_sid=$3 or cl.token_hash=$4) limit 1`,
      [organizationId, phone, reference, hash(reference)],
    );
  }
  if (!customer) return null;
  const claims = await db.query<{
    id: string;
    title: string;
    state: string;
    created_at: string;
    opened_at: string | null;
    redeemed_at: string | null;
    broadcast_id: string | null;
    source_name: string | null;
  }>(
    `select c.id,o.title,c.state,c.created_at,c.opened_at,c.redeemed_at,c.broadcast_id,s.campaign source_name from claims c join offers o on o.id=c.offer_id left join sources s on s.id=c.source_id where c.customer_id=$1 and c.organization_id=$2 order by c.created_at`,
    [customer.id, organizationId],
  );
  const messages = await db.query<SafeMessage>(
    `${messageSelect} where m.customer_id=$1 and m.organization_id=$2 order by m.created_at`,
    [customer.id, organizationId],
  );
  const consents = await db.query<{
    id: string;
    purpose: string;
    accepted: boolean;
    source_ui: string;
    created_at: string;
    disclosure_version: string;
  }>(
    `select id,purpose,accepted,source_ui,created_at,disclosure_version from consent_events where customer_id=$1 and organization_id=$2 order by created_at`,
    [customer.id, organizationId],
  );
  const callbacks = await db.query<{
    id: string;
    state: string;
    error_code: string | null;
    created_at: string;
  }>(
    `select e.id,e.state,e.error_code,e.created_at from message_events e join messages m on m.id=e.message_id where m.customer_id=$1 and m.organization_id=$2`,
    [customer.id, organizationId],
  );
  const events: TimelineEvent[] = [];
  for (const c of claims) {
    events.push({
      id: `claim-${c.id}`,
      at: c.created_at,
      title: c.broadcast_id ? "Weekly Drop pass created" : "Claim accepted",
      detail: `${c.title} · ${c.id}${c.source_name ? ` · ${c.source_name}` : ""}`,
      tone: "mint",
    });
    if (c.opened_at)
      events.push({
        id: `open-${c.id}`,
        at: c.opened_at,
        title: "Phone possession confirmed",
        detail: "Customer completed the explicit pass action.",
        tone: "neutral",
      });
    if (c.redeemed_at)
      events.push({
        id: `redeem-${c.id}`,
        at: c.redeemed_at,
        title: c.broadcast_id
          ? "Drop redemption recorded"
          : "Initial redemption recorded",
        detail: c.title,
        tone: "mint",
      });
  }
  for (const m of messages)
    events.push({
      id: `message-${m.id}`,
      at: m.created_at,
      title: `${m.purpose === "merchant" ? "Weekly Drop" : "Pass"} message · ${m.state}`,
      detail: [
        m.id,
        m.error_code ? `Provider code ${m.error_code}` : "",
        m.suppression_reason || "",
      ]
        .filter(Boolean)
        .join(" · "),
      tone: ["failed", "undelivered"].includes(m.state) ? "amber" : "neutral",
    });
  for (const c of consents)
    events.push({
      id: `consent-${c.id}`,
      at: c.created_at,
      title: `${c.purpose === "merchant" ? "Merchant marketing" : "Requested pass"} consent ${c.accepted ? "accepted" : "declined"}`,
      detail: `${c.source_ui} · disclosure ${c.disclosure_version}`,
      tone: "neutral",
    });
  for (const e of callbacks)
    events.push({
      id: e.id,
      at: e.created_at,
      title: `Provider callback · ${e.state}`,
      detail: e.error_code
        ? `Provider code ${e.error_code}`
        : "Provider status recorded. Delivery does not prove a message was read.",
      tone: "neutral",
    });
  const subscriptions = await db.query<{ state: string; updated_at: string }>(
    "select state,updated_at from subscriptions where customer_id=$1 and organization_id=$2",
    [customer.id, organizationId],
  );
  return {
    customer,
    claims,
    messages,
    subscriptions,
    events: events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  };
}
