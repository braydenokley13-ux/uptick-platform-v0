import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import {
  approveGrowthProgramVersion,
  createGrowthProgram,
  growthProgramWorkspace,
  linkProgramSupply,
  proposeGrowthProgramAmendment,
  recordProgramCredit,
  submitMerchantSupplyProposal,
} from "../src/lib/growth-programs";

process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
delete process.env.VERCEL;

let db: DB;
const operator: Actor = {
  id: "operator",
  role: "operator",
  organizationId: "uptick",
};
const merchant = (organizationId: string): Actor => ({
  id: `${organizationId}-merchant`,
  role: "merchant",
  organizationId,
});

before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db.close?.();
});
beforeEach(async () => {
  await db.query("truncate organizations,market_cells,rate_limits cascade");
  for (const organization of ["uptick", "a", "b", "c"])
    await db.query("insert into organizations(id,name) values($1,$2)", [
      organization,
      organization === "uptick"
        ? "Uptick Local"
        : `Store ${organization.toUpperCase()}`,
    ]);
  await db.query(
    "insert into market_cells(id,name,slug,state,data_kind) values('m1','West market','west','pilot','internal'),('m2','East market','east','pilot','internal')",
  );
  const locations = [
    ["a-location", "a", "A Main", 40, -73, "m1"],
    ["b-location", "b", "B Main", 40.005, -73, "m2"],
    ["c-location", "c", "C Main", 41, -74, "m1"],
  ] as const;
  for (const [
    location,
    organization,
    name,
    latitude,
    longitude,
    market,
  ] of locations) {
    await db.query(
      "insert into locations(id,organization_id,name,address,latitude,longitude) values($1,$2,$3,'1 Test Street',$4,$5)",
      [location, organization, name, latitude, longitude],
    );
    await db.query(
      "insert into market_locations(market_id,location_id,organization_id) values($1,$2,$3)",
      [market, location, organization],
    );
  }
});

function programInput(
  buyer = "a",
  marketId = "m1",
  fulfiller = buyer,
  locationId = `${fulfiller}-location`,
  plannedPlacements = 50,
) {
  return {
    buyerOrganizationId: buyer,
    marketId,
    name: `${buyer.toUpperCase()} breakfast introduction`,
    objective: "introduce_breakfast" as const,
    objectiveNote:
      "Introduce the free morning benefit to relevant local members.",
    placementCategory: "coffee shop",
    startsOn: "2030-01-07",
    endsOn: "2030-01-13",
    funderOrganizationId: buyer,
    fulfillerOrganizationId: fulfiller,
    negotiatedFeeCents: 42500,
    commercialStatus: "agreed" as const,
    benefitCeiling: plannedPlacements,
    operatingConstraints:
      "Only backed, relevant member placements at a ready participating counter.",
    evaluationPlan:
      "Review issued placements, claims and redemption evidence without inferring sales.",
    locationIds: [locationId],
    weekPlans: [{ weekKey: "2030-01-07", plannedPlacements }],
    protection: null,
  };
}

async function pilotRun(
  runId: string,
  marketId: string,
  hardCap = 200,
  targetMembers = hardCap,
) {
  await db.query(
    "insert into pilot_runs(id,market_id,name,starts_on,ends_on,state,data_kind,target_members,hard_cap,operator_owner,support_owner,backup_support_owner,created_by) values($1,$2,$3,'2030-01-07','2030-02-04','draft','internal',$4,$4,'operator','support','backup','operator')",
    [runId, marketId, `${marketId} pilot`, targetMembers],
  );
  if (targetMembers !== hardCap)
    await db.query("update pilot_runs set hard_cap=$2 where id=$1", [
      runId,
      hardCap,
    ]);
  const organizationId = marketId === "m2" ? "b" : "a";
  for (const [index, weekKey] of [
    "2030-01-07",
    "2030-01-14",
    "2030-01-21",
    "2030-01-28",
  ].entries()) {
    const supplyId = `${runId}-backing-${index}`;
    await approvedSupply({
      id: supplyId,
      marketId,
      organizationId,
      locationId: `${organizationId}-location`,
      quantity: targetMembers,
    });
    await db.query(
      "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,$4,'operator')",
      [runId, weekKey, supplyId, targetMembers],
    );
  }
}

