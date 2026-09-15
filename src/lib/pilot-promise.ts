import { createHash } from "node:crypto";
import { z } from "zod";
import type { DB } from "./db";
import { audit, type Actor, type Snapshot } from "./domain";
import { demandEvent } from "./demand-events";
import { RequestError } from "./http";
import { marketWeekWindow, supplyUsage, type Allocation } from "./network";
import { id } from "./security";
import { operationalPilotAudience } from "./member-service";
import { recommendPilotAssignments } from "./pilot-assignment";

const dataKind = z.enum(["real", "internal", "demo", "synthetic"]);
const key = z.string().trim().min(1).max(100);
const shortText = z.string().trim().min(1).max(200);
const note = z.string().trim().min(10).max(1500);
const weekKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zeroMoney = z.coerce
  .number()
  .finite()
  .refine((value) => value === 0, {
    message:
      "The core weekly Uptick must have no required spend or member fee.",
  });
const instant = z
  .string()
  .trim()
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "Choose a valid date and time.",
  )
  .transform((value) => new Date(value).toISOString());

function requireOperator(actor: Actor) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
}

function dateValue(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function assertNoPurchaseLanguage(...values: string[]) {
  const promise = values.join(" ").toLowerCase();
  const withoutNoPurchase = promise
    .replaceAll("no purchase required", "")
    .replaceAll("no purchase necessary", "");
  if (
    /\b(buy|spend|minimum purchase|fuel purchase|purchase of|with any purchase|with a purchase|qualifying purchase|paid upgrade)\b|\$\s*\d/.test(
      withoutNoPurchase,
    )
  )
    throw new RequestError(
      "The saved offer language requires spending. Create a no-purchase offer before certifying pilot supply.",
    );
}

export type PilotSupplyTerms = {
  supply_id: string;
  exact_item: string;
  item_sku: string;
  size_label: string;
  usable_hours: string;
  dependency_key: string;
  required_spend: number | string;
  member_fee: number | string;
  funder_organization_id: string;
  fulfiller_organization_id: string;
  data_kind: "real" | "internal" | "demo" | "synthetic";
};

export type DestinationReadiness = {
  supply_id: string;
  organization_id: string;
  location_id: string;
  state: "not_ready" | "ready" | "restricted" | "suspended";
  owner_approved_by: string | null;
  primary_manager: string;
  primary_contact: string;
  backup_contact: string;
  stock_confirmed_at: string | null;
  exact_item_confirmed: boolean;
  staff_instructions_confirmed: boolean;
  shifts_briefed_at: string | null;
  valid_hours_confirmed: boolean;
  qr_rehearsed_at: string | null;
  support_escalation: string;
  valid_until: string | null;
};

export type PilotFallback = {
  id: string;
  supply_id: string;
  substitute_item: string;
  substitute_sku: string;
  size_label: string;
  dependency_key: string;
  usable_capacity: number;
  required_spend: number | string;
  member_fee: number | string;
  instructions: string;
  payer_organization_id: string;
  state: "draft" | "approved" | "paused" | "exhausted";
  approved_by: string | null;
};

const supplyTermsInput = z.object({
  supplyId: key,
  exactItem: z.string().trim().min(3).max(200),
  itemSku: z.string().trim().min(1).max(100),
  sizeLabel: z.string().trim().min(1).max(100),
  usableHours: z.string().trim().min(3).max(500),
  dependencyKey: z.string().trim().min(3).max(100),
  requiredSpend: zeroMoney,
  memberFee: zeroMoney,
  funderOrganizationId: key,
  fulfillerOrganizationId: key,
  dataKind,
});

export async function configurePilotSupply(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const input = supplyTermsInput.parse(raw);
  return db.transaction(async (tx) => {
    const [supply] = await tx.query<{
      id: string;
      organization_id: string;
      market_id: string;
      state: string;
      approved_by: string | null;
      inventory_policy: string;
      quantity: number | null;
      qualification: string;
      reward: string;
      terms: string;
      is_demo: boolean;
      market_data_kind: string;
    }>(
      `select s.*,v.qualification,v.reward,v.terms,o.is_demo,m.data_kind market_data_kind
       from network_drop_supplies s
       join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version
       join organizations o on o.id=s.organization_id
       join market_cells m on m.id=s.market_id
       where s.id=$1 for update of s`,
      [input.supplyId],
    );
    if (!supply) throw new RequestError("Choose an existing Drop supply.", 404);
    if (!["draft", "review"].includes(supply.state) || supply.approved_by)
      throw new RequestError(
        "Configure the exact pilot promise before approving this supply.",
      );
    if (supply.inventory_policy === "unlimited" || !supply.quantity)
      throw new RequestError(
        "Pilot supply must have a finite positive quantity.",
      );
    if (input.fulfillerOrganizationId !== supply.organization_id)
      throw new RequestError(
        "The fulfiller must own the location attached to this supply.",
      );
    if (input.dataKind !== supply.market_data_kind)
      throw new RequestError(
        "The supply and Market Cell must have the same real/test classification.",
      );
    if (input.dataKind === "real" && supply.is_demo)
      throw new RequestError(
        "Demo organizations cannot fund real pilot supply.",
      );
    const [funder] = await tx.query<{ id: string; is_demo: boolean }>(
      "select id,is_demo from organizations where id=$1",
      [input.funderOrganizationId],
    );
    if (!funder)
      throw new RequestError("Choose an existing funding organization.");
    if (input.dataKind === "real" && funder.is_demo)
      throw new RequestError(
        "Demo organizations cannot fund real pilot supply.",
      );
    assertNoPurchaseLanguage(supply.qualification, supply.reward, supply.terms);
    await tx.query(
      "update network_drop_supplies set data_kind=$2 where id=$1",
      [supply.id, input.dataKind],
    );
    await tx.query(
      `insert into pilot_supply_terms(
        supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
        required_spend,member_fee,funder_organization_id,fulfiller_organization_id,
        data_kind,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict(supply_id) do update set
        exact_item=excluded.exact_item,item_sku=excluded.item_sku,
        size_label=excluded.size_label,usable_hours=excluded.usable_hours,
        dependency_key=excluded.dependency_key,required_spend=excluded.required_spend,
        member_fee=excluded.member_fee,funder_organization_id=excluded.funder_organization_id,
        fulfiller_organization_id=excluded.fulfiller_organization_id,
        data_kind=excluded.data_kind,created_by=excluded.created_by,created_at=now()`,
      [
        supply.id,
        input.exactItem,
        input.itemSku,
        input.sizeLabel,
        input.usableHours,
        input.dependencyKey,
        input.requiredSpend,
        input.memberFee,
        input.funderOrganizationId,
        input.fulfillerOrganizationId,
        input.dataKind,
        actor.id,
      ],
    );
    await audit(
      tx,
      actor.id,
      supply.organization_id,
      "pilot.supply_terms_saved",
      supply.id,
      {
        exactItem: input.exactItem,
        itemSku: input.itemSku,
        sizeLabel: input.sizeLabel,
        usableHours: input.usableHours,
        requiredSpend: 0,
        memberFee: 0,
        funderOrganizationId: input.funderOrganizationId,
        fulfillerOrganizationId: input.fulfillerOrganizationId,
        dataKind: input.dataKind,
      },
    );
    return supply.id;
  });
}

const fallbackInput = z.object({
  supplyId: key,
  substituteItem: z.string().trim().min(3).max(200),
  substituteSku: z.string().trim().min(1).max(100),
  sizeLabel: z.string().trim().min(1).max(100),
  dependencyKey: z.string().trim().min(3).max(100),
  usableCapacity: z.coerce.number().int().positive().max(1_000_000),
  requiredSpend: zeroMoney,
  memberFee: zeroMoney,
  instructions: note,
  payerOrganizationId: key,
  approve: z.boolean().default(false),
});

export async function savePilotFallback(db: DB, actor: Actor, raw: unknown) {
  requireOperator(actor);
  const input = fallbackInput.parse(raw);
  return db.transaction(async (tx) => {
    const [supply] = await tx.query<{
      organization_id: string;
      state: string;
      approved_by: string | null;
      dependency_key: string;
      data_kind: string;
    }>(
      `select s.organization_id,s.state,s.approved_by,t.dependency_key,t.data_kind
       from network_drop_supplies s join pilot_supply_terms t on t.supply_id=s.id
       where s.id=$1 for update of s`,
      [input.supplyId],
    );
    if (!supply)
      throw new RequestError("Save the exact pilot supply terms first.");
    if (supply.approved_by || !["draft", "review"].includes(supply.state))
      throw new RequestError(
        "Define the fallback before approving this supply.",
      );
    if (
      input.dependencyKey.toLowerCase().replace(/[^a-z0-9]/g, "") ===
      supply.dependency_key.toLowerCase().replace(/[^a-z0-9]/g, "")
    )
      throw new RequestError(
        "The fallback must use a different underlying resource than the primary item.",
      );
    const [payer] = await tx.query<{ id: string; is_demo: boolean }>(
      "select id,is_demo from organizations where id=$1",
      [input.payerOrganizationId],
    );
    if (!payer) throw new RequestError("Choose an existing fallback payer.");
    if (supply.data_kind === "real" && payer.is_demo)
      throw new RequestError(
        "Demo organizations cannot pay for a real pilot fallback.",
      );
    const fallbackId = id();
    const [saved] = await tx.query<{ id: string }>(
      `insert into pilot_supply_fallbacks(
        id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
        usable_capacity,required_spend,member_fee,instructions,payer_organization_id,
        state,approved_by,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict(supply_id) do update set
        substitute_item=excluded.substitute_item,substitute_sku=excluded.substitute_sku,
        size_label=excluded.size_label,dependency_key=excluded.dependency_key,
        usable_capacity=excluded.usable_capacity,required_spend=excluded.required_spend,
        member_fee=excluded.member_fee,instructions=excluded.instructions,
        payer_organization_id=excluded.payer_organization_id,state=excluded.state,
        approved_by=excluded.approved_by,updated_at=now()
       returning id`,
      [
        fallbackId,
        input.supplyId,
        input.substituteItem,
        input.substituteSku,
        input.sizeLabel,
        input.dependencyKey,
        input.usableCapacity,
        input.requiredSpend,
        input.memberFee,
        input.instructions,
        input.payerOrganizationId,
        input.approve ? "approved" : "draft",
        input.approve ? actor.id : null,
        actor.id,
      ],
    );
    await audit(
      tx,
      actor.id,
      supply.organization_id,
      "pilot.fallback_saved",
      saved.id,
      {
        supplyId: input.supplyId,
        substituteItem: input.substituteItem,
        usableCapacity: input.usableCapacity,
        payerOrganizationId: input.payerOrganizationId,
        approved: input.approve,
        independentDependency: true,
      },
    );
    return saved.id;
  });
}

const readinessInput = z.object({
  supplyId: key,
  state: z.enum(["not_ready", "ready", "restricted", "suspended"]),
  ownerApprovedBy: z.string().trim().max(200).nullable().default(null),
  primaryManager: z.string().trim().max(200).default(""),
  primaryContact: z.string().trim().max(300).default(""),
  backupContact: z.string().trim().max(300).default(""),
  stockConfirmedAt: instant.nullable().default(null),
  exactItemConfirmed: z.boolean().default(false),
  staffInstructionsConfirmed: z.boolean().default(false),
  shiftsBriefedAt: instant.nullable().default(null),
  validHoursConfirmed: z.boolean().default(false),
  qrRehearsedAt: instant.nullable().default(null),
  supportEscalation: z.string().trim().max(1500).default(""),
  validUntil: instant.nullable().default(null),
});

export async function saveDestinationReadiness(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  requireOperator(actor);
  const input = readinessInput.parse(raw);
  return db.transaction(async (tx) => {
    const [supply] = await tx.query<{
      organization_id: string;
      location_id: string;
      state: string;
      approved_by: string | null;
    }>("select * from network_drop_supplies where id=$1 for update", [
      input.supplyId,
    ]);
    if (!supply) throw new RequestError("Choose an existing Drop supply.", 404);
    if (input.state === "ready") {
      const now = new Date();
      if (supply.state !== "approved" || !supply.approved_by)
        throw new RequestError(
          "Approve the exact supply before marking its counter ready.",
        );
      if (
        !input.ownerApprovedBy ||
        input.primaryManager.length < 2 ||
        input.primaryContact.length < 3 ||
        input.backupContact.length < 3 ||
        !input.stockConfirmedAt ||
        new Date(input.stockConfirmedAt) > now ||
        now.getTime() - new Date(input.stockConfirmedAt).getTime() >
          72 * 60 * 60 * 1000 ||
        !input.exactItemConfirmed ||
        !input.staffInstructionsConfirmed ||
        !input.shiftsBriefedAt ||
        new Date(input.shiftsBriefedAt) > now ||
        !input.validHoursConfirmed ||
        !input.qrRehearsedAt ||
        new Date(input.qrRehearsedAt) > now ||
        input.supportEscalation.length < 10 ||
        !input.validUntil ||
        new Date(input.validUntil) <= now
      )
        throw new RequestError(
          "Complete every named manager, stock, shift, hours, QR rehearsal, fallback and support readiness field.",
        );
      const [contract] = await tx.query<{ fallback_id: string }>(
        `select f.id fallback_id from pilot_supply_terms t
         join pilot_supply_fallbacks f on f.supply_id=t.supply_id and f.state='approved'
         where t.supply_id=$1 and f.dependency_key<>t.dependency_key`,
        [input.supplyId],
      );
      if (!contract)
        throw new RequestError(
          "Approve an independent same-counter fallback first.",
        );
      const [qr] = await tx.query<{ id: string }>(
        `select rp.id from redemption_points rp
         join redemption_credentials rc on rc.point_id=rp.id
         where rp.organization_id=$1 and rp.location_id=$2 and rp.state='active'
          and rp.exposure='staff' and rc.state='active' and rc.credential_type='qr'
         limit 1`,
        [supply.organization_id, supply.location_id],
      );
      if (!qr)
        throw new RequestError(
          "Create and rehearse an active staff-presented QR for this counter.",
        );
    }
    await tx.query(
      `insert into destination_readiness(
        supply_id,organization_id,location_id,state,owner_approved_by,primary_manager,
        primary_contact,backup_contact,stock_confirmed_at,exact_item_confirmed,
        staff_instructions_confirmed,shifts_briefed_at,valid_hours_confirmed,
        qr_rehearsed_at,support_escalation,valid_until,updated_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       on conflict(supply_id) do update set
        state=excluded.state,owner_approved_by=excluded.owner_approved_by,
        primary_manager=excluded.primary_manager,primary_contact=excluded.primary_contact,
        backup_contact=excluded.backup_contact,stock_confirmed_at=excluded.stock_confirmed_at,
        exact_item_confirmed=excluded.exact_item_confirmed,
        staff_instructions_confirmed=excluded.staff_instructions_confirmed,
        shifts_briefed_at=excluded.shifts_briefed_at,
        valid_hours_confirmed=excluded.valid_hours_confirmed,
        qr_rehearsed_at=excluded.qr_rehearsed_at,support_escalation=excluded.support_escalation,
        valid_until=excluded.valid_until,updated_by=excluded.updated_by,updated_at=now()`,
      [
        input.supplyId,
        supply.organization_id,
        supply.location_id,
        input.state,
        input.ownerApprovedBy,
        input.primaryManager,
        input.primaryContact,
        input.backupContact,
        input.stockConfirmedAt,
        input.exactItemConfirmed,
        input.staffInstructionsConfirmed,
        input.shiftsBriefedAt,
        input.validHoursConfirmed,
        input.qrRehearsedAt,
        input.supportEscalation,
        input.validUntil,
        actor.id,
      ],
    );
    await audit(
      tx,
      actor.id,
      supply.organization_id,
      "pilot.readiness_saved",
      input.supplyId,
      {
        state: input.state,
        validUntil: input.validUntil,
        qrRehearsed: Boolean(input.qrRehearsedAt),
        exactItemConfirmed: input.exactItemConfirmed,
        shiftsBriefed: Boolean(input.shiftsBriefedAt),
      },
    );
    return input.supplyId;
  });
}

type ReleaseAssignment = { memberId: string; supplyId: string };
type ReleaseInput = {
  runId: string | null;
  marketId: string;
  weekKey: string;
  dataKind: "real" | "internal" | "demo" | "synthetic";
  requestKey: string;
  assignments: ReleaseAssignment[];
  recommendationFingerprint?: string;
  overrideReason?: string;
};

const releaseInput = z.object({
  runId: key.nullable().default(null),
  marketId: key,
  weekKey,
  dataKind,
  requestKey: z.string().trim().min(8).max(200),
  recommendationFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  overrideReason: z.string().trim().min(10).max(1500).optional(),
  assignments: z.array(z.object({ memberId: key, supplyId: key })).max(200),
});

function releaseFingerprint(input: ReleaseInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        runId: input.runId,
        marketId: input.marketId,
        weekKey: input.weekKey,
        dataKind: input.dataKind,
        recommendationFingerprint: input.recommendationFingerprint,
        overrideReason: input.overrideReason,
        assignments: [...input.assignments].sort(
          (a, b) =>
            a.memberId.localeCompare(b.memberId) ||
            a.supplyId.localeCompare(b.supplyId),
        ),
      }),
    )
    .digest("hex");
}

