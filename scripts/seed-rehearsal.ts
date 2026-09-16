/* Local rehearsal fixture.
   Builds a realistic, populated four-week pilot in the illustrative River
   Neighborhood Market Cell so operator, merchant and member surfaces can be
   designed and visually verified against genuine density rather than an empty
   database. Every lifecycle step below calls the same domain function the UI
   calls, so the fixture also exercises real admission, release, redemption,
   incident and recovery logic. Setup rows the network seed deliberately leaves
   for the operator (pilot terms, fallback, destination readiness) are inserted
   directly because this is a development fixture, not a product path.

   Local storage only. Refuses to run against any hosted connection. */
import { getDb } from "../src/lib/db";
import {
  assertLocalSeedEnvironment,
  assertNoRealPilotData,
} from "../src/lib/seed-safety";
import {
  createPilotRun,
  commitPilotSupply,
  admitPilotMember,
  setPilotState,
  pilotWeeks,
  loadPilotRun,
  savePartnerCommitment,
} from "../src/lib/pilot-operations";
import {
  releaseWeeklyBenefits,
  reportFulfillmentIncident,
  issueIncidentRecovery,
} from "../src/lib/pilot-promise";
import { recommendPilotAssignments } from "../src/lib/pilot-assignment";
import {
  requestMemberAccess,
  exchangeMemberAccess,
} from "../src/lib/membership-identity";
import { claimMemberDrop } from "../src/lib/network";
import { decrypt } from "../src/lib/security";
import { redeemAtPoint } from "../src/lib/tap";
import { marketWeekWindow } from "../src/lib/network";
import type { Actor } from "../src/lib/domain";
import type { DB } from "../src/lib/db";

try {
  process.loadEnvFile(".env.local");
} catch {}
assertLocalSeedEnvironment();

const db = await getDb();
await assertNoRealPilotData(db);

const actor: Actor = {
  id: "local-operator",
  role: "operator",
  organizationId: "uptick",
  canExport: true,
};
const MARKET = "sample-river-market";
const TZ = "America/New_York";

const [existing] = await db.query<{ id: string }>(
  "select id from pilot_runs where market_id=$1 and state<>'complete'",
  [MARKET],
);
if (existing) {
  console.log(
    `Rehearsal pilot already present (${existing.id}). Nothing changed.`,
  );
  process.exit(0);
}

/* --- 1. Complete the operator-owned supply contract on the seeded supplies --- */
const supplies = await db.query<{
  id: string;
  organization_id: string;
  location_id: string;
  quantity: number;
  expires_at: string;
}>(
  "select id,organization_id,location_id,quantity,expires_at from network_drop_supplies where market_id=$1 order by id",
  [MARKET],
);
const item: Record<string, [string, string, string]> = {
  joes: ["Fresh brewed coffee", "JOE-COF-12", "Any size"],
  second: ["Fresh brewed coffee", "NOR-COF-12", "Any size"],
};
const soon = new Date(Date.now() + 40 * 86400000).toISOString();
const justNow = new Date(Date.now() - 3600_000).toISOString();
for (const s of supplies) {
  const [exact, sku, size] = item[s.organization_id] ?? [
    "Fresh brewed coffee",
    "COF-12",
    "Any size",
  ];
  await db.query(
    `insert into pilot_supply_terms(supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,funder_organization_id,fulfiller_organization_id,data_kind,created_by)
     values($1,$2,$3,$4,'Open to close during the current pilot week','brewed-coffee-urn',$5,$5,'internal','local-operator') on conflict do nothing`,
    [s.id, exact, sku, size, s.organization_id],
  );
  await db.query(
    `insert into pilot_supply_fallbacks(id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,usable_capacity,instructions,payer_organization_id,state,approved_by,created_by)
     values($1,$2,'Bottled water','BTL-WTR-16','16.9 oz','sealed-bottle-stock',120,'Hand over one sealed bottled water and scan the same staff QR.',$3,'approved','local-operator','local-operator') on conflict do nothing`,
    [`fb-${s.id}`, s.id, s.organization_id],
  );
  await db.query(
    `insert into destination_readiness(supply_id,organization_id,location_id,state,owner_approved_by,primary_manager,primary_contact,backup_contact,stock_confirmed_at,exact_item_confirmed,staff_instructions_confirmed,shifts_briefed_at,valid_hours_confirmed,qr_rehearsed_at,support_escalation,valid_until,updated_by)
     values($1,$2,$3,'ready','Store owner','Dana Whitfield','+15555550142','+15555550143',$4,true,true,$4,true,$4,'Call the Uptick operator line, then the store owner.',$5,'local-operator') on conflict(supply_id) do nothing`,
    [s.id, s.organization_id, s.location_id, justNow, soon],
  );
}
console.log(`Completed pilot promise on ${supplies.length} supplies.`);