async function approvedSupply(options: {
  id: string;
  marketId: string;
  organizationId: string;
  locationId: string;
  funderId?: string;
  quantity?: number;
}) {
  const quantity = options.quantity || 50;
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','review','Free pilot item')",
    [options.id, options.organizationId, options.locationId],
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity) values($1,1,'No purchase required','Free pilot item','One per admitted member','2030-01-07','2030-02-04','claim',$2)",
    [options.id, quantity],
  );
  await db.query(
    "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,verification_mode,staff_instructions,fallback_plan,funding_source,approved_by,data_kind) values($1,$2,$3,$4,$1,1,'approved','2030-01-07','2030-02-04','claim',$5,'staff_tap','Present the staff QR after confirming the item.','Use the approved independent bottled substitute.','merchant','operator','internal')",
    [
      options.id,
      options.marketId,
      options.organizationId,
      options.locationId,
      quantity,
    ],
  );
  await db.query(
    "insert into pilot_supply_terms(supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,required_spend,member_fee,funder_organization_id,fulfiller_organization_id,data_kind,created_by) values($1,'16 oz hot coffee','COFFEE16','16 oz','6:00 AM–11:00 AM','coffee-machine',0,0,$2,$3,'internal','operator')",
    [
      options.id,
      options.funderId || options.organizationId,
      options.organizationId,
    ],
  );
  await db.query(
    "insert into destination_readiness(supply_id,organization_id,location_id,state,owner_approved_by,primary_manager,primary_contact,backup_contact,stock_confirmed_at,exact_item_confirmed,staff_instructions_confirmed,shifts_briefed_at,valid_hours_confirmed,qr_rehearsed_at,support_escalation,valid_until,updated_by) values($1,$2,$3,'ready','owner','Manager','manager@example.test','backup@example.test',now(),true,true,now(),true,now(),'Call the Uptick support owner.','2030-02-05','operator')",
    [options.id, options.organizationId, options.locationId],
  );
  await db.query(
    "insert into pilot_supply_fallbacks(id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,usable_capacity,instructions,payer_organization_id,state,approved_by,created_by) values($1,$2,'16 oz bottled beverage','BOTTLE16','16 oz','bottled-cooler',$3,'Give the approved bottle at no charge and use the same QR.',$4,'approved','operator','operator')",
    [
      `${options.id}-fallback`,
      options.id,
      quantity,
      options.funderId || options.organizationId,
    ],
  );
  await db.query(
    "insert into redemption_points(id,organization_id,location_id,name,exposure,state,created_by) values($1,$2,$3,'Staff counter','staff','active','operator')",
    [`${options.id}-point`, options.organizationId, options.locationId],
  );
  await db.query(
    "insert into redemption_credentials(id,point_id,public_token,credential_type,state,version,created_by) values($1,$2,$3,'qr','active',1,'operator')",
    [`${options.id}-credential`, `${options.id}-point`, `${options.id}-token`],
  );
}

test("Program amendments are prospective and approved version records are immutable", async () => {
  const programId = await createGrowthProgram(
    db,
    merchant("a"),
    programInput(),
  );
  const version = await proposeGrowthProgramAmendment(
    db,
    merchant("a"),
    programId,
    {
      ...programInput(),
      benefitCeiling: 40,
      weekPlans: [{ weekKey: "2030-01-07", plannedPlacements: 40 }],
    },
  );
  assert.equal(version, 2);
  const [program] = await db.query<{
    current_version: number;
    pending_version: number;
    approved_version: number | null;
  }>(
    "select current_version,pending_version,approved_version from growth_programs where id=$1",
    [programId],
  );
  assert.deepEqual(program, {
    current_version: 2,
    pending_version: 2,
    approved_version: null,
  });
  assert.equal(
    (
      await db.query(
        "select * from growth_program_versions where program_id=$1",
        [programId],
      )
    ).length,
    2,
  );
  await assert.rejects(
    db.query(
      "update growth_program_versions set negotiated_fee_cents=1 where program_id=$1 and version=1",
      [programId],
    ),
    /immutable/i,
  );
  await assert.rejects(
    createGrowthProgram(db, merchant("a"), {
      ...programInput("b", "m2", "b"),
    }),
    /access/,
  );
});

test("buyer and fulfiller remain distinct roles with organization-scoped commercial reads", async () => {
  const input = {
    ...programInput("a", "m2", "b", "b-location"),
    funderOrganizationId: "a",
  };
  const programId = await createGrowthProgram(db, operator, input);
  const buyer = await growthProgramWorkspace(db, merchant("a"));
  const fulfiller = await growthProgramWorkspace(db, merchant("b"));
  const stranger = await growthProgramWorkspace(db, merchant("c"));
  assert.equal(buyer.programs[0].id, programId);
  assert.equal(buyer.programs[0].viewer_role, "buyer");
  assert.equal(Number(buyer.programs[0].negotiated_fee_cents), 42500);
  assert.equal(fulfiller.programs[0].viewer_role, "fulfiller");
  assert.equal(fulfiller.programs[0].negotiated_fee_cents, null);
  assert.equal(stranger.programs.length, 0);
  assert.equal(
    JSON.stringify([buyer, fulfiller, stranger]).includes("phone"),
    false,
  );
});

