import { z } from "zod";
import type { DB } from "./db";
import { audit, authorize, type Actor } from "./domain";
import { RequestError } from "./http";
import { id } from "./security";
import {
  loadPilotRun,
  pilotCapacity,
  requiredCohort,
} from "./pilot-operations";
import { marketWeekWindow } from "./network";

export const programObjectives = [
  ["introduce_store", "Introduce the store"],
  ["introduce_breakfast", "Introduce breakfast"],
  ["introduce_product", "Introduce a product"],
  ["morning_discovery", "Increase relevant morning discovery"],
  ["quieter_period", "Support a defined quieter period"],
] as const;

const key = z.string().trim().min(1).max(100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const participant = z.string().trim().min(1).max(100);
const programVersionInput = z.object({
  buyerOrganizationId: participant,
  marketId: key,
  name: z.string().trim().min(3).max(120),
  objective: z.enum([
    "introduce_store",
    "introduce_breakfast",
    "introduce_product",
    "morning_discovery",
    "quieter_period",
  ]),
  objectiveNote: z.string().trim().max(1000),
  placementCategory: z.string().trim().min(2).max(80),
  startsOn: day,
  endsOn: day,
  funderOrganizationId: participant,
  fulfillerOrganizationId: participant,
  negotiatedFeeCents: z.number().int().min(0).max(100_000_000).nullable(),
  commercialStatus: z.enum([
    "negotiating",
    "agreed",
    "invoiced",
    "paid",
    "credited",
    "waived",
  ]),
  benefitCeiling: z.number().int().positive().max(1_000_000),
  operatingConstraints: z.string().trim().min(10).max(2000),
  evaluationPlan: z.string().trim().min(10).max(2000),
  locationIds: z.array(key).min(1).max(20),
  weekPlans: z
    .array(
      z.object({
        weekKey: day,
        plannedPlacements: z.number().int().positive().max(200),
      }),
    )
    .min(1)
    .max(12),
  protection: z
    .object({
      protectedLocationId: key,
      competingCategory: z.string().trim().min(2).max(80),
      radiusMiles: z.number().positive().max(1.5),
      startsOn: day,
      endsOn: day,
      placementScope: z.literal("paid_featured"),
      exceptions: z.array(z.string().trim().min(3).max(160)).max(30),
      terminationConditions: z.string().trim().min(10).max(1500),
    })
    .nullable(),
});
export type ProgramVersionInput = z.infer<typeof programVersionInput>;

type ProgramRecord = {
  id: string;
  buyer_organization_id: string;
  market_id: string;
  status: string;
  current_version: number;
  pending_version: number | null;
  approved_version: number | null;
};
type ProgramVersionRecord = {
  program_id: string;
  version: number;
  buyer_organization_id: string;
  funder_organization_id: string;
  fulfiller_organization_id: string;
  name: string;
  objective: string;
  objective_note: string;
  placement_category: string;
  starts_on: string;
  ends_on: string;
  negotiated_fee_cents: number | null;
  commercial_status: string;
  benefit_ceiling: number;
  operating_constraints: string;
  evaluation_plan: string;
};

function dateValue(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function dateNumber(value: unknown) {
  return Date.parse(`${dateValue(value)}T00:00:00Z`);
}
function serializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function assertParticipantAuthority(actor: Actor, ...organizations: string[]) {
  if (actor.role === "operator") return;
  for (const organization of organizations) authorize(actor, organization);
}
function validateVersionInput(raw: unknown) {
  const data = programVersionInput.parse(raw);
  if (dateNumber(data.endsOn) < dateNumber(data.startsOn))
    throw new RequestError(
      "Choose a Program end date on or after its start date.",
    );
  if (
    data.commercialStatus !== "negotiating" &&
    data.negotiatedFeeCents === null
  )
    throw new RequestError(
      "Record the negotiated Growth fee before agreeing commercial terms.",
    );
  if (new Set(data.locationIds).size !== data.locationIds.length)
    throw new RequestError("Choose each participating location once.");
  if (
    new Set(data.weekPlans.map((week) => week.weekKey)).size !==
    data.weekPlans.length
  )
    throw new RequestError("Plan each Program week once.");
  const planned = data.weekPlans.reduce(
    (total, week) => total + week.plannedPlacements,
    0,
  );
  if (planned > data.benefitCeiling)
    throw new RequestError(
      "Planned weekly placements exceed the Program benefit ceiling.",
    );
  for (const week of data.weekPlans)
    if (
      dateNumber(week.weekKey) < dateNumber(data.startsOn) ||
      dateNumber(week.weekKey) > dateNumber(data.endsOn)
    )
      throw new RequestError(
        "Every planned week must fall inside the Program dates.",
      );
  if (data.protection) {
    if (
      data.protection.competingCategory.toLowerCase() !==
      data.placementCategory.toLowerCase()
    )
      throw new RequestError(
        "Use the same category for the paid placement and its protection.",
      );
    if (!data.locationIds.includes(data.protection.protectedLocationId))
      throw new RequestError(
        "Protection must use a participating Program location.",
      );
    if (
      dateNumber(data.protection.startsOn) < dateNumber(data.startsOn) ||
      dateNumber(data.protection.endsOn) > dateNumber(data.endsOn) ||
      dateNumber(data.protection.endsOn) < dateNumber(data.protection.startsOn)
    )
      throw new RequestError(
        "Protection dates must stay inside the Program dates.",
      );
  }
  return data;
}

async function assertVersionReferences(
  db: DB,
  actor: Actor,
  data: ProgramVersionInput,
) {
  assertParticipantAuthority(
    actor,
    data.buyerOrganizationId,
    data.funderOrganizationId,
    data.fulfillerOrganizationId,
  );
  const organizations = await db.query<{ id: string }>(
    "select id from organizations where id=$1 or id=$2 or id=$3",
    [
      data.buyerOrganizationId,
      data.funderOrganizationId,
      data.fulfillerOrganizationId,
    ],
  );
  if (
    ![
      data.buyerOrganizationId,
      data.funderOrganizationId,
      data.fulfillerOrganizationId,
    ].every((organization) =>
      organizations.some((row) => row.id === organization),
    )
  )
    throw new RequestError(
      "Choose existing buyer, funder and fulfiller organizations.",
    );
  const [market] = await db.query<{ id: string }>(
    "select id from market_cells where id=$1",
    [data.marketId],
  );
  if (!market) throw new RequestError("Choose an existing Market Cell.");
  const locations = await db.query<{ id: string }>(
    "select l.id from locations l join market_locations ml on ml.location_id=l.id and ml.organization_id=l.organization_id where l.organization_id=$1 and ml.market_id=$2 and ml.active and l.id=any($3::text[])",
    [data.fulfillerOrganizationId, data.marketId, data.locationIds],
  );
  if (locations.length !== data.locationIds.length)
    throw new RequestError(
      "Choose active locations operated by the named fulfiller in this Market Cell.",
    );
}

async function insertVersion(
  db: DB,
  actor: Actor,
  programId: string,
  version: number,
  data: ProgramVersionInput,
) {
  await db.query(
    "insert into growth_program_versions(program_id,version,name,objective,objective_note,placement_category,starts_on,ends_on,buyer_organization_id,funder_organization_id,fulfiller_organization_id,negotiated_fee_cents,commercial_status,benefit_ceiling,operating_constraints,evaluation_plan,proposed_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
    [
      programId,
      version,
      data.name,
      data.objective,
      data.objectiveNote,
      data.placementCategory.toLowerCase(),
      data.startsOn,
      data.endsOn,
      data.buyerOrganizationId,
      data.funderOrganizationId,
      data.fulfillerOrganizationId,
      data.negotiatedFeeCents,
      data.commercialStatus,
      data.benefitCeiling,
      data.operatingConstraints,
      data.evaluationPlan,
      actor.id,
    ],
  );
  for (const locationId of data.locationIds)
    await db.query(
      "insert into growth_program_locations(program_id,program_version,location_id,fulfiller_organization_id) values($1,$2,$3,$4)",
      [programId, version, locationId, data.fulfillerOrganizationId],
    );
  for (const week of data.weekPlans)
    await db.query(
      "insert into growth_program_week_plans(program_id,program_version,week_key,planned_placements) values($1,$2,$3,$4)",
      [programId, version, week.weekKey, week.plannedPlacements],
    );
  if (data.protection)
    await db.query(
      "insert into growth_program_protections(program_id,program_version,protected_location_id,competing_category,radius_miles,starts_on,ends_on,placement_scope,exceptions,termination_conditions) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        programId,
        version,
        data.protection.protectedLocationId,
        data.placementCategory.toLowerCase(),
        data.protection.radiusMiles,
        data.protection.startsOn,
        data.protection.endsOn,
        data.protection.placementScope,
        JSON.stringify(data.protection.exceptions),
        data.protection.terminationConditions,
      ],
    );
}

export async function createGrowthProgram(db: DB, actor: Actor, raw: unknown) {
  const data = validateVersionInput(raw);
  await assertVersionReferences(db, actor, data);
  return db.transaction(async (tx) => {
    const programId = id();
    await tx.query(
      "insert into growth_programs(id,buyer_organization_id,market_id,status,current_version,pending_version,created_by) values($1,$2,$3,'review',1,1,$4)",
      [programId, data.buyerOrganizationId, data.marketId, actor.id],
    );
    await insertVersion(tx, actor, programId, 1, data);
    await audit(
      tx,
      actor.id,
      data.buyerOrganizationId,
      "growth.program_proposed",
      programId,
      {
        version: 1,
        negotiatedFeeCents: data.negotiatedFeeCents,
        plannedPlacements: data.weekPlans.reduce(
          (total, week) => total + week.plannedPlacements,
          0,
        ),
        capacityApproved: false,
      },
    );
    return programId;
  });
}

export async function proposeGrowthProgramAmendment(
  db: DB,
  actor: Actor,
  programId: string,
  raw: unknown,
) {
  const data = validateVersionInput(raw);
  await assertVersionReferences(db, actor, data);
  return db.transaction(async (tx) => {
    const [program] = await tx.query<ProgramRecord>(
      "select * from growth_programs where id=$1 for update",
      [programId],
    );
    if (!program) throw new RequestError("Growth Program not found.", 404);
    authorize(actor, program.buyer_organization_id);
    if (program.status === "terminated")
      throw new RequestError("A terminated Growth Program cannot be amended.");
    if (
      program.buyer_organization_id !== data.buyerOrganizationId ||
      program.market_id !== data.marketId
    )
      throw new RequestError(
        "The Program buyer and Market Cell cannot change in an amendment.",
      );
    const version = program.current_version + 1;
    await insertVersion(tx, actor, program.id, version, data);
    await tx.query(
      "update growth_programs set current_version=$2,pending_version=$2 where id=$1",
      [program.id, version],
    );
    await audit(
      tx,
      actor.id,
      program.buyer_organization_id,
      "growth.amendment_proposed",
      program.id,
      {
        priorApprovedVersion: program.approved_version,
        prospectiveVersion: version,
        issuedCommitmentsUnchanged: true,
      },
    );
    return version;
  });
}

const supplyProposalInput = z.object({
  programId: key.nullable(),
  programVersion: z.number().int().positive().nullable(),
  supplierOrganizationId: participant,
  funderOrganizationId: participant,
  fulfillerOrganizationId: participant,
  marketId: key,
  locationId: key,
  exactItem: z.string().trim().min(3).max(200),
  itemIdentifier: z.string().trim().max(100),
  usableHours: z.string().trim().min(3).max(500),
  startsOn: day,
  endsOn: day,
  quantity: z.number().int().positive().max(1_000_000),
  fallbackSubstitute: z.string().trim().min(3).max(200),
  fallbackInstructions: z.string().trim().min(10).max(1500),
  fallbackPayerOrganizationId: participant,
});

export async function submitMerchantSupplyProposal(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  const data = supplyProposalInput.parse(raw);
  if ((data.programId === null) !== (data.programVersion === null))
    throw new RequestError(
      "Choose both the Program and version, or submit organic supply.",
    );
  if (dateNumber(data.endsOn) < dateNumber(data.startsOn))
    throw new RequestError(
      "Choose a supply end date on or after its start date.",
    );
  assertParticipantAuthority(
    actor,
    data.supplierOrganizationId,
    data.funderOrganizationId,
    data.fulfillerOrganizationId,
    data.fallbackPayerOrganizationId,
  );
  return db.transaction(async (tx) => {
    const [location] = await tx.query<{ id: string }>(
      "select l.id from locations l join market_locations ml on ml.location_id=l.id and ml.organization_id=l.organization_id where l.id=$1 and l.organization_id=$2 and ml.market_id=$3 and ml.active",
      [data.locationId, data.fulfillerOrganizationId, data.marketId],
    );
    if (!location)
      throw new RequestError(
        "Choose an active location operated by the named fulfiller.",
      );
    if (data.programId && data.programVersion) {
      const [program] = await tx.query<
        ProgramVersionRecord & { market_id: string }
      >(
        "select v.*,p.market_id from growth_program_versions v join growth_programs p on p.id=v.program_id where v.program_id=$1 and v.version=$2",
        [data.programId, data.programVersion],
      );
      if (!program) throw new RequestError("Growth Program version not found.");
      if (
        program.market_id !== data.marketId ||
        program.funder_organization_id !== data.funderOrganizationId ||
        program.fulfiller_organization_id !== data.fulfillerOrganizationId
      )
        throw new RequestError(
          "Supply roles and market must match the Program version.",
        );
      if (
        actor.role !== "operator" &&
        ![
          program.buyer_organization_id,
          program.funder_organization_id,
          program.fulfiller_organization_id,
        ].includes(actor.organizationId)
      )
        throw new RequestError("You do not have access to this business.", 403);
    }
    const proposalId = id();
    await tx.query(
      "insert into merchant_supply_proposals(id,program_id,program_version,supplier_organization_id,funder_organization_id,fulfiller_organization_id,market_id,location_id,exact_item,item_identifier,usable_hours,starts_on,ends_on,quantity,required_spend_cents,member_fee_cents,fallback_substitute,fallback_instructions,fallback_payer_organization_id,state,proposed_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,0,$15,$16,$17,'review',$18)",
      [
        proposalId,
        data.programId,
        data.programVersion,
        data.supplierOrganizationId,
        data.funderOrganizationId,
        data.fulfillerOrganizationId,
        data.marketId,
        data.locationId,
        data.exactItem,
        data.itemIdentifier,
        data.usableHours,
        data.startsOn,
        data.endsOn,
        data.quantity,
        data.fallbackSubstitute,
        data.fallbackInstructions,
        data.fallbackPayerOrganizationId,
        actor.id,
      ],
    );
    await audit(
      tx,
      actor.id,
      data.supplierOrganizationId,
      "growth.supply_proposed",
      proposalId,
      {
        programId: data.programId,
        organic: data.programId === null,
        merchantEnteredQuantityIsNotApprovedCapacity: true,
        growthFeeCents: 0,
      },
    );
    return proposalId;
  });
}

export async function linkProgramSupply(db: DB, actor: Actor, raw: unknown) {
  if (actor.role !== "operator")
    throw new RequestError(
      "Only Uptick can link approved execution supply.",
      403,
    );
  const data = z
    .object({
      programId: key,
      programVersion: z.number().int().positive(),
      supplyId: key,
      weekKey: day,
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const [record] = await tx.query<{
      market_id: string;
      pending_version: number | null;
      funder_organization_id: string;
      fulfiller_organization_id: string;
      supply_market_id: string;
      supply_state: string;
      supply_funder: string;
      supply_fulfiller: string;
    }>(
      "select p.market_id,p.pending_version,v.funder_organization_id,v.fulfiller_organization_id,s.market_id supply_market_id,s.state supply_state,t.funder_organization_id supply_funder,t.fulfiller_organization_id supply_fulfiller from growth_programs p join growth_program_versions v on v.program_id=p.id and v.version=$2 join growth_program_week_plans w on w.program_id=v.program_id and w.program_version=v.version and w.week_key=$4 join network_drop_supplies s on s.id=$3 join pilot_supply_terms t on t.supply_id=s.id where p.id=$1",
      [data.programId, data.programVersion, data.supplyId, data.weekKey],
    );
    if (!record)
      throw new RequestError("Choose a planned week and reviewed supply.");
    if (record.pending_version !== data.programVersion)
      throw new RequestError(
        "Link supply to the current prospective Program version.",
      );
    if (
      record.market_id !== record.supply_market_id ||
      record.funder_organization_id !== record.supply_funder ||
      record.fulfiller_organization_id !== record.supply_fulfiller
    )
      throw new RequestError(
        "Supply market, funder and fulfiller must match the Program version.",
      );
    if (record.supply_state !== "approved")
      throw new RequestError(
        "Only approved supply can support a Growth Program.",
      );
    await tx.query(
      "insert into program_supply_links(program_id,program_version,supply_id,week_key,linked_by) values($1,$2,$3,$4,$5)",
      [
        data.programId,
        data.programVersion,
        data.supplyId,
        data.weekKey,
        actor.id,
      ],
    );
    return data.supplyId;
  });
}

type ProtectionRecord = {
  program_id: string;
  buyer_organization_id: string;
  protected_location_id: string;
  competing_category: string;
  radius_miles: number;
  starts_on: string;
  ends_on: string;
  placement_scope: string;
  exceptions: unknown;
  latitude: number | null;
  longitude: number | null;
};
function exceptions(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
function miles(
  a: Pick<ProtectionRecord, "latitude" | "longitude">,
  b: Pick<ProtectionRecord, "latitude" | "longitude">,
) {
  if (
    a.latitude === null ||
    a.longitude === null ||
    b.latitude === null ||
    b.longitude === null
  )
    return null;
  const radians = (n: number) => (n * Math.PI) / 180;
  const lat = radians(Number(b.latitude) - Number(a.latitude));
  const lon = radians(Number(b.longitude) - Number(a.longitude));
  const value =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(Number(a.latitude))) *
      Math.cos(radians(Number(b.latitude))) *
      Math.sin(lon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
type PlacementRecord = {
  program_id: string;
  buyer_organization_id: string;
  location_id: string;
  placement_category: string;
  starts_on: string;
  ends_on: string;
  latitude: number | null;
  longitude: number | null;
};

function protectionAllows(
  protection: ProtectionRecord,
  placement: Pick<
    PlacementRecord,
    "program_id" | "buyer_organization_id" | "location_id"
  >,
) {
  return exceptions(protection.exceptions).some((token) =>
    [
      `program:${placement.program_id}`,
      `organization:${placement.buyer_organization_id}`,
      `location:${placement.location_id}`,
    ].includes(token),
  );
}

export async function approveGrowthProgramVersion(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  if (actor.role !== "operator")
    throw new RequestError("Only Uptick can approve a Growth Program.", 403);
  const data = z
    .object({
      programId: key,
      programVersion: z.number().int().positive(),
      runId: key,
      note: z.string().trim().min(10).max(1000),
      attentionExceptionReason: z.string().trim().min(10).max(1000).nullable(),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const run = await loadPilotRun(tx, data.runId, true);
    const [version] = await tx.query<
      ProgramVersionRecord &
        ProgramRecord & {
          run_market_id: string;
          run_starts_on: string;
          run_ends_on: string;
          run_state: string;
          run_data_kind: string;
          hard_cap: number;
          paid_load_guidance: number;
        }
    >(
      "select v.*,p.market_id,p.status,p.current_version,p.pending_version,p.approved_version,r.market_id run_market_id,r.starts_on run_starts_on,r.ends_on run_ends_on,r.state run_state,r.data_kind run_data_kind,r.hard_cap,r.paid_load_guidance from growth_programs p join growth_program_versions v on v.program_id=p.id and v.version=$2 join pilot_runs r on r.id=$3 where p.id=$1 for update of p",
      [data.programId, data.programVersion, data.runId],
    );
    if (!version)
      throw new RequestError(
        "Choose an existing Program version and pilot run.",
      );
    if (version.status === "terminated")
      throw new RequestError("A terminated Growth Program cannot be approved.");
    if (
      version.pending_version !== data.programVersion ||
      version.current_version !== data.programVersion
    )
      throw new RequestError(
        "Approve only the current prospective Program version.",
      );
    if (version.market_id !== version.run_market_id)
      throw new RequestError(
        "The Program and pilot run must use the same Market Cell.",
      );
    if (!["draft", "enrolling", "live"].includes(version.run_state))
      throw new RequestError(
        "Choose a pilot run that can still execute placements.",
      );
    if (
      dateNumber(version.starts_on) < dateNumber(version.run_starts_on) ||
      dateNumber(version.ends_on) > dateNumber(version.run_ends_on)
    )
      throw new RequestError(
        "Program dates must stay inside the selected pilot run.",
      );
    if (
      version.commercial_status === "negotiating" ||
      version.negotiated_fee_cents === null
    )
      throw new RequestError(
        "Agree and record the negotiated fee before approval.",
      );
    const [{ credited }] = await tx.query<{ credited: number }>(
      "select coalesce(sum(amount_cents),0)::int credited from growth_program_credits where program_id=$1",
      [data.programId],
    );
    if (Number(version.negotiated_fee_cents) < Number(credited))
      throw new RequestError(
        "The amended negotiated fee cannot be lower than credits already recorded for this Program.",
      );
    if (
      version.approved_version &&
      version.approved_version !== data.programVersion
    ) {
      const [issued] = await tx.query<{
        last_week: string | null;
        count: number;
      }>(
        "select max(week_key) last_week,count(*)::int count from fulfillment_grants where source_program_id=$1",
        [data.programId],
      );
      if (issued.last_week && dateValue(version.starts_on) <= issued.last_week)
        throw new RequestError(
          "This Program already has issued member obligations. The amended version must start after the last issued week; historical versions and grants stay unchanged.",
        );
      if (issued.count) {
        const [{ planned }] = await tx.query<{ planned: number }>(
          "select coalesce(sum(planned_placements),0)::int planned from growth_program_week_plans where program_id=$1 and program_version=$2",
          [data.programId, data.programVersion],
        );
        if (issued.count + planned > Number(version.benefit_ceiling))
          throw new RequestError(
            "The amended lifetime benefit ceiling must cover issued history plus prospective placements.",
          );
      }
    }

    const weekPlans = await tx.query<{
      week_key: string;
      planned_placements: number;
    }>(
      "select week_key,planned_placements from growth_program_week_plans where program_id=$1 and program_version=$2 order by week_key",
      [data.programId, data.programVersion],
    );
    await tx.query(
      "select s.id from network_drop_supplies s where exists(select 1 from program_supply_links l where l.supply_id=s.id and l.program_id=$1 and l.program_version=$2) order by s.id for update",
      [data.programId, data.programVersion],
    );
    const supplyRows = await tx.query<{
      week_key: string;
      supply_id: string;
      state: string;
      inventory_policy: string;
      quantity: number | null;
      inventory_adjustment: number;
      committed_quantity: number | null;
      exact_item: string;
      required_spend: number;
      member_fee: number;
      funder_organization_id: string;
      fulfiller_organization_id: string;
      data_kind: string;
      readiness_state: string | null;
      owner_approved_by: string | null;
      primary_manager: string | null;
      primary_contact: string | null;
      backup_contact: string | null;
      stock_confirmed_at: string | null;
      exact_item_confirmed: boolean | null;
      staff_instructions_confirmed: boolean | null;
      shifts_briefed_at: string | null;
      valid_hours_confirmed: boolean | null;
      qr_rehearsed_at: string | null;
      support_escalation: string | null;
      valid_until: string | null;
      active_staff_qr: number;
      fallback_state: string | null;
      fallback_capacity: number | null;
      supply_dependency: string;
      fallback_dependency: string | null;
    }>(
      "select l.week_key,s.id supply_id,s.state,s.inventory_policy,s.quantity,(select coalesce(sum(a.delta),0)::int from supply_adjustments a where a.supply_id=s.id) inventory_adjustment,pws.committed_quantity,t.exact_item,t.required_spend,t.member_fee,t.funder_organization_id,t.fulfiller_organization_id,t.data_kind,d.state readiness_state,d.owner_approved_by,d.primary_manager,d.primary_contact,d.backup_contact,d.stock_confirmed_at,d.exact_item_confirmed,d.staff_instructions_confirmed,d.shifts_briefed_at,d.valid_hours_confirmed,d.qr_rehearsed_at,d.support_escalation,d.valid_until,(select count(*)::int from redemption_points rp join redemption_credentials rc on rc.point_id=rp.id where rp.organization_id=s.organization_id and rp.location_id=s.location_id and rp.state='active' and rp.exposure='staff' and rc.state='active' and rc.credential_type='qr') active_staff_qr,f.state fallback_state,f.usable_capacity fallback_capacity,t.dependency_key supply_dependency,f.dependency_key fallback_dependency from program_supply_links l join network_drop_supplies s on s.id=l.supply_id join pilot_supply_terms t on t.supply_id=s.id left join effective_pilot_week_supplies pws on pws.run_id=$3 and pws.week_key=l.week_key and pws.supply_id=l.supply_id left join destination_readiness d on d.supply_id=s.id left join pilot_supply_fallbacks f on f.supply_id=s.id where l.program_id=$1 and l.program_version=$2",
      [data.programId, data.programVersion, data.runId],
    );
    const capacity: Record<
      string,
      { planned: number; confirmed: number; fallback: number }
    > = {};
    const reviewedAt = new Date();
    for (const week of weekPlans) {
      const weekKey = dateValue(week.week_key);
      if (
        dateNumber(weekKey) < dateNumber(version.run_starts_on) ||
        dateNumber(weekKey) >= dateNumber(version.run_ends_on)
      )
        throw new RequestError(
          "Every planned week must fall inside the selected pilot run.",
        );
      const supplies = supplyRows.filter(
        (row) => dateValue(row.week_key) === weekKey,
      );
      if (!supplies.length)
        throw new RequestError(
          `Link approved execution supply for ${weekKey} before approval.`,
        );
      for (const supply of supplies) {
        const stockConfirmedAt = supply.stock_confirmed_at
          ? new Date(supply.stock_confirmed_at)
          : null;
        const weekEnd = marketWeekWindow(
          new Date(`${weekKey}T12:00:00Z`),
          run.timezone!,
        ).end;
        const ready =
          supply.readiness_state === "ready" &&
          Boolean(supply.owner_approved_by?.trim()) &&
          Boolean(supply.primary_manager?.trim()) &&
          Boolean(supply.primary_contact?.trim()) &&
          Boolean(supply.backup_contact?.trim()) &&
          Boolean(stockConfirmedAt) &&
          stockConfirmedAt!.getTime() <= reviewedAt.getTime() &&
          reviewedAt.getTime() - stockConfirmedAt!.getTime() <=
            72 * 60 * 60 * 1000 &&
          supply.exact_item_confirmed === true &&
          supply.staff_instructions_confirmed === true &&
          Boolean(supply.shifts_briefed_at) &&
          supply.valid_hours_confirmed === true &&
          Boolean(supply.qr_rehearsed_at) &&
          Boolean(supply.support_escalation?.trim()) &&
          Boolean(supply.valid_until) &&
          new Date(supply.valid_until!).getTime() >= weekEnd.getTime() &&
          supply.active_staff_qr > 0;
        if (!ready)
          throw new RequestError(
            `Destination readiness is incomplete for ${supply.exact_item}.`,
          );
        if (
          supply.state !== "approved" ||
          supply.inventory_policy === "unlimited" ||
          supply.quantity === null ||
          supply.committed_quantity === null ||
          Number(supply.quantity) + Number(supply.inventory_adjustment) <
            Number(supply.committed_quantity)
        )
          throw new RequestError(
            `Confirmed finite inventory is missing for ${supply.exact_item}.`,
          );
        if (
          Number(supply.required_spend) !== 0 ||
          Number(supply.member_fee) !== 0 ||
          supply.funder_organization_id !== version.funder_organization_id ||
          supply.fulfiller_organization_id !==
            version.fulfiller_organization_id ||
          supply.data_kind !== version.run_data_kind
        )
          throw new RequestError(
            `Supply terms or participant roles do not match for ${supply.exact_item}.`,
          );
        if (
          supply.fallback_state !== "approved" ||
          !supply.fallback_capacity ||
          supply.fallback_dependency === supply.supply_dependency
        )
          throw new RequestError(
            `An independent approved fallback is missing for ${supply.exact_item}.`,
          );
      }
      const confirmed = supplies.reduce(
        (sum, supply) => sum + Number(supply.committed_quantity || 0),
        0,
      );
      const fallback = supplies.reduce(
        (sum, supply) => sum + Number(supply.fallback_capacity || 0),
        0,
      );
      if (
        confirmed < Number(week.planned_placements) ||
        fallback < Number(week.planned_placements)
      )
        throw new RequestError(
          `Planned placements for ${weekKey} exceed backed primary or fallback capacity.`,
        );
      capacity[weekKey] = {
        planned: Number(week.planned_placements),
        confirmed,
        fallback,
      };
    }

    const bookedRows = await tx.query<{ week_key: string; booked: number }>(
      "select w.week_key,coalesce(sum(w.planned_placements),0)::int booked from growth_programs p join growth_program_week_plans w on w.program_id=p.id and w.program_version=p.approved_version join growth_program_approvals a on a.program_id=p.id and a.program_version=p.approved_version and a.run_id=$1 and a.decision='approved' where p.id<>$2 and p.status in ('approved','active') group by w.week_key",
      [data.runId, data.programId],
    );
    const booked = new Map(
      bookedRows.map((row) => [dateValue(row.week_key), Number(row.booked)]),
    );
    const backed = await pilotCapacity(tx, run, { reviewingCommercial: true });
    /* The shared rule for who a run owes a benefit to, rather than a third
       inline definition of it. The question here is different from the
       readiness gate's — it asks how many members a paid placement can reach,
       not whether every week is backed — so the capacity bound stays where it
       was: a cohort that is already admitted is the audience, while a run still
       enrolling can only promise what its weeks can back. What changes is that
       a withdrawn member no longer counts towards a placement's reach. */
    const owed = await requiredCohort(tx, run);
    const effectiveAudience = run.cohort_frozen_at
      ? owed
      : Math.min(owed, Number(backed.capacity));
    if (effectiveAudience < 1)
      throw new RequestError(
        "The selected pilot has no backed audience available for paid placements.",
      );
    const guidance = Math.floor(
      effectiveAudience * Number(version.paid_load_guidance),
    );
    let guidanceExceeded = false;
    for (const week of weekPlans) {
      const total =
        (booked.get(dateValue(week.week_key)) || 0) +
        Number(week.planned_placements);
      if (total > effectiveAudience)
        throw new RequestError(
          `Paid placements for ${dateValue(week.week_key)} exceed the backed pilot audience of ${effectiveAudience}.`,
        );
      if (total > guidance) guidanceExceeded = true;
    }
    if (guidanceExceeded && !data.attentionExceptionReason)
      throw new RequestError(
        "Paid featured load exceeds pilot guidance. Record the operator review reason to continue.",
      );

    const [candidate] = await tx.query<ProtectionRecord>(
      "select x.*,p.buyer_organization_id,l.latitude,l.longitude from growth_program_protections x join growth_programs p on p.id=x.program_id join locations l on l.id=x.protected_location_id where x.program_id=$1 and x.program_version=$2",
      [data.programId, data.programVersion],
    );
    const candidatePlacements = await tx.query<PlacementRecord>(
      "select x.program_id,p.buyer_organization_id,x.location_id,v.placement_category,v.starts_on,v.ends_on,l.latitude,l.longitude from growth_program_locations x join growth_programs p on p.id=x.program_id join growth_program_versions v on v.program_id=x.program_id and v.version=x.program_version join locations l on l.id=x.location_id where x.program_id=$1 and x.program_version=$2",
      [data.programId, data.programVersion],
    );
    const activeProtections = await tx.query<ProtectionRecord>(
      "select x.*,p.buyer_organization_id,l.latitude,l.longitude from growth_programs p join growth_program_protections x on x.program_id=p.id and x.program_version=p.approved_version join locations l on l.id=x.protected_location_id where p.id<>$1 and p.status in ('approved','active')",
      [data.programId],
    );
    for (const existing of activeProtections)
      for (const placement of candidatePlacements) {
        const overlappingDates =
          dateNumber(placement.starts_on) <= dateNumber(existing.ends_on) &&
          dateNumber(existing.starts_on) <= dateNumber(placement.ends_on);
        if (
          overlappingDates &&
          placement.placement_category.toLowerCase() ===
            existing.competing_category.toLowerCase() &&
          !protectionAllows(existing, placement)
        ) {
          const distance = miles(existing, placement);
          if (distance === null)
            throw new RequestError(
              "Paid placement locations need coordinates before protection review.",
            );
          if (distance <= Number(existing.radius_miles))
            throw new RequestError(
              "This paid featured placement conflicts with active commercial protection.",
            );
        }
      }
    if (candidate) {
      if (candidate.latitude === null || candidate.longitude === null)
        throw new RequestError(
          "Add coordinates to the protected location before approval.",
        );
      const activePlacements = await tx.query<PlacementRecord>(
        "select x.program_id,p.buyer_organization_id,x.location_id,v.placement_category,v.starts_on,v.ends_on,l.latitude,l.longitude from growth_programs p join growth_program_versions v on v.program_id=p.id and v.version=p.approved_version join growth_program_locations x on x.program_id=v.program_id and x.program_version=v.version join locations l on l.id=x.location_id where p.id<>$1 and p.status in ('approved','active')",
        [data.programId],
      );
      for (const placement of activePlacements) {
        const overlappingDates =
          dateNumber(candidate.starts_on) <= dateNumber(placement.ends_on) &&
          dateNumber(placement.starts_on) <= dateNumber(candidate.ends_on);
        if (
          overlappingDates &&
          candidate.competing_category.toLowerCase() ===
            placement.placement_category.toLowerCase() &&
          !protectionAllows(candidate, placement)
        ) {
          const distance = miles(candidate, placement);
          if (distance === null)
            throw new RequestError(
              "Paid placement locations need coordinates before protection review.",
            );
          if (distance <= Number(candidate.radius_miles))
            throw new RequestError(
              "This paid featured placement conflicts with active commercial protection.",
            );
        }
      }
    }

    const approvalId = id();
    await tx.query(
      "insert into growth_program_approvals(id,program_id,program_version,run_id,decision,capacity_snapshot,note,decided_by) values($1,$2,$3,$4,'approved',$5,$6,$7)",
      [
        approvalId,
        data.programId,
        data.programVersion,
        data.runId,
        JSON.stringify({
          weeks: capacity,
          hardCap: Number(version.hard_cap),
          backedAudience: Number(backed.capacity),
          effectiveAudience,
          paidLoadGuidance: Number(version.paid_load_guidance),
          guidanceExceeded,
          attentionExceptionReason: data.attentionExceptionReason,
          source: "stored_pilot_commitments",
        }),
        data.note,
        actor.id,
      ],
    );
    await tx.query(
      "update growth_programs set approved_version=$2,pending_version=null,status='approved' where id=$1",
      [data.programId, data.programVersion],
    );
    await audit(
      tx,
      actor.id,
      version.buyer_organization_id,
      "growth.program_approved",
      data.programId,
      {
        version: data.programVersion,
        runId: data.runId,
        negotiatedFeeCents: version.negotiated_fee_cents,
        feeRecordedAtProgramOnly: true,
        guidanceExceeded,
      },
    );
    return approvalId;
  });
}

export async function recordProgramCredit(db: DB, actor: Actor, raw: unknown) {
  if (actor.role !== "operator")
    throw new RequestError("Only Uptick can approve a Program credit.", 403);
  const data = z
    .object({
      programId: key,
      amountCents: z.number().int().positive().max(100_000_000),
      reason: z.string().trim().min(10).max(1000),
      reference: z.string().trim().min(1).max(300),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const [program] = await tx.query<
      ProgramRecord & { negotiated_fee_cents: number | null }
    >(
      "select p.*,v.negotiated_fee_cents from growth_programs p join growth_program_versions v on v.program_id=p.id and v.version=p.approved_version where p.id=$1 for update of p",
      [data.programId],
    );
    if (!program || program.negotiated_fee_cents === null)
      throw new RequestError(
        "Approve the negotiated Program before recording a credit.",
      );
    const [existing] = await tx.query<{
      id: string;
      amount_cents: number;
      reason: string;
    }>(
      "select id,amount_cents,reason from growth_program_credits where program_id=$1 and reference=$2",
      [data.programId, data.reference],
    );
    if (existing) {
      if (
        Number(existing.amount_cents) === data.amountCents &&
        existing.reason === data.reason
      )
        return existing.id;
      throw new RequestError(
        "This Program credit reference already identifies a different credit.",
      );
    }
    const [total] = await tx.query<{ credited: number }>(
      "select coalesce(sum(amount_cents),0)::int credited from growth_program_credits where program_id=$1",
      [data.programId],
    );
    if (
      Number(total.credited) + data.amountCents >
      Number(program.negotiated_fee_cents)
    )
      throw new RequestError(
        "Program credits cannot exceed the approved negotiated fee.",
      );
    const creditId = id();
    const [inserted] = await tx.query<{ id: string }>(
      "insert into growth_program_credits(id,program_id,amount_cents,reason,reference,approved_by) values($1,$2,$3,$4,$5,$6) on conflict do nothing returning id",
      [
        creditId,
        data.programId,
        data.amountCents,
        data.reason,
        data.reference,
        actor.id,
      ],
    );
    if (!inserted) {
      const [concurrent] = await tx.query<{
        id: string;
        amount_cents: number;
        reason: string;
      }>(
        "select id,amount_cents,reason from growth_program_credits where program_id=$1 and reference=$2",
        [data.programId, data.reference],
      );
      if (
        concurrent &&
        Number(concurrent.amount_cents) === data.amountCents &&
        concurrent.reason === data.reason
      )
        return concurrent.id;
      throw new RequestError(
        "This Program credit reference already identifies a different credit.",
      );
    }
    await audit(
      tx,
      actor.id,
      program.buyer_organization_id,
      "growth.credit_recorded",
      data.programId,
      {
        creditId,
        amountCents: data.amountCents,
        approvedVersion: program.approved_version,
      },
    );
    return creditId;
  });
}

export async function terminateGrowthProgram(
  db: DB,
  actor: Actor,
  raw: unknown,
) {
  if (actor.role !== "operator")
    throw new RequestError("Only Uptick can terminate a Growth Program.", 403);
  const data = z
    .object({ programId: key, reason: z.string().trim().min(10).max(1000) })
    .parse(raw);
  return db.transaction(async (tx) => {
    const [program] = await tx.query<ProgramRecord>(
      "select * from growth_programs where id=$1 for update",
      [data.programId],
    );
    if (!program) throw new RequestError("Growth Program not found.", 404);
    if (program.status === "terminated") return program.id;
    await tx.query(
      "insert into growth_program_terminations(id,program_id,reason,terminated_by) values($1,$2,$3,$4)",
      [id(), program.id, data.reason, actor.id],
    );
    await tx.query(
      "update growth_programs set status='terminated',pending_version=null where id=$1",
      [program.id],
    );
    await audit(
      tx,
      actor.id,
      program.buyer_organization_id,
      "growth.program_terminated",
      program.id,
      {
        reason: data.reason,
        issuedCommitmentsRemainValid: true,
        organicSupplyAndRecoveryUnaffected: true,
      },
    );
    return program.id;
  });
}

export type GrowthProgramWorkspace = Awaited<
  ReturnType<typeof growthProgramWorkspace>
>;
export async function growthProgramWorkspace(db: DB, actor: Actor) {
  const organizationId = actor.organizationId;
  authorize(actor, organizationId);
  const [organizations, locations, markets, programs, proposals, executions] =
    await Promise.all([
      db.query<{ id: string; name: string; timezone: string }>(
        "select id,name,timezone from organizations where id=$1",
        [organizationId],
      ),
      db.query<{
        id: string;
        name: string;
        address: string;
        market_id: string;
      }>(
        "select l.id,l.name,l.address,ml.market_id from locations l join market_locations ml on ml.location_id=l.id and ml.organization_id=l.organization_id where l.organization_id=$1 and ml.active order by l.name",
        [organizationId],
      ),
      db.query<{ id: string; name: string; state: string }>(
        "select distinct m.id,m.name,m.state from market_cells m join market_locations ml on ml.market_id=m.id where ml.organization_id=$1 and ml.active order by m.name",
        [organizationId],
      ),
      db.query<
        ProgramRecord &
          ProgramVersionRecord & { market_name: string; credit_cents: number }
      >(
        "select p.*,v.name,v.objective,v.objective_note,v.placement_category,v.starts_on,v.ends_on,v.buyer_organization_id,v.funder_organization_id,v.fulfiller_organization_id,v.negotiated_fee_cents,v.commercial_status,v.benefit_ceiling,v.operating_constraints,v.evaluation_plan,m.name market_name,(select coalesce(sum(c.amount_cents),0)::int from growth_program_credits c where c.program_id=p.id) credit_cents from growth_programs p join growth_program_versions v on v.program_id=p.id and v.version=p.current_version join market_cells m on m.id=p.market_id where p.buyer_organization_id=$1 or v.funder_organization_id=$1 or v.fulfiller_organization_id=$1 order by p.created_at desc",
        [organizationId],
      ),
      db.query<Record<string, unknown>>(
        "select q.*,m.name market_name,l.name location_name from merchant_supply_proposals q join market_cells m on m.id=q.market_id join locations l on l.id=q.location_id where q.supplier_organization_id=$1 or q.funder_organization_id=$1 or q.fulfiller_organization_id=$1 order by q.created_at desc",
        [organizationId],
      ),
      db.query<Record<string, unknown>>(
        "select l.program_id,l.program_version,l.week_key,s.id supply_id,s.state,t.exact_item,t.size_label,t.usable_hours,t.funder_organization_id,t.fulfiller_organization_id,o.name fulfiller_name,(select count(*)::int from fulfillment_grants g join weekly_releases r2 on r2.id=g.release_id where g.source_program_id=l.program_id and g.source_program_version=l.program_version and g.supply_id=s.id and g.week_key=l.week_key and r2.run_id=a.run_id and g.data_kind=r.data_kind) issued,(select count(*)::int from fulfillment_grants g join weekly_releases r2 on r2.id=g.release_id where g.source_program_id=l.program_id and g.source_program_version=l.program_version and g.supply_id=s.id and g.week_key=l.week_key and r2.run_id=a.run_id and g.data_kind=r.data_kind and g.state in ('claimed','redeemed')) claims,(select count(*)::int from fulfillment_grants g join weekly_releases r2 on r2.id=g.release_id where g.source_program_id=l.program_id and g.source_program_version=l.program_version and g.supply_id=s.id and g.week_key=l.week_key and r2.run_id=a.run_id and g.data_kind=r.data_kind and g.state='redeemed') redemptions,t.data_kind from program_supply_links l join growth_programs p on p.id=l.program_id join growth_program_versions v on v.program_id=p.id and v.version=l.program_version join growth_program_approvals a on a.program_id=l.program_id and a.program_version=l.program_version and a.decision='approved' join pilot_runs r on r.id=a.run_id join network_drop_supplies s on s.id=l.supply_id join pilot_supply_terms t on t.supply_id=s.id join organizations o on o.id=t.fulfiller_organization_id where (p.buyer_organization_id=$1 or v.funder_organization_id=$1 or v.fulfiller_organization_id=$1) and t.data_kind=r.data_kind union all select null program_id,null program_version,coalesce(organic_week.week_key,s.starts_at::date::text) week_key,s.id supply_id,s.state,t.exact_item,t.size_label,t.usable_hours,t.funder_organization_id,t.fulfiller_organization_id,o.name fulfiller_name,(select count(*)::int from fulfillment_grants g where g.supply_id=s.id and g.data_kind=t.data_kind and g.week_key=organic_week.week_key and g.source_program_id is null) issued,(select count(*)::int from fulfillment_grants g where g.supply_id=s.id and g.data_kind=t.data_kind and g.week_key=organic_week.week_key and g.source_program_id is null and g.state in ('claimed','redeemed')) claims,(select count(*)::int from fulfillment_grants g where g.supply_id=s.id and g.data_kind=t.data_kind and g.week_key=organic_week.week_key and g.source_program_id is null and g.state='redeemed') redemptions,t.data_kind from network_drop_supplies s join pilot_supply_terms t on t.supply_id=s.id join organizations o on o.id=t.fulfiller_organization_id left join lateral (select g.week_key from fulfillment_grants g where g.supply_id=s.id and g.data_kind=t.data_kind and g.source_program_id is null union select w.week_key from effective_pilot_week_supplies w where w.supply_id=s.id) organic_week on true where s.state in ('approved','paused','ended') and (t.funder_organization_id=$1 or t.fulfiller_organization_id=$1) and not exists(select 1 from program_supply_links l where l.supply_id=s.id) order by week_key,supply_id",
        [organizationId],
      ),
    ]);
  if (!organizations[0])
    throw new RequestError("Merchant workspace not found.", 404);
  const details = await Promise.all(
    programs.map(async (program) => {
      const [weekPlans, locationRows, protection, approvedVersion] =
        await Promise.all([
          db.query<{ week_key: string; planned_placements: number }>(
            "select week_key,planned_placements from growth_program_week_plans where program_id=$1 and program_version=$2 order by week_key",
            [program.id, program.current_version],
          ),
          db.query<{ id: string; name: string; address: string }>(
            "select l.id,l.name,l.address from growth_program_locations x join locations l on l.id=x.location_id where x.program_id=$1 and x.program_version=$2 order by l.name",
            [program.id, program.current_version],
          ),
          db.query<Record<string, unknown>>(
            "select * from growth_program_protections where program_id=$1 and program_version=$2",
            [program.id, program.current_version],
          ),
          program.approved_version &&
          program.approved_version !== program.current_version
            ? db.query<ProgramVersionRecord>(
                "select * from growth_program_versions where program_id=$1 and version=$2",
                [program.id, program.approved_version],
              )
            : Promise.resolve([]),
        ]);
      const approved = approvedVersion[0]
        ? {
            ...approvedVersion[0],
            negotiated_fee_cents:
              actor.role === "operator" ||
              program.buyer_organization_id === organizationId
                ? approvedVersion[0].negotiated_fee_cents
                : null,
            week_plans: await db.query<{
              week_key: string;
              planned_placements: number;
            }>(
              "select week_key,planned_placements from growth_program_week_plans where program_id=$1 and program_version=$2 order by week_key",
              [program.id, program.approved_version],
            ),
          }
        : null;
      const viewerRole =
        program.buyer_organization_id === organizationId
          ? "buyer"
          : program.fulfiller_organization_id === organizationId
            ? "fulfiller"
            : "funder";
      return {
        ...program,
        negotiated_fee_cents:
          actor.role === "operator" || viewerRole === "buyer"
            ? program.negotiated_fee_cents
            : null,
        credit_cents:
          actor.role === "operator" || viewerRole === "buyer"
            ? program.credit_cents
            : 0,
        viewer_role: viewerRole,
        week_plans: weekPlans,
        locations: locationRows,
        protection: protection[0] || null,
        approved_obligation: approved,
      };
    }),
  );
  return serializable({
    organization: organizations[0],
    locations,
    markets,
    programs: details,
    proposals,
    executions,
    asOf: new Date().toISOString(),
    reportingNote:
      "Issued means a backed placement record. A claim is a saved benefit. A redemption records use of a store credential; it does not prove a purchase, physical handoff or incremental sales.",
  });
}

export async function operatorGrowthProgramWorkspace(
  db: DB,
  actor: Actor,
  selectedOrganizationId?: string,
) {
  if (actor.role !== "operator")
    throw new RequestError("Only Uptick can open Program operations.", 403);
  const organizations = await db.query<{ id: string; name: string }>(
    "select distinct o.id,o.name from organizations o where exists(select 1 from market_locations ml where ml.organization_id=o.id and ml.active) or exists(select 1 from growth_programs p where p.buyer_organization_id=o.id) order by o.name",
  );
  const organizationId =
    selectedOrganizationId &&
    organizations.some(
      (organization) => organization.id === selectedOrganizationId,
    )
      ? selectedOrganizationId
      : organizations[0]?.id;
  if (!organizationId)
    return serializable({
      organizations,
      selectedOrganizationId: null,
      workspace: null,
      runs: [],
      supplies: [],
    });
  const workspace = await growthProgramWorkspace(db, {
    ...actor,
    organizationId,
  });
  const [runs, supplies] = await Promise.all([
    db.query<{
      id: string;
      name: string;
      market_id: string;
      starts_on: string;
      ends_on: string;
      state: string;
      hard_cap: number;
      paid_load_guidance: number;
    }>(
      "select r.id,r.name,r.market_id,r.starts_on,r.ends_on,r.state,r.hard_cap,r.paid_load_guidance from pilot_runs r where exists(select 1 from growth_programs p where p.buyer_organization_id=$1 and p.market_id=r.market_id) order by r.starts_on desc",
      [organizationId],
    ),
    db.query<{
      id: string;
      market_id: string;
      exact_item: string;
      funder_organization_id: string;
      fulfiller_organization_id: string;
      quantity: number;
      state: string;
    }>(
      "select s.id,s.market_id,t.exact_item,t.funder_organization_id,t.fulfiller_organization_id,s.quantity,s.state from network_drop_supplies s join pilot_supply_terms t on t.supply_id=s.id where s.state='approved' and s.inventory_policy<>'unlimited' and (t.funder_organization_id=$1 or t.fulfiller_organization_id=$1) and not exists(select 1 from program_supply_links l where l.supply_id=s.id) order by s.created_at desc",
      [organizationId],
    ),
  ]);
  return serializable({
    organizations,
    selectedOrganizationId: organizationId,
    workspace,
    runs,
    supplies,
  });
}
export type OperatorGrowthProgramWorkspace = Awaited<
  ReturnType<typeof operatorGrowthProgramWorkspace>
>;