export type WeeklyRelease = {
  id: string;
  run_id: string | null;
  market_id: string;
  week_key: string;
  state: "published";
  data_kind: string;
  member_count: number;
  request_key: string;
  request_fingerprint: string;
  published_at: string;
};

export type FulfillmentGrant = {
  id: string;
  release_id: string;
  allocation_id: string;
  member_id: string;
  market_id: string;
  week_key: string;
  supply_id: string;
  organization_id: string;
  location_id: string;
  offer_id: string;
  offer_version: number;
  reserved_quantity: number;
  member_snapshot: Snapshot & Record<string, unknown>;
  expires_at: string;
  source_program_id: string | null;
  source_program_version: number | null;
  data_kind: string;
  state: "issued" | "claimed" | "redeemed";
  claimed_at: string | null;
  redeemed_at: string | null;
  created_at: string;
};

export async function weeklyReleaseView(db: DB, releaseId: string) {
  const [release] = await db.query<WeeklyRelease>(
    "select * from weekly_releases where id=$1",
    [releaseId],
  );
  if (!release) throw new RequestError("Weekly release not found.", 404);
  const grants = await db.query<FulfillmentGrant>(
    "select * from fulfillment_grants where release_id=$1 order by member_id",
    [releaseId],
  );
  return { release, grants };
}