test("organic supply is proposed directly without an Offer, Growth fee or approved-capacity claim", async () => {
  const proposalId = await submitMerchantSupplyProposal(db, merchant("a"), {
    programId: null,
    programVersion: null,
    supplierOrganizationId: "a",
    funderOrganizationId: "a",
    fulfillerOrganizationId: "a",
    fallbackPayerOrganizationId: "a",
    marketId: "m1",
    locationId: "a-location",
    exactItem: "16 oz hot coffee",
    itemIdentifier: "COFFEE16",
    usableHours: "6:00 AM–11:00 AM",
    startsOn: "2030-01-07",
    endsOn: "2030-02-03",
    quantity: 500,
    fallbackSubstitute: "16 oz bottled beverage",
    fallbackInstructions:
      "Give the approved bottle at no charge and use the same QR.",
  });
  const [proposal] = await db.query<{
    id: string;
    required_spend_cents: number;
    member_fee_cents: number;
    program_id: string | null;
  }>(
    "select id,required_spend_cents,member_fee_cents,program_id from merchant_supply_proposals",
  );
  assert.deepEqual(proposal, {
    id: proposalId,
    required_spend_cents: 0,
    member_fee_cents: 0,
    program_id: null,
  });
  assert.equal((await db.query("select * from offers")).length, 0);
  assert.equal(
    (await db.query("select * from network_drop_supplies")).length,
    0,
  );
  assert.equal("growth_fee_cents" in proposal, false);
  await approvedSupply({
    id: "organic-supply",
    marketId: "m1",
    organizationId: "a",
    locationId: "a-location",
    quantity: 50,
  });
  const results = await growthProgramWorkspace(db, merchant("a"));
  assert.equal(results.executions.length, 1);
  assert.equal(results.executions[0].program_id, null);
  assert.equal(Number(results.executions[0].issued), 0);
  assert.equal(results.executions[0].data_kind, "internal");
  await assert.rejects(
    submitMerchantSupplyProposal(db, merchant("a"), {
      programId: null,
      programVersion: null,
      supplierOrganizationId: "a",
      funderOrganizationId: "a",
      fulfillerOrganizationId: "b",
      fallbackPayerOrganizationId: "a",
      marketId: "m2",
      locationId: "b-location",
      exactItem: "Free coffee",
      itemIdentifier: "",
      usableHours: "Mornings",
      startsOn: "2030-01-07",
      endsOn: "2030-02-03",
      quantity: 50,
      fallbackSubstitute: "Free bottle",
      fallbackInstructions: "Give the free bottle at the same counter.",
    }),
    /access/,
  );
});