/* --- 2. Create the run and back all four weeks --- */
const window = marketWeekWindow(new Date(), TZ);
const runId = await createPilotRun(db, actor, {
  marketId: MARKET,
  name: "River Neighborhood — four-week pilot",
  startsOn: window.weekKey,
  dataKind: "internal",
  targetMembers: 60,
  hardCap: 80,
  paidLoadGuidance: 0.6,
  operatorOwner: "Brayden Okley",
  supportOwner: "Brayden Okley",
  backupSupportOwner: "Dana Whitfield",
  budget: "1200.00",
});
const run = await loadPilotRun(db, runId);
const weeks = pilotWeeks(run);
// Back every week at both destinations so the week has a real choice of
// counters, which is what makes assignment suitability meaningful.
for (const week of weeks)
  for (const supply of supplies.filter((s) => s.id.endsWith(week)))
    await commitPilotSupply(db, actor, {
      runId,
      weekKey: week,
      supplyId: supply.id,
      quantity: 100,
    }).catch((e: Error) =>
      console.log(`  commit ${supply.id}:`, e.message.slice(0, 90)),
    );
console.log(
  `Created run ${runId} and committed supply for weeks ${weeks.join(", ")}.`,
);

/* --- 2b. Accountable partner distribution --- */
for (const [partnerId, sourceId, channel, owner, population] of [
  [
    "river-house",
    "river-house-membership",
    "resident_email",
    "Brayden Okley",
    320,
  ],
  [
    "main-carwash",
    "main-carwash-membership",
    "lobby_card",
    "Dana Whitfield",
    140,
  ],
  [
    "north-office",
    "north-office-membership",
    "newsletter",
    "Brayden Okley",
    210,
  ],
] as const)
  await savePartnerCommitment(db, actor, {
    runId,
    partnerId,
    sourceId,
    channel,
    plannedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    owner,
    intendedPopulation: population,
  }).catch((e: Error) =>
    console.log(`  partner ${partnerId}:`, e.message.slice(0, 90)),
  );

/* --- 2c. Open admissions --- */
const checklist: Record<string, boolean> = {
  ownerAgreements: true,
  staffRehearsal: true,
  recoveryFunded: true,
  supportCoverage: true,
  partnerDistribution: true,
  privacyIdentity: true,
  releaseVerified: true,
};
await setPilotState(db, actor, { runId, state: "enrolling", checklist }).catch(
  (e: Error) => console.log("  state->enrolling:", e.message),
);

/* --- 3. Real members through the actual join path --- */
const credentials: string[] = [];
const memberCredential = new Map<string, string>();
for (let i = 0; i < 64; i++) {
  const phone = `+1914555${String(1000 + i).padStart(4, "0")}`;
  const requested = await requestMemberAccess(db, {
    phone,
    homeZip: "10583",
    consentRequested: i % 3 === 0,
    ageAttested: true,
  });
  const { credential, member } = requested as {
    credential?: string;
    member?: { id: string };
  };
  if (!credential) continue;
  await exchangeMemberAccess(db, credential, i % 3 === 0);
  credentials.push(credential);
  if (member?.id) memberCredential.set(member.id, credential);
}
console.log(`Confirmed ${credentials.length} members through the join path.`);

const members = await db.query<{ id: string }>(
  "select id from uptick_members where market_id=$1 and verified_at is not null order by created_at",
  [MARKET],
);
let admitted = 0;
for (const m of members) {
  const result = await admitPilotMember(db, actor, { memberId: m.id }).catch(
    () => null,
  );
  if (result && (result as { state?: string }).state !== "waitlisted")
    admitted++;
}
console.log(`Admitted ${admitted} of ${members.length} verified members.`);

/* --- 4. Go live and release the current week --- */
await setPilotState(db, actor, { runId, state: "live", checklist }).catch(
  (e: Error) => console.log("  state->live:", e.message),
);
// The same two-step the operator UI performs: recommend, review, then release.
const plan = await recommendPilotAssignments(db, runId, weeks[0]);
console.log(
  `Recommended ${plan.assignments.length} assignments across ${plan.destinations.length} destinations.`,
);
await releaseWeeklyBenefits(db, actor, {
  runId,
  marketId: MARKET,
  weekKey: weeks[0],
  dataKind: "internal",
  requestKey: `rehearsal-${runId}-${weeks[0]}`,
  recommendationFingerprint: plan.fingerprint,
  assignments: plan.assignments.map((a) => ({
    memberId: a.memberId,
    supplyId: a.supplyId,
  })),
}).catch((e: Error) => console.log("  release:", e.message));

