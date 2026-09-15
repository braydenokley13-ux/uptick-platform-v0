import type { DB } from "./db";
import type { Actor } from "./domain";
import {
  assertSampleDemoEnvironment as assertDemoEnvironment,
  assertSampleDemoStorage as assertDemoStorage,
} from "./demo-guard";
import { token } from "./security";
import { marketWeekWindow } from "./network";
import {
  requestMemberAccess,
  exchangeMemberAccess,
} from "./membership-identity";
import {
  releaseWeeklyBenefits,
  reportFulfillmentIncident,
  issueIncidentRecovery,
} from "./pilot-promise";

export const DEMO_PHONE = "+12025550123";
export const demoActor: Actor = {
  id: "demo-operator",
  role: "operator",
  organizationId: "demo-store",
  canExport: true,
};

export async function seedDemoStudio(db: DB) {
  assertDemoStorage();
  if ((await db.query("select id from pilot_runs where id='demo-run'")).length)
    return;
  const window = marketWeekWindow(new Date(), "America/New_York");
  const end = new Date(window.start.getTime() + 35 * 86400000).toISOString();
  const start = new Date(window.start.getTime() - 86400000).toISOString();
  const ready = new Date(Date.now() - 60000).toISOString();
  await db.transaction(async (tx) => {
    await tx.query(
      "insert into organizations(id,name,is_demo) values('demo-store','Sample Fuel & Market',true)",
    );
    await tx.query(
      "insert into locations(id,organization_id,name,address,postal_code) values('demo-counter','demo-store','Sample staff counter','Illustrative gas station and convenience store','10583')",
    );
    await tx.query(
      "insert into memberships(user_id,organization_id,role,can_export) values('demo-operator','demo-store','operator',true),('demo-merchant','demo-store','merchant',false)",
    );
    await tx.query(
      "insert into market_cells(id,name,slug,timezone,state,data_kind) values('demo-market','Sample Neighborhood','demo-neighborhood','America/New_York','pilot','demo')",
    );
    await tx.query(
      "insert into market_zips(market_id,zip) values('demo-market','10583')",
    );
    await tx.query(
      "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values('demo-market','demo-counter','demo-store',5)",
    );
    await tx.query(
      "insert into redemption_points(id,organization_id,location_id,name,exposure,created_by) values('demo-point','demo-store','demo-counter','DEMO staff QR','staff','demo-operator')",
    );
    await tx.query(
      "insert into redemption_credentials(id,point_id,public_token,credential_type,version,created_by) values('demo-qr','demo-point',$1,'qr',1,'demo-operator')",
      [token()],
    );
    await tx.query(
      `insert into pilot_runs(id,market_id,name,starts_on,ends_on,state,data_kind,target_members,hard_cap,operator_owner,support_owner,backup_support_owner,checklist,created_by)
      values('demo-run','demo-market','Four-week founder rehearsal',$1,$1::date+28,'enrolling','demo',1,200,'Demo operator','Demo support','Demo backup','{"demoOnly":true}','demo-operator')`,
      [window.weekKey],
    );
    for (let week = 0; week < 4; week++) {
      const key = new Date(
        Date.parse(`${window.weekKey}T12:00:00Z`) + week * 7 * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      const supply = `demo-supply-${week + 1}`;
      await tx.query(
        "insert into offers(id,organization_id,location_id,kind,state,title) values($1,'demo-store','demo-counter','drop','live',$2)",
        [`demo-offer-${week + 1}`, `Your week ${week + 1} coffee`],
      );
      await tx.query(
        "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity) values($1,1,'No purchase required','One free 12 oz coffee','One per admitted member this week. No purchase required. Sample only.',$2,$3,'claim',5)",
        [`demo-offer-${week + 1}`, start, end],
      );
      await tx.query(
        `insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,verification_mode,staff_instructions,fallback_plan,approved_by,data_kind)
        values($1,'demo-market','demo-store','demo-counter',$2,1,'approved',$3,$4,'claim',5,'staff_tap','Present the staff QR and hand over one sample item.','Independent bottled-water fallback.','demo-operator','demo')`,
        [supply, `demo-offer-${week + 1}`, start, end],
      );
      await tx.query(
        `insert into pilot_supply_terms(supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,funder_organization_id,fulfiller_organization_id,data_kind,created_by)
        values($1,'One free 12 oz coffee','DEMO-COFFEE','12 oz','Daily, 7am–8pm (sample hours)','coffee-machine','demo-store','demo-store','demo','demo-operator')`,
        [supply],
      );
      await tx.query(
        `insert into pilot_supply_fallbacks(id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,usable_capacity,instructions,payer_organization_id,state,approved_by,created_by)
        values($1,$2,'One sealed bottle of water','DEMO-WATER','16 oz','sealed-water-stock',5,'Hand over one sealed sample bottle and confirm at the staff QR.','demo-store','approved','demo-operator','demo-operator')`,
        [`demo-fallback-${week + 1}`, supply],
      );
      await tx.query(
        `insert into destination_readiness(supply_id,organization_id,location_id,state,owner_approved_by,primary_manager,primary_contact,backup_contact,stock_confirmed_at,exact_item_confirmed,staff_instructions_confirmed,shifts_briefed_at,valid_hours_confirmed,qr_rehearsed_at,support_escalation,valid_until,updated_by)
        values($1,'demo-store','demo-counter','ready','demo-operator','Sample manager','manager@example.test','backup@example.test',$2,true,true,$2,true,$2,'Sample operator handles fulfillment issues.',$3,'demo-operator')`,
        [supply, ready, end],
      );
      await tx.query(
        "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values('demo-run',$1,$2,5,'demo-operator')",
        [key, supply],
      );
    }
  });
  const requested = await requestMemberAccess(db, {
    phone: DEMO_PHONE,
    homeZip: "10583",
    consentRequested: false,
    ageAttested: true,
  });
  await exchangeMemberAccess(db, requested.credential, false);
  await db.query("update pilot_runs set state='live' where id='demo-run'");
  await releaseWeeklyBenefits(db, demoActor, {
    runId: "demo-run",
    marketId: "demo-market",
    weekKey: window.weekKey,
    dataKind: "demo",
    requestKey: "demo-first-week-release",
    assignments: [{ memberId: requested.member.id, supplyId: "demo-supply-1" }],
  });
}

export async function demoSnapshot(db: DB) {
  assertDemoEnvironment();
  const [member] = await db.query<{ id: string }>(
    "select m.id from uptick_members m join customers c on c.id=m.customer_id where c.phone=$1 and m.data_kind='demo'",
    [DEMO_PHONE],
  );
  const [grant] = await db.query<{ id: string; state: string }>(
    "select id,state from fulfillment_grants where member_id=$1 and supply_id='demo-supply-1'",
    [member?.id],
  );
  const [qr] = await db.query<{ public_token: string }>(
    "select public_token from redemption_credentials where id='demo-qr'",
  );
  const [counts] = await db.query<{
    claims: number;
    redemptions: number;
    incidents: number;
    recoveries: number;
    recovery_redemptions: number;
  }>(`select
    (select count(*)::int from member_claims) claims,
    (select count(*)::int from redemptions) redemptions,
    (select count(*)::int from fulfillment_incidents) incidents,
    (select count(*)::int from recovery_grants) recoveries,
    (select count(*)::int from recovery_redemptions) recovery_redemptions`);
  return { member, grant, qr, counts };
}

export async function demoStockout(db: DB) {
  const snapshot = await demoSnapshot(db);
  if (!snapshot.grant)
    throw Error("Reset the demo to prepare the sample benefit.");
  return reportFulfillmentIncident(db, demoActor, {
    grantId: snapshot.grant.id,
    incidentType: "out_of_stock",
    severity: "high",
    occurredAt: new Date().toISOString(),
    owner: "Demo operator",
    note: "DEMO: coffee was unavailable before physical handoff. Any digital redemption remains recorded; handoff is unknown.",
    idempotencyKey: "demo-coffee-stockout",
  });
}

export async function demoRecovery(db: DB) {
  assertDemoEnvironment();
  const [incident] = await db.query<{ id: string }>(
    "select id from fulfillment_incidents where idempotency_key='demo-coffee-stockout'",
  );
  if (!incident) throw Error("First choose Report sample stockout.");
  return issueIncidentRecovery(db, demoActor, {
    incidentId: incident.id,
    remedyType: "same_counter",
    fallbackId: "demo-fallback-1",
    replacementSupplyId: null,
    payerOrganizationId: "demo-store",
    payerEvidence:
      "DEMO: sample merchant funds separate sealed-bottle stock; no real cost or commitment.",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
}