test("approval uses stored weekly supply and readiness, then records negotiated fee once at Program level", async () => {
  const programId = await createGrowthProgram(db, operator, {
    ...programInput("a", "m1", "a", "a-location"),
  });
  await pilotRun("run-1", "m1");
  await submitMerchantSupplyProposal(db, merchant("a"), {
    programId,
    programVersion: 1,
    supplierOrganizationId: "a",
    funderOrganizationId: "a",
    fulfillerOrganizationId: "a",
    fallbackPayerOrganizationId: "a",
    marketId: "m1",
    locationId: "a-location",
    exactItem: "Merchant-entered coffee",
    itemIdentifier: "PROPOSED",
    usableHours: "Mornings",
    startsOn: "2030-01-07",
    endsOn: "2030-01-13",
    quantity: 500,
    fallbackSubstitute: "Merchant-entered bottle",
    fallbackInstructions:
      "Give the bottle at no charge if coffee is unavailable.",
  });
  await assert.rejects(
    approveGrowthProgramVersion(db, operator, {
      programId,
      programVersion: 1,
      runId: "run-1",
      note: "Reviewed commercial terms and stored capacity.",
      attentionExceptionReason: null,
    }),
    /Link approved execution supply/,
  );
  await approvedSupply({
    id: "supply-a",
    marketId: "m1",
    organizationId: "a",
    locationId: "a-location",
  });
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values('run-1','2030-01-07','supply-a',50,'operator')",
  );
  await linkProgramSupply(db, operator, {
    programId,
    programVersion: 1,
    supplyId: "supply-a",
    weekKey: "2030-01-07",
  });
  await approveGrowthProgramVersion(db, operator, {
    programId,
    programVersion: 1,
    runId: "run-1",
    note: "Reviewed commercial terms and stored capacity.",
    attentionExceptionReason: null,
  });
  const [program] = await db.query<{
    approved_version: number;
    status: string;
  }>("select approved_version,status from growth_programs where id=$1", [
    programId,
  ]);
  assert.deepEqual(program, { approved_version: 1, status: "approved" });
  assert.equal(
    (
      await db.query(
        "select negotiated_fee_cents from growth_program_versions where program_id=$1",
        [programId],
      )
    ).length,
    1,
  );
  const [supply] = await db.query<{ growth_fee: number | null }>(
    "select growth_fee from network_drop_supplies where id='supply-a'",
  );
  assert.equal(supply.growth_fee, null);
  await db.query(
    "insert into customers(id,phone) values('customer-1','+12125550101')",
  );
  await db.query(
    "insert into uptick_members(id,customer_id,home_zip,market_id,state,verified_at) values('member-1','customer-1','10583','m1','active',now())",
  );
  for (const [weekKey, suffix] of [
    ["2030-01-07", "one"],
    ["2030-01-14", "two"],
  ]) {
    await db.query(
      "insert into member_allocations(id,member_id,market_id,week_key) values($1,'member-1','m1',$2)",
      [`allocation-${suffix}`, weekKey],
    );
    await db.query(
      "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values($1,'supply-a','m1',1,'{}')",
      [`allocation-${suffix}`],
    );
    await db.query(
      "insert into weekly_releases(id,run_id,market_id,week_key,state,data_kind,member_count,reviewed_by,request_key,request_fingerprint) values($1,'run-1','m1',$2,'published','internal',1,'operator',$3,$3)",
      [`release-${suffix}`, weekKey, `request-${suffix}`],
    );
  }
  await db.query(
    "insert into fulfillment_grants(id,release_id,allocation_id,member_id,market_id,week_key,supply_id,organization_id,location_id,offer_id,offer_version,member_snapshot,expires_at,source_program_id,source_program_version,data_kind) values('grant-valid','release-one','allocation-one','member-1','m1','2030-01-07','supply-a','a','a-location','supply-a',1,'{}','2030-01-14',$1,1,'internal')",
    [programId],
  );
  await assert.rejects(
    db.query(
      "insert into fulfillment_grants(id,release_id,allocation_id,member_id,market_id,week_key,supply_id,organization_id,location_id,offer_id,offer_version,member_snapshot,expires_at,source_program_id,source_program_version,data_kind) values('grant-invalid','release-two','allocation-two','member-1','m1','2030-01-14','supply-a','a','a-location','supply-a',1,'{}','2030-01-21',$1,1,'internal')",
      [programId],
    ),
    /approved Program supply link for this week/,
  );
  const results = await growthProgramWorkspace(db, merchant("a"));
  assert.equal(
    Number(
      results.executions.find((row) => row.supply_id === "supply-a")?.issued,
    ),
    1,
  );
  const credit = await recordProgramCredit(db, operator, {
    programId,
    amountCents: 2500,
    reason: "Credit for one documented missed service commitment.",
    reference: "incident-1",
  });
  assert.ok(credit);
  assert.equal(
    await recordProgramCredit(db, operator, {
      programId,
      amountCents: 2500,
      reason: "Credit for one documented missed service commitment.",
      reference: "incident-1",
    }),
    credit,
  );
  await assert.rejects(
    recordProgramCredit(db, operator, {
      programId,
      amountCents: 2000,
      reason:
        "A conflicting amount must not reuse the same evidence reference.",
      reference: "incident-1",
    }),
    /already identifies a different credit/,
  );
  await assert.rejects(
    recordProgramCredit(db, operator, {
      programId,
      amountCents: 42500,
      reason:
        "This would exceed the negotiated Program fee after prior credit.",
      reference: "incident-2",
    }),
    /cannot exceed/,
  );
  await proposeGrowthProgramAmendment(db, merchant("a"), programId, {
    ...programInput(),
    name: "Prospective breakfast extension",
  });
  const amended = await growthProgramWorkspace(db, merchant("a"));
  assert.equal(amended.programs[0].approved_version, 1);
  assert.equal(amended.programs[0].pending_version, 2);
  assert.equal(amended.programs[0].approved_obligation?.version, 1);

  await linkProgramSupply(db, operator, {
    programId,
    programVersion: 2,
    supplyId: "supply-a",
    weekKey: "2030-01-07",
  });
  await assert.rejects(
    approveGrowthProgramVersion(db, operator, {
      programId,
      programVersion: 2,
      runId: "run-1",
      note: "Review the prospective version without changing issued promises.",
      attentionExceptionReason: null,
    }),
    /issued member obligations/,
  );
});