const grants = await db.query<{ id: string; member_id: string }>(
  "select g.id,g.member_id from fulfillment_grants g join weekly_releases r on r.id=g.release_id where r.run_id=$1 order by g.id",
  [runId],
);
console.log(`Released ${grants.length} backed grants for ${weeks[0]}.`);

/* --- 5. A believable spread of outcomes ----------------------------------
   Members claim their pass and a realistic share redeem it at the staffed
   counter. Both steps go through the real claim and Tap redemption paths, so
   inventory, reservations and evidence behave exactly as they will in the
   pilot. One destination then goes dark to exercise outage routing. */
const [point] = await db.query<{ public_token: string; location_id: string }>(
  "select rc.public_token,rp.location_id from redemption_credentials rc join redemption_points rp on rp.id=rc.point_id where rc.state='active' and rp.organization_id='joes' limit 1",
);
const assigned = await db.query<{ member_id: string; supply_id: string }>(
  "select g.member_id,g.supply_id from fulfillment_grants g join weekly_releases r on r.id=g.release_id where r.run_id=$1 order by g.member_id",
  [runId],
);
let claimed = 0,
  redeemed = 0;
for (const [index, row] of assigned.entries()) {
  const credential = memberCredential.get(row.member_id);
  if (!credential) continue;
  // ~78% claim the pass; of those, ~72% are redeemed in store this week.
  if (index % 9 === 8) continue;
  const claim = await claimMemberDrop(db, credential, row.supply_id).catch(
    () => null,
  );
  if (!claim) continue;
  claimed++;
  const encrypted = (claim as { token_encrypted?: string }).token_encrypted;
  if (!encrypted || index % 5 >= 3 || !point) continue;
  const privateToken = decrypt(encrypted);
  const done = await redeemAtPoint(db, privateToken, {
    pointToken: point.public_token,
  }).catch(() => null);
  if (done) redeemed++;
}
console.log(
  `Members claimed ${claimed} passes; ${redeemed} redeemed at the counter.`,
);

/* Two members hit a real stockout: one is recovered with the approved
   same-counter substitute, one is left open so the operator queue is not empty. */
const unredeemed = await db.query<{ id: string }>(
  "select g.id from fulfillment_grants g join weekly_releases r on r.id=g.release_id where r.run_id=$1 and g.state<>'redeemed' order by g.id limit 2",
  [runId],
);
for (const [n, grant] of unredeemed.entries()) {
  const incidentId = await reportFulfillmentIncident(db, actor, {
    grantId: grant.id,
    incidentType: "out_of_stock",
    severity: "medium",
    occurredAt: new Date(Date.now() - (n + 1) * 5400_000).toISOString(),
    owner: "Dana Whitfield",
    note: "Coffee urn ran dry before the afternoon shift changeover.",
    idempotencyKey: `rehearsal-incident-${grant.id}`,
  }).catch((e: Error) => {
    console.log("  incident:", e.message.slice(0, 90));
    return null;
  });
  if (!incidentId || n > 0) continue;
  const id =
    typeof incidentId === "string"
      ? incidentId
      : (incidentId as { id?: string }).id;
  const [fallback] = await db.query<{ id: string; supply_id: string }>(
    "select f.id,f.supply_id from pilot_supply_fallbacks f join fulfillment_grants g on g.supply_id=f.supply_id where g.id=$1",
    [grant.id],
  );
  if (!id || !fallback) continue;
  await issueIncidentRecovery(db, actor, {
    incidentId: id,
    remedyType: "same_counter",
    fallbackId: fallback.id,
    payerOrganizationId: "joes",
    payerEvidence: "Store owner agreed to cover the substitute for this week.",
    expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
  }).catch((e: Error) => console.log("  recovery:", e.message.slice(0, 110)));
}
console.log(
  `Recorded ${unredeemed.length} fulfillment incident(s) with one backed recovery.`,
);

const second = supplies.find((s) => s.organization_id === "second");
if (second)
  await db
    .query(
      "insert into location_outages(id,location_id,reason,owner,opened_by,request_key) values($1,$2,'Espresso machine failure reported by the store owner.','Dana Whitfield','local-operator',$3) on conflict do nothing",
      [
        `outage-${second.location_id}`,
        second.location_id,
        `rehearsal-outage-${second.location_id}`,
      ],
    )
    .catch((e: Error) => console.log("  outage:", e.message.slice(0, 90)));

console.log(
  "\nRehearsal fixture ready. Local storage only; no real data, no SMS.",
);
await (db as DB).close?.();
process.exit(0);
