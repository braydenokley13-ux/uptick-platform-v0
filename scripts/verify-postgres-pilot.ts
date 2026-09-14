import assert from "node:assert/strict";
import type { DB } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";
import { decrypt, encrypt, hash, token } from "../src/lib/security";
import { marketWeekWindow, claimMemberDrop, supplyUsage } from "../src/lib/network";
import { adjustSupply } from "../src/lib/network-operations";
import {
  issueIncidentRecovery,
  releaseWeeklyBenefits,
  reportMemberFulfillmentIncident,
} from "../src/lib/pilot-promise";
import { redeemAtPoint } from "../src/lib/tap";
import {
  assertLocalSeedEnvironment,
  assertNoRealPilotData,
} from "../src/lib/seed-safety";

export type SyntheticPilotFixture = {
  actor: Actor;
  runId: string;
  marketId: string;
  supplyId: string;
  fallbackId: string;
  pointToken: string;
  weekKey: string;
  members: { id: string; customerId: string }[];
};

// This fixture uses conspicuous synthetic classification and fixed IDs. It is
// intended only for a new isolated verification database.
export async function seedSyntheticPilot(
  db: DB,
  count = 150,
  prefix = "restore-pilot",
): Promise<SyntheticPilotFixture> {
  assertLocalSeedEnvironment();
  await assertNoRealPilotData(db);
  if (!Number.isInteger(count) || count < 1 || count > 200)
    throw Error("Synthetic pilot fixture size must be between 1 and 200.");
  if (!/^[a-z0-9-]{3,40}$/.test(prefix))
    throw Error("Use a short lowercase synthetic fixture prefix.");
  const actor: Actor = {
    id: `${prefix}-operator`,
    role: "operator",
    organizationId: `${prefix}-merchant`,
  };
  const organizationId = `${prefix}-merchant`;
  const locationId = `${prefix}-counter`;
  const marketId = `${prefix}-market`;
  const offerId = `${prefix}-offer`;
  const supplyId = `${prefix}-supply`;
  const fallbackId = `${prefix}-fallback`;
  const runId = `${prefix}-run`;
  const pointId = `${prefix}-point`;
  const credentialId = `${prefix}-qr`;
  const pointToken = token();
  const window = marketWeekWindow(new Date(), "America/New_York");
  const endsOn = new Date(
    Date.parse(`${window.weekKey}T12:00:00Z`) + 28 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const supplyStart = new Date(window.start.getTime() - 86400000).toISOString();
  const supplyEnd = new Date(window.start.getTime() + 35 * 86400000).toISOString();
  const readyAt = new Date(Date.now() - 60000).toISOString();
  const readyUntil = new Date(window.end.getTime() + 86400000).toISOString();

  await db.query("insert into organizations(id,name) values($1,$2)", [
    organizationId,
    "Synthetic Pilot Merchant",
  ]);
  await db.query(
    "insert into locations(id,organization_id,name,address,postal_code) values($1,$2,'Synthetic Counter','1 Test Way','10001')",
    [locationId, organizationId],
  );
  await db.query(
    "insert into market_cells(id,name,slug,timezone,state,data_kind) values($1,'Synthetic Pilot','synthetic-restore-pilot','America/New_York','pilot','synthetic')",
    [marketId],
  );
  await db.query("insert into market_zips(market_id,zip) values($1,'10001')", [
    marketId,
  ]);
  await db.query(
    "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values($1,$2,$3,5)",
    [marketId, locationId, organizationId],
  );
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Synthetic free item')",
    [offerId, organizationId, locationId],
  );
  await db.query(
    `insert into offer_versions(
      offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity
     ) values($1,1,'No purchase required','One free synthetic item',
      'One per admitted synthetic member. No purchase required.',$2,$3,'claim',$4)`,
    [offerId, supplyStart, supplyEnd, count],
  );
  await db.query(
    `insert into network_drop_supplies(
      id,market_id,organization_id,location_id,offer_id,offer_version,state,
      starts_at,expires_at,inventory_policy,quantity,verification_mode,
      staff_instructions,fallback_plan,approved_by,data_kind
     ) values($1,$2,$3,$4,$5,1,'approved',$6,$7,'claim',$8,'staff_tap',
      'Scan the staff QR and hand over the named item.',
      'Use the independently reserved substitute at this counter.',$9,'synthetic')`,
    [
      supplyId,
      marketId,
      organizationId,
      locationId,
      offerId,
      supplyStart,
      supplyEnd,
      count,
      actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_terms(
      supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
      funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values($1,'Synthetic 12 oz drink','SYN-12','12 oz',
      'Current pilot week during posted store hours','primary-tank',$2,$2,'synthetic',$3)`,
    [supplyId, organizationId, actor.id],
  );
  await db.query(
    `insert into pilot_supply_fallbacks(
      id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
      usable_capacity,instructions,payer_organization_id,state,approved_by,created_by
     ) values($1,$2,'Synthetic bottled drink','SYN-BTL','12 oz','sealed-bottle-stock',$3,
      'Hand over one sealed substitute and scan the same staff QR.',$4,'approved',$5,$5)`,
    [fallbackId, supplyId, count, organizationId, actor.id],
  );
  await db.query(
    `insert into destination_readiness(
      supply_id,organization_id,location_id,state,owner_approved_by,
      primary_manager,primary_contact,backup_contact,stock_confirmed_at,
      exact_item_confirmed,staff_instructions_confirmed,shifts_briefed_at,
      valid_hours_confirmed,qr_rehearsed_at,support_escalation,valid_until,updated_by
     ) values($1,$2,$3,'ready',$4,'Synthetic Manager','manager@example.test',
      'backup@example.test',$5,true,true,$5,true,$5,
      'Escalate to the synthetic on-call operator immediately.',$6,$4)`,
    [supplyId, organizationId, locationId, actor.id, readyAt, readyUntil],
  );
  await db.query(
    "insert into redemption_points(id,organization_id,location_id,name,exposure,created_by) values($1,$2,$3,'Synthetic register','staff',$4)",
    [pointId, organizationId, locationId, actor.id],
  );
  await db.query(
    `insert into redemption_credentials(
      id,point_id,public_token,credential_type,version,created_by
     ) values($1,$2,$3,'qr',1,$4)`,
    [credentialId, pointId, pointToken, actor.id],
  );
  await db.query(
    `insert into pilot_runs(
      id,market_id,name,starts_on,ends_on,state,data_kind,target_members,hard_cap,
      operator_owner,support_owner,backup_support_owner,checklist,created_by
     ) values($1,$2,'Synthetic restore rehearsal',$3,$4,'enrolling','synthetic',$5,$5,
      $6,'synthetic-support','synthetic-backup','{"synthetic":true}',$6)`,
    [runId, marketId, window.weekKey, endsOn, count, actor.id],
  );
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,$4,$5)",
    [runId, window.weekKey, supplyId, count, actor.id],
  );
  const members: SyntheticPilotFixture["members"] = [];
  for (let index = 0; index < count; index++) {
    const memberId = `${prefix}-member-${index.toString().padStart(3, "0")}`;
    const customerId = `${prefix}-customer-${index.toString().padStart(3, "0")}`;
    const phone = `+1212${(5560000 + index).toString().padStart(7, "0")}`;
    await db.query("insert into customers(id,phone) values($1,$2)", [
      customerId,
      phone,
    ]);
    await db.query(
      `insert into uptick_members(
        id,customer_id,home_zip,market_id,state,verified_at,data_kind,age_confirmed_at
       ) values($1,$2,'10001',$3,'active',now(),'synthetic',now())`,
      [memberId, customerId, marketId],
    );
    await db.query(
      "insert into pilot_admissions(run_id,member_id,data_kind) values($1,$2,'synthetic')",
      [runId, memberId],
    );
    members.push({ id: memberId, customerId });
  }
  await db.query("update pilot_runs set state='live' where id=$1", [runId]);
  return {
    actor,
    runId,
    marketId,
    supplyId,
    fallbackId,
    pointToken,
    weekKey: window.weekKey,
    members,
  };
}

export async function verifyPilotPostgres(db: DB) {
  const fixture = await seedSyntheticPilot(db);
  const releaseInput = {
    runId: fixture.runId,
    marketId: fixture.marketId,
    weekKey: fixture.weekKey,
    dataKind: "synthetic" as const,
    requestKey: "restore-pilot-release-current-week-v1",
    assignments: fixture.members.map((member) => ({
      memberId: member.id,
      supplyId: fixture.supplyId,
    })),
  };
  const competing = await Promise.all([
    releaseWeeklyBenefits(db, fixture.actor, releaseInput),
    releaseWeeklyBenefits(db, fixture.actor, releaseInput),
  ]);
  assert.equal(competing[0].release.id, competing[1].release.id);
  assert.equal(competing[0].grants.length, 150);
  assert.equal(
    (await supplyUsage(db, fixture.supplyId)).remaining,
    0,
    "The final committed unit must be unavailable to unrelated allocation",
  );
  await assert.rejects(
    adjustSupply(db, fixture.actor, {
      supplyId: fixture.supplyId,
      delta: -1,
      reason: "Attempt to undercut a live synthetic pilot obligation.",
    }),
    /cannot fall below/,
  );

  const first = fixture.members[0];
  const accessToken = token();
  await db.query(
    `insert into member_access(
      id,member_id,token_hash,token_encrypted,purpose,expires_at,confirmed_at,
      disclosure,home_zip,age_attested
     ) values('restore-pilot-access',$1,$2,$3,'access',now()+interval '30 days',now(),
      'Synthetic isolated verification','10001',true)`,
    [first.id, hash(accessToken), encrypt(accessToken)],
  );
  const claims = await Promise.all([
    claimMemberDrop(db, accessToken, fixture.supplyId),
    claimMemberDrop(db, accessToken, fixture.supplyId),
  ]);
  assert.equal(claims[0].id, claims[1].id);
  assert.equal((await supplyUsage(db, fixture.supplyId)).remaining, 0);
  const privatePass = decrypt(claims[0].token_encrypted);
  await redeemAtPoint(db, privatePass, { pointToken: fixture.pointToken });
  const grant = competing[0].grants.find((item) => item.member_id === first.id)!;
  const incidentInput = {
    grantId: grant.id,
    incidentType: "redemption_failure" as const,
    severity: "high" as const,
    occurredAt: new Date().toISOString(),
    owner: "synthetic-support",
    idempotencyKey: "restore-pilot-post-redemption-incident-v1",
  };
  const incidents = await Promise.all([
    reportMemberFulfillmentIncident(db, first.id, incidentInput),
    reportMemberFulfillmentIncident(db, first.id, incidentInput),
  ]);
  assert.equal(incidents[0], incidents[1]);
  const recoveryInput = {
    incidentId: incidents[0],
    remedyType: "same_counter" as const,
    fallbackId: fixture.fallbackId,
    replacementSupplyId: null,
    payerOrganizationId: fixture.actor.organizationId!,
    payerEvidence: "Synthetic prepaid fallback inventory ledger.",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  const recoveries = await Promise.all([
    issueIncidentRecovery(db, fixture.actor, recoveryInput),
    issueIncidentRecovery(db, fixture.actor, recoveryInput),
  ]);
  assert.equal(recoveries[0], recoveries[1]);
  await redeemAtPoint(db, privatePass, { pointToken: fixture.pointToken });
  const [{ claims: claimCount, allocations, recoveries: recoveryCount, evidence }] =
    await db.query<{
      claims: number;
      allocations: number;
      recoveries: number;
      evidence: number;
    }>(
      `select
        (select count(*)::int from claims where id=$1) claims,
        (select count(*)::int from member_allocations where member_id=$2) allocations,
        (select count(*)::int from recovery_grants where original_claim_id=$1) recoveries,
        (select count(*)::int from redemption_evidence where claim_id=$1) evidence`,
      [claims[0].id, first.id],
    );
  assert.deepEqual(
    { claimCount, allocations, recoveryCount, evidence },
    { claimCount: 1, allocations: 1, recoveryCount: 1, evidence: 1 },
  );
  console.log(
    "PASS: 150 synthetic grants publish atomically across competing PostgreSQL sessions; claim and recovery keep one allocation, one claim and original evidence.",
  );
  return fixture;
}