test("an amended fee cannot fall below prior credits", async () => {
  const programId = await createGrowthProgram(db, operator, programInput());
  await pilotRun("run-credit", "m1", 50);
  await approvedSupply({
    id: "credit-supply",
    marketId: "m1",
    organizationId: "a",
    locationId: "a-location",
  });
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values('run-credit','2030-01-07','credit-supply',50,'operator')",
  );
  await linkProgramSupply(db, operator, {
    programId,
    programVersion: 1,
    supplyId: "credit-supply",
    weekKey: "2030-01-07",
  });
  await approveGrowthProgramVersion(db, operator, {
    programId,
    programVersion: 1,
    runId: "run-credit",
    note: "Reviewed the original fee and backed execution capacity.",
    attentionExceptionReason:
      "The full fixed cohort receives the single paid featured placement.",
  });
  await recordProgramCredit(db, operator, {
    programId,
    amountCents: 2500,
    reason: "Documented credit against the approved service obligation.",
    reference: "credit-evidence-1",
  });
  await proposeGrowthProgramAmendment(db, operator, programId, {
    ...programInput(),
    negotiatedFeeCents: 2000,
  });
  await linkProgramSupply(db, operator, {
    programId,
    programVersion: 2,
    supplyId: "credit-supply",
    weekKey: "2030-01-07",
  });
  await assert.rejects(
    approveGrowthProgramVersion(db, operator, {
      programId,
      programVersion: 2,
      runId: "run-credit",
      note: "This reduced fee cannot erase an already approved credit.",
      attentionExceptionReason:
        "The full fixed cohort receives the single paid featured placement.",
    }),
    /cannot be lower than credits/,
  );
});

test("paid-load guidance requires an explicit operator review while the hard cap stays absolute", async () => {
  const programId = await createGrowthProgram(
    db,
    operator,
    programInput("a", "m1", "a", "a-location", 130),
  );
  await pilotRun("run-guidance", "m1", 200);
  await approvedSupply({
    id: "supply-guidance",
    marketId: "m1",
    organizationId: "a",
    locationId: "a-location",
    quantity: 130,
  });
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values('run-guidance','2030-01-07','supply-guidance',130,'operator')",
  );
  await linkProgramSupply(db, operator, {
    programId,
    programVersion: 1,
    supplyId: "supply-guidance",
    weekKey: "2030-01-07",
  });
  await assert.rejects(
    approveGrowthProgramVersion(db, operator, {
      programId,
      programVersion: 1,
      runId: "run-guidance",
      note: "Reviewed supply and readiness before paid attention approval.",
      attentionExceptionReason: null,
    }),
    /exceeds pilot guidance/,
  );
  await approveGrowthProgramVersion(db, operator, {
    programId,
    programVersion: 1,
    runId: "run-guidance",
    note: "Reviewed supply and readiness before paid attention approval.",
    attentionExceptionReason:
      "Operator accepted the load after reviewing relevance and the fixed cohort.",
  });
  const [snapshot] = await db.query<{
    capacity_snapshot: Record<string, unknown>;
  }>(
    "select capacity_snapshot from growth_program_approvals where program_id=$1",
    [programId],
  );
  assert.equal(snapshot.capacity_snapshot.guidanceExceeded, true);
});

test("paid placements cannot exceed the backed target audience", async () => {
  const programId = await createGrowthProgram(
    db,
    operator,
    programInput("a", "m1", "a", "a-location", 151),
  );
  await pilotRun("run-audience", "m1", 200, 150);
  await approvedSupply({
    id: "audience-supply",
    marketId: "m1",
    organizationId: "a",
    locationId: "a-location",
    quantity: 151,
  });
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values('run-audience','2030-01-07','audience-supply',151,'operator')",
  );
  await linkProgramSupply(db, operator, {
    programId,
    programVersion: 1,
    supplyId: "audience-supply",
    weekKey: "2030-01-07",
  });
  await assert.rejects(
    approveGrowthProgramVersion(db, operator, {
      programId,
      programVersion: 1,
      runId: "run-audience",
      note: "Review the paid load against the audience that can receive it.",
      attentionExceptionReason:
        "An exception cannot create another member in the backed audience.",
    }),
    /exceed the backed pilot audience of 150/,
  );
});