type ReleaseSupply = {
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
  data_kind: string;
  title: string;
  qualification: string;
  reward: string;
  terms: string;
  merchant: string;
  address: string;
  timezone: string;
  is_demo: boolean;
  exact_item: string;
  item_sku: string;
  size_label: string;
  usable_hours: string;
  dependency_key: string;
  required_spend: string | number;
  member_fee: string | number;
  funder_organization_id: string;
  fulfiller_organization_id: string;
  readiness_state: string;
  owner_approved_by: string | null;
  primary_manager: string;
  primary_contact: string;
  backup_contact: string;
  stock_confirmed_at: string | null;
  exact_item_confirmed: boolean;
  staff_instructions_confirmed: boolean;
  shifts_briefed_at: string | null;
  valid_hours_confirmed: boolean;
  qr_rehearsed_at: string | null;
  support_escalation: string;
  valid_until: string | null;
  fallback_id: string;
  fallback_state: string;
  fallback_capacity: number;
  fallback_dependency: string;
  active_staff_qr: number;
  location_active: boolean;
};

async function primaryObligations(db: DB, supplyId: string, at: Date) {
  const [row] = await db.query<{
    primary_grants: number;
    legacy_used: number;
    recoveries: number;
  }>(
    `select
      (select count(*)::int from fulfillment_grants g where g.supply_id=$1
       and (g.state='redeemed' or g.expires_at>$2)) primary_grants,
      (select count(*)::int from member_claims mc join claims c on c.id=mc.claim_id
       where mc.supply_id=$1 and mc.grant_id is null
        and (c.state='redeemed' or (c.state='active'
         and (mc.reserved_until is null or mc.reserved_until>$2)
         and (c.snapshot->>'expires_at')::timestamptz>$2))) legacy_used,
      (select count(*)::int from recovery_grants r where r.replacement_supply_id=$1
       and (r.state='redeemed' or (r.superseded_at is null and r.expires_at>$2))) recoveries`,
    [supplyId, at.toISOString()],
  );
  return row;
}

export async function programForSupply(
  db: DB,
  supplyId: string,
  week: string,
  runId: string | null,
  newPlacements: number,
) {
  // Find every commercial link for this supply and week FIRST, without
  // filtering on the approved version. Filtering in the WHERE clause made a
  // link to a pending, superseded, terminated or wrong-version Program return
  // no row at all, so genuinely paid supply was silently released as organic.
  // An unlinked supply is organic; a linked supply must satisfy every
  // commercial condition or the release is rejected.
  const links = await db.query<{
    program_id: string;
    program_version: number;
    status: string;
    approved_version: number | null;
    benefit_ceiling: number | null;
    planned_placements: number | null;
    approved_for_run: boolean;
    week_key: string;
  }>(
    `select l.program_id,l.program_version,l.week_key,p.status,p.approved_version,
      v.benefit_ceiling,w.planned_placements,
      exists(select 1 from growth_program_approvals a where a.program_id=l.program_id
       and a.program_version=l.program_version and a.run_id=$2 and a.decision='approved') approved_for_run
     from program_supply_links l
     join growth_programs p on p.id=l.program_id
     left join growth_program_versions v on v.program_id=l.program_id and v.version=l.program_version
     left join growth_program_week_plans w on w.program_id=l.program_id
      and w.program_version=l.program_version and w.week_key=l.week_key
     where l.supply_id=$1
     order by l.program_id,l.program_version`,
    [supplyId, runId],
  );
  if (!links.length) return null;
  const programIds = new Set(links.map((link) => link.program_id));
  const effective = links.filter(
    (link) =>
      link.week_key === week && link.program_version === link.approved_version,
  );
  if (programIds.size > 1 || effective.length > 1)
    throw new RequestError(
      "This supply has conflicting Growth Program attribution. Resolve the commercial attribution before releasing.",
    );
  // Older links are append-only evidence, not competing commercial versions.
  // A commercial link in another week still makes this commercial supply;
  // absence of an effective link must never turn paid supply into organic.
  const [program] = effective;
  if (
    !runId ||
    !program ||
    !program.approved_for_run ||
    program.approved_version === null ||
    program.approved_version !== program.program_version ||
    !["approved", "active"].includes(program.status)
  )
    throw new RequestError(
      "Paid supply must come from the approved Program version for this pilot run.",
    );
  if (program.benefit_ceiling === null || program.planned_placements === null)
    throw new RequestError(
      "The linked Growth Program version has no approved ceiling or weekly plan for this week.",
    );
  const [{ total, week_total }] = await db.query<{
    total: number;
    week_total: number;
  }>(
    `select count(*)::int total,
      count(*) filter(where week_key=$2)::int week_total
     from fulfillment_grants where source_program_id=$1`,
    [program.program_id, week],
  );
  if (total + newPlacements > program.benefit_ceiling)
    throw new RequestError(
      "This release would exceed the approved Program benefit ceiling.",
    );
  if (week_total + newPlacements > program.planned_placements)
    throw new RequestError(
      "This release would exceed the Program's approved weekly placements.",
    );
  return {
    ...program,
    remaining_capacity: Math.max(
      0,
      Math.min(
        program.benefit_ceiling - total,
        program.planned_placements - week_total,
      ),
    ),
  };
}

export async function releaseWeeklyBenefits(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  requireOperator(actor);
  const input = releaseInput.parse(raw) as ReleaseInput;
  const memberIds = input.assignments.map((item) => item.memberId);
  const supplyIds = input.assignments.map((item) => item.supplyId);
  if (new Set(memberIds).size !== memberIds.length)
    throw new RequestError(
      "Each reviewed member must receive exactly one featured Uptick.",
    );
  const fingerprint = releaseFingerprint(input);
  return db.transaction(async (tx) => {
    // Shared lock order (see docs/PILOT_ARCHITECTURE.md, "Lock order"):
    // growth_program_coordination -> pilot_runs -> market_cells ->
    // growth_programs -> network_drop_supplies (id asc) -> uptick_members (id asc).
    // Program approval takes the coordination singleton before the pilot run, so
    // the weekly release must do the same or the two deadlock against each other.
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    let run:
      | {
          id: string;
          market_id: string;
          starts_on: string | Date;
          ends_on: string | Date;
          state: string;
          data_kind: string;
        }
      | undefined;
    if (input.runId) {
      [run] = await tx.query(
        "select * from pilot_runs where id=$1 for update",
        [input.runId],
      );
      if (!run) throw new RequestError("Choose an existing pilot run.", 404);
      if (
        run.market_id !== input.marketId ||
        run.data_kind !== input.dataKind ||
        run.state !== "live"
      )
        throw new RequestError(
          "The pilot run, Market Cell and real/test classification must match, and the fixed cohort must be live before publication.",
        );
      const starts = dateValue(run.starts_on);
      const weeks = [0, 7, 14, 21].map((days) =>
        new Date(Date.parse(`${starts}T12:00:00Z`) + days * 86400000)
          .toISOString()
          .slice(0, 10),
      );
      if (!weeks.includes(input.weekKey))
        throw new RequestError(
          "Choose one of this pilot run's four Monday week keys.",
        );
    } else if (input.dataKind === "real") {
      throw new RequestError(
        "Real weekly releases require a reviewed pilot run.",
      );
    }

    const [market] = await tx.query<{
      id: string;
      timezone: string;
      data_kind: string;
    }>(
      "select id,timezone,data_kind from market_cells where id=$1 for update",
      [input.marketId],
    );
    if (!market || market.data_kind !== input.dataKind)
      throw new RequestError(
        "Choose a Market Cell with the same real/test classification as the release.",
      );
    const marketWeek = marketWeekWindow(
      new Date(`${input.weekKey}T12:00:00Z`),
      market.timezone,
    );
    if (marketWeek.weekKey !== input.weekKey)
      throw new RequestError(
        "The weekly release key must be a Monday in the Market Cell.",
      );
    const now = new Date();
    if (marketWeekWindow(now, market.timezone).weekKey !== input.weekKey)
      throw new RequestError(
        "Publish only the current week after rechecking physical stock and the counter rehearsal.",
      );

    const [byRequest] = await tx.query<WeeklyRelease>(
      "select * from weekly_releases where request_key=$1",
      [input.requestKey],
    );
    if (byRequest) {
      if (byRequest.request_fingerprint !== fingerprint)
        throw new RequestError(
          "This release request key was already used for different terms.",
        );
      return weeklyReleaseView(tx, byRequest.id);
    }
    const [existing] = await tx.query<WeeklyRelease>(
      input.runId
        ? "select * from weekly_releases where run_id=$1 and week_key=$2"
        : "select * from weekly_releases where run_id is null and market_id=$1 and week_key=$2",
      [input.runId || input.marketId, input.weekKey],
    );
    if (existing) {
      if (existing.request_fingerprint !== fingerprint)
        throw new RequestError(
          "This pilot week already has a different published release.",
        );
      return weeklyReleaseView(tx, existing.id);
    }

    const sortedSupplyIds = [...new Set(supplyIds)].sort();
    const supplies = await tx.query<ReleaseSupply>(
      `select s.*,v.qualification,v.reward,v.terms,o.title,g.name merchant,g.is_demo,
        l.address,m.timezone,(ml.active and not exists(select 1 from location_outages outage where outage.location_id=s.location_id and outage.closed_at is null)) location_active,t.exact_item,t.item_sku,t.size_label,t.usable_hours,
        t.dependency_key,t.required_spend,t.member_fee,t.funder_organization_id,
        t.fulfiller_organization_id,d.state readiness_state,d.owner_approved_by,
        d.primary_manager,d.primary_contact,d.backup_contact,d.stock_confirmed_at,
        d.exact_item_confirmed,d.staff_instructions_confirmed,d.shifts_briefed_at,
        d.valid_hours_confirmed,d.qr_rehearsed_at,d.support_escalation,d.valid_until,
        f.id fallback_id,f.state fallback_state,f.usable_capacity fallback_capacity,
        f.dependency_key fallback_dependency,
        (select count(*)::int from redemption_points rp
          join redemption_credentials rc on rc.point_id=rp.id
          where rp.organization_id=s.organization_id and rp.location_id=s.location_id
           and rp.state='active' and rp.exposure='staff' and rc.state='active'
           and rc.credential_type='qr') active_staff_qr
       from network_drop_supplies s
       join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version
       join offers o on o.id=s.offer_id join organizations g on g.id=s.organization_id
       join locations l on l.id=s.location_id join market_cells m on m.id=s.market_id
       join market_locations ml on ml.market_id=s.market_id and ml.location_id=s.location_id
       join pilot_supply_terms t on t.supply_id=s.id
       join destination_readiness d on d.supply_id=s.id
       join pilot_supply_fallbacks f on f.supply_id=s.id
       where s.id=any($1::text[]) order by s.id for update of s`,
      [sortedSupplyIds],
    );
    if (supplies.length !== sortedSupplyIds.length)
      throw new RequestError(
        "Every release supply needs exact free terms, destination readiness and an independent fallback.",
      );

    const sortedMemberIds = [...memberIds].sort();
    const members = await tx.query<{
      id: string;
      customer_id: string;
      market_id: string | null;
      source_id: string | null;
      state: string;
      verified_at: string | null;
      age_confirmed_at: string | null;
      data_kind: string;
    }>(
      "select * from uptick_members where id=any($1::text[]) order by id for update",
      [sortedMemberIds],
    );
    if (members.length !== memberIds.length)
      throw new RequestError("The reviewed cohort includes an unknown member.");
    // A frozen pilot run already fixed who is owed a benefit. Admission -- not
    // the member's current, mutable profile geography -- identifies that
    // obligation, so one admitted member moving house (or having no currently
    // resolved market at all) cannot block the whole cohort's committed week.
    // Without a frozen run there is no admission record to rely on, so the
    // release still has to resolve the audience by current market.
    if (
      members.some(
        (member) =>
          member.data_kind !== input.dataKind ||
          member.state !== "active" ||
          !member.verified_at ||
          (input.dataKind === "real" && !member.age_confirmed_at),
      )
    )
      throw new RequestError(
        "Every released member must be active, verified, adult-confirmed and in the same cohort classification.",
      );
    if (!run && members.some((member) => member.market_id !== input.marketId))
      throw new RequestError(
        "Every released member must be active, verified, adult-confirmed and in the same cohort classification.",
      );
    const audience = run ? await operationalPilotAudience(tx, run.id) : null;
    if (audience) {
      const admissions = audience.included;
      if (
        admissions.length !== sortedMemberIds.length ||
        admissions.some(
          (admission, index) =>
            admission.member_id !== sortedMemberIds[index] ||
            admission.data_kind !== input.dataKind,
        )
      )
        throw new RequestError(
          "The release must exactly match the operational members of the fixed admitted cohort. Refresh the plan after an account-status change.",
        );
    }
    if (!members.length && (!audience || !audience.admitted))
      throw new RequestError("A weekly release needs an admitted cohort.");

    const supplyPrograms = new Map<
      string,
      Awaited<ReturnType<typeof programForSupply>>
    >();
    const pendingProgramPlacements = new Map<string, number>();
    for (const supply of supplies) {
      const assigned = input.assignments.filter(
        (item) => item.supplyId === supply.id,
      ).length;
      if (
        supply.market_id !== input.marketId ||
        supply.data_kind !== input.dataKind ||
        supply.state !== "approved" ||
        !supply.location_active ||
        supply.inventory_policy === "unlimited" ||
        !supply.quantity ||
        Number(supply.required_spend) !== 0 ||
        Number(supply.member_fee) !== 0 ||
        supply.fulfiller_organization_id !== supply.organization_id ||
        supply.readiness_state !== "ready" ||
        !supply.owner_approved_by ||
        !supply.primary_manager.trim() ||
        !supply.primary_contact.trim() ||
        !supply.backup_contact.trim() ||
        !supply.stock_confirmed_at ||
        new Date(supply.stock_confirmed_at) > now ||
        now.getTime() - new Date(supply.stock_confirmed_at).getTime() >
          72 * 60 * 60 * 1000 ||
        !supply.exact_item_confirmed ||
        !supply.staff_instructions_confirmed ||
        !supply.shifts_briefed_at ||
        new Date(supply.shifts_briefed_at) > now ||
        !supply.valid_hours_confirmed ||
        !supply.qr_rehearsed_at ||
        new Date(supply.qr_rehearsed_at) > now ||
        !supply.support_escalation.trim() ||
        !supply.valid_until ||
        new Date(supply.valid_until) < marketWeek.end ||
        supply.active_staff_qr < 1 ||
        supply.fallback_state !== "approved" ||
        supply.fallback_dependency === supply.dependency_key
      )
        throw new RequestError(
          `Supply ${supply.id} is not a current, finite, free and fully rehearsed pilot promise.`,
        );
      if (
        new Date(supply.starts_at) > marketWeek.start ||
        new Date(supply.expires_at) < marketWeek.end
      )
        throw new RequestError(
          `Supply ${supply.id} must cover the complete release week.`,
        );
      const [{ used }] = await tx.query<{ used: number }>(
        `select count(*)::int used from recovery_grants
         where fallback_id=$1 and (state='redeemed' or (superseded_at is null and expires_at>now()))`,
        [supply.fallback_id],
      );
      if (supply.fallback_capacity - used < assigned)
        throw new RequestError(
          `Fallback capacity cannot cover every grant for ${supply.exact_item}.`,
        );
      const obligations = await primaryObligations(tx, supply.id, new Date());
      let committed: number | null = null;
      if (run) {
        const [plan] = await tx.query<{ committed_quantity: number }>(
          `select committed_quantity from effective_pilot_week_supplies
           where run_id=$1 and week_key=$2 and supply_id=$3`,
          [run.id, input.weekKey, supply.id],
        );
        if (!plan)
          throw new RequestError(
            `Supply ${supply.id} is not committed to this pilot week.`,
          );
        committed = Number(plan.committed_quantity);
        if (obligations.primary_grants + assigned > committed)
          throw new RequestError(
            `The release exceeds committed stock for ${supply.exact_item}.`,
          );
      }
      const [{ adjustment }] = await tx.query<{ adjustment: number }>(
        "select coalesce(sum(delta),0)::int adjustment from supply_adjustments where supply_id=$1",
        [supply.id],
      );
      const total = Number(supply.quantity) + adjustment;
      const primary = Math.max(
        committed || 0,
        obligations.primary_grants + assigned,
      );
      if (total < primary + obligations.legacy_used + obligations.recoveries)
        throw new RequestError(
          `Confirmed inventory cannot cover every grant for ${supply.exact_item}.`,
        );
      let program = await programForSupply(
        tx,
        supply.id,
        input.weekKey,
        run?.id || null,
        assigned,
      );
      if (program) {
        const programKey = `${program.program_id}:${program.program_version}`;
        const cumulative =
          (pendingProgramPlacements.get(programKey) || 0) + assigned;
        pendingProgramPlacements.set(programKey, cumulative);
        if (cumulative !== assigned)
          program = await programForSupply(
            tx,
            supply.id,
            input.weekKey,
            run?.id || null,
            cumulative,
          );
      }
      supplyPrograms.set(supply.id, program);
    }

    const recommendation = run
      ? await recommendPilotAssignments(tx, run.id, input.weekKey)
      : null;
    if (recommendation) {
      if (
        input.recommendationFingerprint &&
        input.recommendationFingerprint !== recommendation.fingerprint
      )
        throw new RequestError(
          "The assignment facts changed. Generate and review the recommendation again.",
        );
      if (recommendation.unassigned.length)
        throw new RequestError(
          "Some members lack a suitable backed destination. Record travel relevance or repair capacity before releasing.",
        );
      for (const assignment of input.assignments) {
        const candidate = recommendation.members
          .find((m) => m.memberId === assignment.memberId)
          ?.candidates.find((c) => c.supplyId === assignment.supplyId);
        if (
          !candidate?.reason.suitable ||
          (input.dataKind === "real" && candidate.reason.unknownSuitability)
        )
          throw new RequestError(
            "This destination is unsuitable or unreviewed for this member. Payment and manual overrides cannot bypass suitability.",
          );
        if (
          recommendation.assignments.find(
            (a) => a.memberId === assignment.memberId,
          )?.supplyId !== assignment.supplyId &&
          !input.overrideReason
        )
          throw new RequestError(
            "Record a reason for changing the recommended assignment.",
          );
      }
    }
    for (const member of members) {
      const assignment = input.assignments.find(
        (item) => item.memberId === member.id,
      )!;
      const supply = supplies.find((item) => item.id === assignment.supplyId)!;
      const [conflict] = await tx.query<{ id: string }>(
        `select a.id from member_allocations a where a.member_id=$1 and a.week_key=$2
         union all select c.id from claims c where c.customer_id=$3 and c.offer_id=$4 limit 1`,
        [member.id, input.weekKey, member.customer_id, supply.offer_id],
      );
      if (conflict)
        throw new RequestError(
          "The reviewed cohort contains a member with an existing week or offer entitlement.",
        );
    }

    const releaseId = id();
    await tx.query(
      `insert into weekly_releases(
        id,run_id,market_id,week_key,state,data_kind,member_count,reviewed_by,
        request_key,request_fingerprint
       ) values($1,$2,$3,$4,'published',$5,$6,$7,$8,$9)`,
      [
        releaseId,
        run?.id || null,
        input.marketId,
        input.weekKey,
        input.dataKind,
        members.length,
        actor.id,
        input.requestKey,
        fingerprint,
      ],
    );
    for (const excluded of audience?.excluded || [])
      await tx.query(
        "insert into weekly_release_exclusions(release_id,member_id,service_event_id) values($1,$2,$3)",
        [releaseId, excluded.member_id, excluded.service_event_id],
      );
    for (const member of [...members].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const assignment = input.assignments.find(
        (item) => item.memberId === member.id,
      )!;
      const supply = supplies.find((item) => item.id === assignment.supplyId)!;
      const program = supplyPrograms.get(supply.id);
      const allocationId = id();
      const grantId = id();
      const expiresAt = new Date(
        Math.min(
          new Date(supply.expires_at).getTime(),
          marketWeek.end.getTime(),
        ),
      ).toISOString();
      const snapshot: Snapshot & Record<string, unknown> = {
        merchant: supply.merchant,
        qualification: "No purchase required",
        reward: `${supply.exact_item} — ${supply.size_label}`,
        terms: supply.terms,
        starts_at: marketWeek.start.toISOString(),
        expires_at: expiresAt,
        address: supply.address,
        timezone: supply.timezone,
        limit_mode: "claim",
        quantity: Number(supply.quantity),
        is_demo: supply.data_kind !== "real" || supply.is_demo,
        exact_item: supply.exact_item,
        item_sku: supply.item_sku,
        size_label: supply.size_label,
        usable_hours: supply.usable_hours,
        required_spend: 0,
        member_fee: 0,
        funder_organization_id: supply.funder_organization_id,
        fulfiller_organization_id: supply.fulfiller_organization_id,
        fallback: {
          available: true,
          same_counter: true,
          instructions:
            "Ask the cashier for the approved substitute or contact Uptick support.",
        },
        origin: {
          network: true,
          pilot: true,
          release_id: releaseId,
          grant_id: grantId,
          run_id: run?.id || null,
          market_id: input.marketId,
          supply_id: supply.id,
          allocation_id: allocationId,
          source_id: member.source_id,
          source_program_id: program?.program_id || null,
          source_program_version: program?.program_version || null,
          verification_mode: "staff_tap",
          inventory_policy: "grant",
        },
      };
      await tx.query(
        "insert into member_allocations(id,member_id,market_id,week_key,algorithm_version) values($1,$2,$3,$4,'pilot-release-v1')",
        [allocationId, member.id, input.marketId, input.weekKey],
      );
      await tx.query(
        "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values($1,$2,$3,1,$4)",
        [
          allocationId,
          supply.id,
          input.marketId,
          {
            rule: "pilot-release-v1",
            releaseId,
            grantId,
            inventoryReserved: true,
            oneFeaturedUptick: true,
            reviewedBy: actor.id,
            suitability:
              recommendation?.members
                .find((m) => m.memberId === member.id)
                ?.candidates.find((c) => c.supplyId === supply.id)?.reason ||
              null,
            recommendationFingerprint: recommendation?.fingerprint || null,
            overrideReason: input.overrideReason || null,
          },
        ],
      );
      await tx.query(
        `insert into fulfillment_grants(
          id,release_id,allocation_id,member_id,market_id,week_key,supply_id,
          organization_id,location_id,offer_id,offer_version,reserved_quantity,
          member_snapshot,expires_at,source_program_id,source_program_version,data_kind
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$14,$15,$16)`,
        [
          grantId,
          releaseId,
          allocationId,
          member.id,
          input.marketId,
          input.weekKey,
          supply.id,
          supply.organization_id,
          supply.location_id,
          supply.offer_id,
          supply.offer_version,
          snapshot,
          expiresAt,
          program?.program_id || null,
          program?.program_version || null,
          input.dataKind,
        ],
      );
      await demandEvent(tx, {
        kind: "fulfillment_grant_issued",
        memberId: member.id,
        marketId: input.marketId,
        organizationId: supply.organization_id,
        locationId: supply.location_id,
        sourceId: member.source_id,
        supplyId: supply.id,
        allocationId,
        detail: {
          releaseId,
          grantId,
          reservedQuantity: 1,
          sourceProgramId: program?.program_id || null,
          promotionalMessageSent: false,
        },
        dedupKey: `grant:${grantId}`,
      });
    }
    await audit(
      tx,
      actor.id,
      null,
      "pilot.weekly_release_published",
      releaseId,
      {
        runId: run?.id || null,
        marketId: input.marketId,
        weekKey: input.weekKey,
        memberCount: members.length,
        supplyIds: sortedSupplyIds,
        allOrNothing: true,
        messagesSent: false,
      },
    );
    return weeklyReleaseView(tx, releaseId);
  });
}