test("a frozen run sells paid attention only to its admitted cohort", async () => {
  const programId = await createGrowthProgram(
    db,
    operator,
    programInput("a", "m1", "a", "a-location", 3),
  );
  await pilotRun("run-frozen-audience", "m1", 5);
  await approvedSupply({
    id: "frozen-audience-supply",
    marketId: "m1",
    organizationId: "a",
    locationId: "a-location",
    quantity: 3,
  });
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values('run-frozen-audience','2030-01-07','frozen-audience-supply',3,'operator')",
  );
  await linkProgramSupply(db, operator, {
    programId,
    programVersion: 1,
    supplyId: "frozen-audience-supply",
    weekKey: "2030-01-07",
  });
  await db.query(
    "update pilot_runs set state='enrolling' where id='run-frozen-audience'",
  );
  for (const index of [1, 2]) {
    await db.query("insert into customers(id,phone) values($1,$2)", [
      `frozen-customer-${index}`,
      `+1212555000${index}`,
    ]);
    await db.query(
      "insert into uptick_members(id,customer_id,home_zip,market_id,state,verified_at,data_kind,age_confirmed_at) values($1,$2,'10583','m1','active',now(),'internal',now())",
      [`frozen-member-${index}`, `frozen-customer-${index}`],
    );
    await db.query(
      "insert into pilot_admissions(run_id,member_id,data_kind) values('run-frozen-audience',$1,'internal')",
      [`frozen-member-${index}`],
    );
  }
  await db.query(
    "update pilot_runs set state='live' where id='run-frozen-audience'",
  );
  await assert.rejects(
    approveGrowthProgramVersion(db, operator, {
      programId,
      programVersion: 1,
      runId: "run-frozen-audience",
      note: "Review paid placement count against the frozen admitted cohort.",
      attentionExceptionReason:
        "An exception cannot enlarge a cohort after its baseline is frozen.",
    }),
    /exceed the backed pilot audience of 2/,
  );
});

test("existing paid protection catches a nearby candidate that requests no protection", async () => {
  const firstInput = {
    ...programInput("a", "m1", "a", "a-location", 20),
    protection: {
      protectedLocationId: "a-location",
      competingCategory: "coffee shop",
      radiusMiles: 1.5,
      startsOn: "2030-01-07",
      endsOn: "2030-01-13",
      placementScope: "paid_featured" as const,
      exceptions: [],
      terminationConditions:
        "Protection ends if destination readiness or fulfillment is suspended.",
    },
  };
  const secondInput = {
    ...programInput("b", "m2", "b", "b-location", 20),
    protection: null,
  };
  const first = await createGrowthProgram(db, operator, firstInput);
  const second = await createGrowthProgram(db, operator, secondInput);
  await pilotRun("run-1", "m1");
  await pilotRun("run-2", "m2");
  await approvedSupply({
    id: "supply-a",
    marketId: "m1",
    organizationId: "a",
    locationId: "a-location",
    quantity: 20,
  });
  await approvedSupply({
    id: "supply-b",
    marketId: "m2",
    organizationId: "b",
    locationId: "b-location",
    quantity: 20,
  });
  for (const [runId, supplyId, programId] of [
    ["run-1", "supply-a", first],
    ["run-2", "supply-b", second],
  ]) {
    await db.query(
      "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,'2030-01-07',$2,20,'operator')",
      [runId, supplyId],
    );
    await linkProgramSupply(db, operator, {
      programId,
      programVersion: 1,
      supplyId,
      weekKey: "2030-01-07",
    });
  }
  await approveGrowthProgramVersion(db, operator, {
    programId: first,
    programVersion: 1,
    runId: "run-1",
    note: "Reviewed the first protected placement and all stored capacity.",
    attentionExceptionReason: null,
  });
  await assert.rejects(
    approveGrowthProgramVersion(db, operator, {
      programId: second,
      programVersion: 1,
      runId: "run-2",
      note: "Reviewed the second protected placement and all stored capacity.",
      attentionExceptionReason: null,
    }),
    /conflicts with active commercial protection/,
  );
  await assert.rejects(
    createGrowthProgram(db, operator, {
      ...firstInput,
      protection: { ...firstInput.protection, radiusMiles: 1.6 },
    }),
  );
});