const incidentInput = z.object({
  grantId: key,
  incidentType: z.enum([
    "out_of_stock",
    "staff_refusal",
    "unexpected_closure",
    "incorrect_terms",
    "qr_failure",
    "redemption_failure",
    "messaging_issue",
    "member_complaint",
    "inventory_mismatch",
    "other",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  occurredAt: instant,
  owner: shortText,
  note: z.string().trim().max(2000).default(""),
  idempotencyKey: z.string().trim().min(8).max(200),
});

async function createIncident(
  db: DB,
  reporter:
    { kind: "operator"; actor: Actor } | { kind: "member"; memberId: string },
  raw: unknown,
) {
  const input = incidentInput.parse(raw);
  return db.transaction(async (tx) => {
    const [grant] = await tx.query<FulfillmentGrant>(
      "select * from fulfillment_grants where id=$1 for update",
      [input.grantId],
    );
    if (!grant)
      throw new RequestError("Choose an issued fulfillment grant.", 404);
    if (reporter.kind === "member" && reporter.memberId !== grant.member_id)
      throw new RequestError(
        "This fulfillment grant belongs to another member.",
        403,
      );
    const [existing] = await tx.query<{ id: string; grant_id: string }>(
      "select id,grant_id from fulfillment_incidents where idempotency_key=$1",
      [input.idempotencyKey],
    );
    if (existing) {
      if (existing.grant_id !== grant.id)
        throw new RequestError("This incident request key was already used.");
      return existing.id;
    }
    const [mapping] = await tx.query<{ claim_id: string; state: string }>(
      `select mc.claim_id,c.state from member_claims mc join claims c on c.id=mc.claim_id
       where mc.grant_id=$1 for update of c`,
      [grant.id],
    );
    const incidentId = id();
    await tx.query(
      `insert into fulfillment_incidents(
        id,grant_id,member_id,claim_id,supply_id,location_id,incident_type,severity,
        occurred_at,owner,report_note,idempotency_key,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        incidentId,
        grant.id,
        grant.member_id,
        mapping?.claim_id || null,
        grant.supply_id,
        grant.location_id,
        input.incidentType,
        input.severity,
        input.occurredAt,
        input.owner,
        input.note,
        input.idempotencyKey,
        reporter.kind === "operator" ? reporter.actor.id : "member",
      ],
    );
    await demandEvent(tx, {
      kind: "fulfillment_incident_opened",
      memberId: grant.member_id,
      marketId: grant.market_id,
      organizationId: grant.organization_id,
      locationId: grant.location_id,
      supplyId: grant.supply_id,
      allocationId: grant.allocation_id,
      claimId: mapping?.claim_id || null,
      detail: {
        incidentId,
        incidentType: input.incidentType,
        severity: input.severity,
        originalGrantState: grant.state,
      },
      dedupKey: `incident:${incidentId}`,
    });
    if (reporter.kind === "operator")
      await audit(
        tx,
        reporter.actor.id,
        grant.organization_id,
        "pilot.incident_opened",
        incidentId,
        {
          grantId: grant.id,
          type: input.incidentType,
          severity: input.severity,
        },
      );
    return incidentId;
  });
}

export async function reportFulfillmentIncident(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  requireOperator(actor);
  return createIncident(db, { kind: "operator", actor }, raw);
}

// Member routes must derive memberId from a server-side session before calling
// this function; no public request is allowed to choose another member ID.
export async function reportMemberFulfillmentIncident(
  db: DB,
  memberId: string,
  raw: unknown,
) {
  return createIncident(db, { kind: "member", memberId }, raw);
}

const recoveryInput = z.object({
  incidentId: key,
  remedyType: z.enum(["same_counter", "replacement_supply"]),
  fallbackId: key.nullable().default(null),
  replacementSupplyId: key.nullable().default(null),
  payerOrganizationId: key,
  payerEvidence: z.string().trim().min(3).max(1000),
  expiresAt: instant,
  supersedesRecoveryId: key.nullable().default(null),
  failureReason: z.string().trim().min(10).max(1500).optional(),
  physicalHandoff: z.enum(["not_received", "unknown"]).optional(),
});

export async function issueIncidentRecovery(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  requireOperator(actor);
  const input = recoveryInput.parse(raw);
  return db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    let [incident] = await tx.query<{
      id: string;
      grant_id: string;
      member_id: string;
      state: string;
    }>("select * from fulfillment_incidents where id=$1 for update", [
      input.incidentId,
    ]);
    if (!incident)
      throw new RequestError("Choose an existing fulfillment incident.", 404);
    const [existing] = await tx.query<{
      id: string;
      remedy_type: string;
      fallback_id: string | null;
      replacement_supply_id: string | null;
      payer_organization_id: string;
      payer_evidence: string;
      expires_at: string;
      original_grant_id: string;
    }>(
      input.supersedesRecoveryId
        ? "select * from recovery_grants where supersedes_recovery_id=$1"
        : "select * from recovery_grants where incident_id=$1 and supersedes_recovery_id is null",
      [input.supersedesRecoveryId || incident.id],
    );
    if (existing) {
      if (
        existing.original_grant_id !== incident.grant_id ||
        existing.remedy_type !== input.remedyType ||
        existing.fallback_id !== input.fallbackId ||
        existing.replacement_supply_id !== input.replacementSupplyId ||
        existing.payer_organization_id !== input.payerOrganizationId ||
        existing.payer_evidence !== input.payerEvidence ||
        new Date(existing.expires_at).toISOString() !== input.expiresAt
      )
        throw new RequestError(
          "This incident already has a different recovery remedy.",
        );
      if (input.supersedesRecoveryId) {
        const [failure] = await tx.query<{
          reason: string;
          physical_handoff: string;
        }>("select * from recovery_failures where successor_id=$1", [
          existing.id,
        ]);
        if (
          failure?.reason !== input.failureReason ||
          failure?.physical_handoff !== input.physicalHandoff
        )
          throw new RequestError(
            "This recovery attempt already has different failure evidence.",
          );
      }
      return existing.id;
    }
    if (
      !["open", "recovering"].includes(incident.state) &&
      !input.supersedesRecoveryId
    )
      throw new RequestError(
        "This incident is no longer accepting a recovery remedy.",
      );
    const [grant] = await tx.query<FulfillmentGrant>(
      "select * from fulfillment_grants where id=$1 for update",
      [incident.grant_id],
    );
    const [mapping] = await tx.query<{ claim_id: string; state: string }>(
      `select mc.claim_id,c.state from member_claims mc join claims c on c.id=mc.claim_id
       where mc.grant_id=$1 for update of c`,
      [grant.id],
    );
    const [existingForGrant] = await tx.query<{
      id: string;
      incident_id: string;
      state: string;
    }>(
      "select id,incident_id,state from recovery_grants where original_grant_id=$1 and superseded_at is null for update",
      [grant.id],
    );
    if (existingForGrant && !input.supersedesRecoveryId)
      throw new RequestError(
        "This original fulfillment grant already has a backed recovery remedy.",
      );
    if (input.supersedesRecoveryId) {
      if (
        !existingForGrant ||
        existingForGrant.id !== input.supersedesRecoveryId ||
        !input.failureReason ||
        !input.physicalHandoff
      )
        throw new RequestError(
          "Choose the current remedy and record its failure and physical-handoff evidence.",
        );
      // Release an unredeemed reservation inside this transaction. A redeemed
      // predecessor still consumes stock conservatively, even if handoff is unknown.
      await tx.query(
        "update recovery_grants set superseded_at=now() where id=$1",
        [existingForGrant.id],
      );
      if (!["open", "recovering"].includes(incident.state)) {
        const nextIncidentId = id();
        [incident] = await tx.query<typeof incident>(
          `insert into fulfillment_incidents(id,grant_id,member_id,claim_id,supply_id,location_id,incident_type,severity,occurred_at,owner,report_note,idempotency_key,created_by)
          values($1,$2,$3,$4,$5,$6,'other','high',now(),$7,$8,$9,$7) returning *`,
          [
            nextIncidentId,
            grant.id,
            grant.member_id,
            mapping?.claim_id || null,
            grant.supply_id,
            grant.location_id,
            actor.id,
            input.failureReason,
            `failed-recovery:${existingForGrant.id}`,
          ],
        );
      }
    }
    if (new Date(input.expiresAt) <= new Date())
      throw new RequestError("Choose a future recovery expiry.");
    const [payer] = await tx.query<{ id: string; is_demo: boolean }>(
      "select id,is_demo from organizations where id=$1",
      [input.payerOrganizationId],
    );
    if (!payer) throw new RequestError("Choose an existing recovery payer.");
    if (grant.data_kind === "real" && payer.is_demo)
      throw new RequestError(
        "Demo organizations cannot pay for a real pilot recovery.",
      );

    let fallbackId: string | null = null;
    let replacementSupplyId: string | null = null;
    let targetOrganizationId: string;
    let targetLocationId: string;
    let snapshot: Record<string, unknown>;
    if (input.remedyType === "same_counter") {
      if (!input.fallbackId || input.replacementSupplyId)
        throw new RequestError("Choose the approved same-counter fallback.");
      const [fallback] = await tx.query<
        PilotFallback & {
          organization_id: string;
          location_id: string;
          usable_hours: string;
          primary_dependency: string;
          readiness_state: string;
          owner_approved_by: string | null;
          primary_manager: string;
          primary_contact: string;
          backup_contact: string;
          stock_confirmed_at: string | null;
          exact_item_confirmed: boolean;
          staff_instructions_confirmed: boolean;
          shifts_briefed_at: string | null;
          valid_hours_confirmed: boolean;
          qr_rehearsed_at: string | null;
          support_escalation: string;
          valid_until: string | null;
          active_staff_qr: number;
          location_active: boolean;
          expires_at: string;
          merchant: string;
          address: string;
        }
      >(
        `select f.*,s.organization_id,s.location_id,s.expires_at,(ml.active and not exists(select 1 from location_outages outage where outage.location_id=s.location_id and outage.closed_at is null)) location_active,t.usable_hours,
          t.dependency_key primary_dependency,d.state readiness_state,
          d.owner_approved_by,d.primary_manager,d.primary_contact,d.backup_contact,
          d.stock_confirmed_at,d.exact_item_confirmed,d.staff_instructions_confirmed,
          d.shifts_briefed_at,d.valid_hours_confirmed,d.qr_rehearsed_at,
          d.support_escalation,d.valid_until,o.name merchant,l.address,
          (select count(*)::int from redemption_points rp
            join redemption_credentials rc on rc.point_id=rp.id
           where rp.organization_id=s.organization_id and rp.location_id=s.location_id
            and rp.state='active' and rp.exposure='staff' and rc.state='active'
            and rc.credential_type='qr') active_staff_qr
         from pilot_supply_fallbacks f join network_drop_supplies s on s.id=f.supply_id
         join market_locations ml on ml.market_id=s.market_id and ml.location_id=s.location_id
         join pilot_supply_terms t on t.supply_id=s.id
         join destination_readiness d on d.supply_id=s.id
         join organizations o on o.id=s.organization_id join locations l on l.id=s.location_id
         where f.id=$1 and f.supply_id=$2 for update of f`,
        [input.fallbackId, grant.supply_id],
      );
      if (
        !fallback ||
        !fallback.location_active ||
        // 'exhausted' is a derived capacity observation, not a withdrawal of
        // the operator's approval. Availability is recomputed from actually
        // consumed and still-live reservations below, so a fallback whose
        // reservation expired unused becomes usable again.
        !["approved", "exhausted"].includes(fallback.state) ||
        fallback.dependency_key === fallback.primary_dependency ||
        fallback.readiness_state !== "ready" ||
        !fallback.owner_approved_by ||
        !fallback.primary_manager.trim() ||
        !fallback.primary_contact.trim() ||
        !fallback.backup_contact.trim() ||
        !fallback.stock_confirmed_at ||
        new Date(fallback.stock_confirmed_at) > new Date() ||
        Date.now() - new Date(fallback.stock_confirmed_at).getTime() >
          72 * 60 * 60 * 1000 ||
        !fallback.exact_item_confirmed ||
        !fallback.staff_instructions_confirmed ||
        !fallback.shifts_briefed_at ||
        new Date(fallback.shifts_briefed_at) > new Date() ||
        !fallback.valid_hours_confirmed ||
        !fallback.qr_rehearsed_at ||
        new Date(fallback.qr_rehearsed_at) > new Date() ||
        !fallback.support_escalation.trim() ||
        fallback.active_staff_qr < 1 ||
        !fallback.valid_until ||
        new Date(fallback.valid_until) < new Date(input.expiresAt) ||
        input.payerOrganizationId !== fallback.payer_organization_id
      )
        throw new RequestError(
          "The same-counter fallback is not independently ready and funded.",
        );
      const [{ used }] = await tx.query<{ used: number }>(
        `select count(*)::int used from recovery_grants
         where fallback_id=$1 and (state='redeemed' or (superseded_at is null and expires_at>now()))`,
        [fallback.id],
      );
      if (used >= fallback.usable_capacity)
        throw new RequestError(
          "The same-counter fallback capacity is exhausted.",
        );
      if (new Date(input.expiresAt) > new Date(fallback.expires_at))
        throw new RequestError(
          "Recovery cannot outlast the same-counter supply window.",
        );
      fallbackId = fallback.id;
      targetOrganizationId = fallback.organization_id;
      targetLocationId = fallback.location_id;
      snapshot = {
        merchant: fallback.merchant,
        address: fallback.address,
        exact_item: fallback.substitute_item,
        item_sku: fallback.substitute_sku,
        size_label: fallback.size_label,
        usable_hours: fallback.usable_hours,
        required_spend: 0,
        member_fee: 0,
        instructions: fallback.instructions,
        remedy_type: "same_counter",
      };
      // Record the derived observation for operator visibility only. It must
      // never become a terminal state: an unconsumed reservation that later
      // expires releases capacity again, and the next recovery recomputes
      // 'used' from redeemed grants plus still-live reservations.
      const nextState =
        used + 1 >= fallback.usable_capacity ? "exhausted" : "approved";
      if (nextState !== fallback.state)
        await tx.query(
          "update pilot_supply_fallbacks set state=$2,updated_at=now() where id=$1",
          [fallback.id, nextState],
        );
    } else {
      if (!input.replacementSupplyId || input.fallbackId)
        throw new RequestError("Choose one backed replacement supply.");
      const ids = [grant.supply_id, input.replacementSupplyId].sort();
      await tx.query(
        "select id from network_drop_supplies where id=any($1::text[]) order by id for update",
        [ids],
      );
      const [replacement] = await tx.query<ReleaseSupply>(
        `select s.*,v.qualification,v.reward,v.terms,o.title,g.name merchant,g.is_demo,
          l.address,m.timezone,(ml.active and not exists(select 1 from location_outages outage where outage.location_id=s.location_id and outage.closed_at is null)) location_active,t.exact_item,t.item_sku,t.size_label,t.usable_hours,
          t.dependency_key,t.required_spend,t.member_fee,t.funder_organization_id,
          t.fulfiller_organization_id,d.state readiness_state,d.owner_approved_by,
          d.primary_manager,d.primary_contact,d.backup_contact,d.stock_confirmed_at,
          d.exact_item_confirmed,d.staff_instructions_confirmed,d.shifts_briefed_at,
          d.valid_hours_confirmed,d.qr_rehearsed_at,d.support_escalation,d.valid_until,
          f.id fallback_id,f.state fallback_state,f.usable_capacity fallback_capacity,
          f.dependency_key fallback_dependency,
          (select count(*)::int from redemption_points rp join redemption_credentials rc on rc.point_id=rp.id
           where rp.organization_id=s.organization_id and rp.location_id=s.location_id
            and rp.state='active' and rp.exposure='staff' and rc.state='active'
            and rc.credential_type='qr') active_staff_qr
         from network_drop_supplies s
         join offer_versions v on v.offer_id=s.offer_id and v.version=s.offer_version
         join offers o on o.id=s.offer_id join organizations g on g.id=s.organization_id
         join locations l on l.id=s.location_id join market_cells m on m.id=s.market_id
         join market_locations ml on ml.market_id=s.market_id and ml.location_id=s.location_id
         join pilot_supply_terms t on t.supply_id=s.id
         join destination_readiness d on d.supply_id=s.id
         join pilot_supply_fallbacks f on f.supply_id=s.id
         where s.id=$1`,
        [input.replacementSupplyId],
      );
      const [originalTerms] = await tx.query<{ dependency_key: string }>(
        "select dependency_key from pilot_supply_terms where supply_id=$1",
        [grant.supply_id],
      );
      if (
        !replacement ||
        !replacement.location_active ||
        replacement.id === grant.supply_id ||
        replacement.market_id !== grant.market_id ||
        replacement.data_kind !== grant.data_kind ||
        replacement.state !== "approved" ||
        replacement.inventory_policy === "unlimited" ||
        replacement.dependency_key === originalTerms?.dependency_key ||
        replacement.readiness_state !== "ready" ||
        !replacement.owner_approved_by ||
        !replacement.primary_manager.trim() ||
        !replacement.primary_contact.trim() ||
        !replacement.backup_contact.trim() ||
        !replacement.stock_confirmed_at ||
        new Date(replacement.stock_confirmed_at) > new Date() ||
        Date.now() - new Date(replacement.stock_confirmed_at).getTime() >
          72 * 60 * 60 * 1000 ||
        !replacement.exact_item_confirmed ||
        !replacement.staff_instructions_confirmed ||
        !replacement.shifts_briefed_at ||
        new Date(replacement.shifts_briefed_at) > new Date() ||
        !replacement.valid_hours_confirmed ||
        !replacement.qr_rehearsed_at ||
        new Date(replacement.qr_rehearsed_at) > new Date() ||
        !replacement.support_escalation.trim() ||
        !replacement.valid_until ||
        new Date(replacement.valid_until) < new Date(input.expiresAt) ||
        replacement.active_staff_qr < 1 ||
        Number(replacement.required_spend) !== 0 ||
        Number(replacement.member_fee) !== 0
      )
        throw new RequestError(
          "Choose independently backed, ready replacement supply.",
        );
      if (new Date(input.expiresAt) > new Date(replacement.expires_at))
        throw new RequestError(
          "Recovery cannot outlast the replacement supply window.",
        );
      const usage = await supplyUsage(tx, replacement.id);
      if (usage.remaining === null || usage.remaining < 1)
        throw new RequestError(
          "The replacement supply has no uncommitted capacity.",
        );
      replacementSupplyId = replacement.id;
      targetOrganizationId = replacement.organization_id;
      targetLocationId = replacement.location_id;
      snapshot = {
        merchant: replacement.merchant,
        address: replacement.address,
        exact_item: replacement.exact_item,
        item_sku: replacement.item_sku,
        size_label: replacement.size_label,
        usable_hours: replacement.usable_hours,
        required_spend: 0,
        member_fee: 0,
        instructions:
          "Show this recovery at the named counter and scan the staff-presented Uptick QR.",
        remedy_type: "replacement_supply",
      };
    }
    const recoveryId = id();
    await tx.query(
      `insert into recovery_grants(
        id,incident_id,original_grant_id,member_id,original_claim_id,remedy_type,
        fallback_id,replacement_supply_id,target_organization_id,target_location_id,
        payer_organization_id,payer_evidence,member_snapshot,expires_at,data_kind,issued_by,supersedes_recovery_id
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        recoveryId,
        incident.id,
        grant.id,
        grant.member_id,
        mapping?.claim_id || null,
        input.remedyType,
        fallbackId,
        replacementSupplyId,
        targetOrganizationId!,
        targetLocationId!,
        input.payerOrganizationId,
        input.payerEvidence,
        snapshot!,
        input.expiresAt,
        grant.data_kind,
        actor.id,
        input.supersedesRecoveryId,
      ],
    );
    if (input.supersedesRecoveryId)
      await tx.query(
        "insert into recovery_failures(recovery_id,successor_id,physical_handoff,reason,actor_id) values($1,$2,$3,$4,$5)",
        [
          input.supersedesRecoveryId,
          recoveryId,
          input.physicalHandoff,
          input.failureReason,
          actor.id,
        ],
      );
    await tx.query(
      "update fulfillment_incidents set state='recovering',resolution=$2 where id=$1",
      [incident.id, "Backed recovery issued; awaiting recorded use."],
    );
    await demandEvent(tx, {
      kind: "recovery_grant_issued",
      memberId: grant.member_id,
      marketId: grant.market_id,
      organizationId: targetOrganizationId!,
      locationId: targetLocationId!,
      supplyId: replacementSupplyId || grant.supply_id,
      allocationId: grant.allocation_id,
      claimId: mapping?.claim_id || null,
      detail: {
        recoveryId,
        incidentId: incident.id,
        remedyType: input.remedyType,
        originalGrantId: grant.id,
        countsAsWeeklyBenefit: false,
        countsAsPaidPlacement: false,
        payerOrganizationId: input.payerOrganizationId,
      },
      dedupKey: `recovery:${recoveryId}`,
    });
    await audit(
      tx,
      actor.id,
      targetOrganizationId!,
      "pilot.recovery_issued",
      recoveryId,
      {
        incidentId: incident.id,
        originalGrantId: grant.id,
        remedyType: input.remedyType,
        fallbackId,
        replacementSupplyId,
        payerOrganizationId: input.payerOrganizationId,
        countsAsPaidPlacement: false,
      },
    );
    return recoveryId;
  });
}

export async function pilotPromiseOperations(
  db: DB,
  actor: Actor,
  runId: string | null = null,
) {
  requireOperator(actor);
  const [supplies, releases, incidents, recoveries, grants] = await Promise.all(
    [
      db.query<Record<string, unknown>>(
        `select s.id,s.market_id,s.organization_id,s.location_id,s.state,s.data_kind,
        s.inventory_policy,s.quantity,s.starts_at,s.expires_at,o.title,g.name merchant,
        t.exact_item,t.item_sku,t.size_label,t.usable_hours,t.required_spend,t.member_fee,
        t.funder_organization_id,t.fulfiller_organization_id,
        d.state readiness_state,d.primary_manager,d.backup_contact,d.stock_confirmed_at,
        d.shifts_briefed_at,d.qr_rehearsed_at,d.valid_until,
        f.id fallback_id,f.substitute_item,f.usable_capacity,f.state fallback_state,
        f.payer_organization_id
       from network_drop_supplies s join offers o on o.id=s.offer_id
       join organizations g on g.id=s.organization_id
       left join pilot_supply_terms t on t.supply_id=s.id
       left join destination_readiness d on d.supply_id=s.id
       left join pilot_supply_fallbacks f on f.supply_id=s.id
       where ($1::text is null or exists(select 1 from effective_pilot_week_supplies p where p.run_id=$1 and p.supply_id=s.id))
       order by s.starts_at,s.id`,
        [runId],
      ),
      db.query<WeeklyRelease>(
        `select * from weekly_releases where ($1::text is null or run_id=$1)
       order by published_at desc limit 20`,
        [runId],
      ),
      db.query<Record<string, unknown>>(
        `select i.*,g.week_key,g.market_id,g.member_snapshot,g.state grant_state,
        r.id recovery_id,r.state recovery_state,r.remedy_type,r.expires_at recovery_expires_at
       from fulfillment_incidents i join fulfillment_grants g on g.id=i.grant_id
       left join recovery_grants r on r.incident_id=i.id and r.superseded_at is null
       where ($1::text is null or exists(select 1 from weekly_releases w where w.id=g.release_id and w.run_id=$1))
       order by i.occurred_at desc limit 100`,
        [runId],
      ),
      db.query<Record<string, unknown>>(
        `select r.*,i.incident_type,i.severity from recovery_grants r
       join fulfillment_incidents i on i.id=r.incident_id
       join fulfillment_grants g on g.id=r.original_grant_id
       where ($1::text is null or exists(select 1 from weekly_releases w where w.id=g.release_id and w.run_id=$1))
       order by r.issued_at desc limit 100`,
        [runId],
      ),
      db.query<{
        id: string;
        member_id: string;
        week_key: string;
        merchant: string;
        reward: string;
      }>(
        "select g.id,g.member_id,g.week_key,o.name merchant,g.member_snapshot->>'reward' reward from fulfillment_grants g join organizations o on o.id=g.organization_id join weekly_releases w on w.id=g.release_id where ($1::text is null or w.run_id=$1) order by g.week_key desc,g.member_id limit 1000",
        [runId],
      ),
    ],
  );
  return { supplies, releases, incidents, recoveries, grants };
}

export type PilotPromiseOperations = Awaited<
  ReturnType<typeof pilotPromiseOperations>
>;

export function allocationGrantView(
  db: DB,
  allocation: Pick<Allocation, "id">,
) {
  return Promise.all([
    db.query<FulfillmentGrant>(
      "select * from fulfillment_grants where allocation_id=$1",
      [allocation.id],
    ),
    db.query<Record<string, unknown>>(
      `select i.*,r.id recovery_id,r.remedy_type,r.member_snapshot recovery_snapshot,
        r.expires_at recovery_expires_at,r.state recovery_state
       from fulfillment_incidents i left join recovery_grants r on r.incident_id=i.id and r.superseded_at is null
       where i.grant_id=(select id from fulfillment_grants where allocation_id=$1)
       order by i.occurred_at desc`,
      [allocation.id],
    ),
  ]).then(([grants, incidents]) => ({
    grant: grants[0] || null,
    incidents,
    recovery: incidents.find((item) => item.recovery_id) || null,
  }));
}
