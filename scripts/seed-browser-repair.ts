/* An isolated synthetic rehearsal that actually exercises the repaired surfaces.

   `seed-browser-rehearsal.ts` creates a minimal pilot: one counter, one week,
   nothing issued. That is the right fixture for a smoke test and the wrong one
   for this pass, because every surface repaired here only differs from the old
   behaviour when there is more than one of something:

   - the command centre's low-supply pin needs a week with stock issued against
     a smaller commitment than the shelf holds;
   - the merchant overview's plural commitments need two counters in one week;
   - the Market Cell readiness proof needs all four weeks planned, one of them
     short, so the shortfall names a specific week;
   - the member Places tab needs a member with a session and a backed counter.

   Everything here is classified `synthetic`, lives in a throwaway database
   under /private/tmp, and sends no messages. It must never be pointed at the
   saved local database or a hosted connection, which the assertions enforce. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDb, type DB } from "../src/lib/db";
import { seed } from "../src/lib/seed";
import { createMemberSession } from "../src/lib/member-session";
import { loadPilotRun, pilotWeeks } from "../src/lib/pilot-operations";
import { releaseWeeklyBenefits } from "../src/lib/pilot-promise";
import { encrypt, hash, id, token } from "../src/lib/security";
import { MEMBERSHIP_DISCLOSURE } from "../src/lib/network";
import {
  seedSyntheticPilot,
  type SyntheticPilotFixture,
} from "./verify-postgres-pilot";

assert.ok(
  process.env.LOCAL_DATABASE_PATH?.startsWith(
    "/private/tmp/uptick-browser-rehearsal-",
  ),
  "Point LOCAL_DATABASE_PATH at a throwaway /private/tmp/uptick-browser-rehearsal-* directory.",
);
assert.equal(process.env.DATABASE_URL, undefined);

/** Another fully eligible counter for this merchant, backing one week.
    Mirrors the eligibility chain pilotCapacity checks; a supply missing any of
    it contributes nothing and the rehearsal would show an empty surface. */
async function addCounter(
  db: DB,
  fixture: SyntheticPilotFixture,
  options: {
    supplyId: string;
    item: string;
    quantity: number;
    weekKey: string;
    address?: string;
  },
) {
  const [source] = await db.query<{
    organization_id: string;
    location_id: string;
    starts_at: string;
    expires_at: string;
  }>(
    "select organization_id,location_id,starts_at,expires_at from network_drop_supplies where id=$1",
    [fixture.supplyId],
  );
  const org = source.organization_id;
  let location = source.location_id;
  if (options.address) {
    location = `${options.supplyId}-location`;
    await db.query(
      "insert into locations(id,organization_id,name,address,postal_code) values($1,$2,$3,$4,'10001')",
      [location, org, `${options.item} counter`, options.address],
    );
    await db.query(
      "insert into market_locations(market_id,location_id,organization_id,drive_minutes) values($1,$2,$3,9)",
      [fixture.marketId, location, org],
    );
    await db.query(
      "insert into redemption_points(id,organization_id,location_id,name,exposure,created_by) values($1,$2,$3,'Second register','staff',$4)",
      [`${options.supplyId}-point`, org, location, fixture.actor.id],
    );
    await db.query(
      "insert into redemption_credentials(id,point_id,public_token,credential_type,version,created_by) values($1,$2,$3,'qr',1,$4)",
      [
        `${options.supplyId}-qr`,
        `${options.supplyId}-point`,
        id(),
        fixture.actor.id,
      ],
    );
  }
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live',$4)",
    [options.supplyId, org, location, options.item],
  );
  await db.query(
    `insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity)
     values($1,1,'No purchase required',$2,'One per admitted synthetic member.',$3,$4,'claim',$5)`,
    [
      options.supplyId,
      `One free ${options.item}`,
      source.starts_at,
      source.expires_at,
      options.quantity,
    ],
  );
  await db.query(
    `insert into network_drop_supplies(
       id,market_id,organization_id,location_id,offer_id,offer_version,state,
       starts_at,expires_at,inventory_policy,quantity,verification_mode,
       staff_instructions,fallback_plan,approved_by,data_kind
     ) values($1,$2,$3,$4,$1,1,'approved',$5,$6,'claim',$7,'staff_tap',
      'Scan the staff QR and hand over the named item.',
      'Use the independently reserved substitute at this counter.',$8,'synthetic')`,
    [
      options.supplyId,
      fixture.marketId,
      org,
      location,
      source.starts_at,
      source.expires_at,
      options.quantity,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_terms(
       supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
       funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values($1,$2,$3,'16 oz','Current pilot week during posted store hours',$4,$5,$5,'synthetic',$6)`,
    [
      options.supplyId,
      options.item,
      `${options.supplyId}-sku`,
      `${options.supplyId}-stock`,
      org,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into pilot_supply_fallbacks(
       id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
       usable_capacity,instructions,payer_organization_id,state,approved_by,created_by
     ) values($1||'-fallback',$1,$2,$1||'-btl','16 oz',$1||'-sealed',$3,
      'Hand over one sealed substitute and scan the same staff QR.',$4,'approved',$5,$5)`,
    [
      options.supplyId,
      `Sealed ${options.item}`,
      options.quantity,
      org,
      fixture.actor.id,
    ],
  );
  await db.query(
    `insert into destination_readiness(
       supply_id,organization_id,location_id,state,owner_approved_by,
       primary_manager,primary_contact,backup_contact,stock_confirmed_at,
       exact_item_confirmed,staff_instructions_confirmed,shifts_briefed_at,
       valid_hours_confirmed,qr_rehearsed_at,support_escalation,valid_until,updated_by
     ) values($1,$2,$3,'ready',$4,'Synthetic Manager','manager@example.test',
      'backup@example.test',now()-interval '1 minute',true,true,now()-interval '1 minute',
      true,now()-interval '1 minute',
      'Escalate to the synthetic on-call operator immediately.',$5::date+interval '8 days',$4)`,
    [
      options.supplyId,
      org,
      location,
      fixture.actor.id,
      options.weekKey,
    ],
  );
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,$4,$5)",
    [
      fixture.runId,
      options.weekKey,
      options.supplyId,
      options.quantity,
      fixture.actor.id,
    ],
  );
}

const db = await getDb();
try {
  await seed(db);
  const fixture = await seedSyntheticPilot(db, 20, "browser-repair");
  const run = await loadPilotRun(db, fixture.runId);
  const weeks = pilotWeeks(run);

  /* Week one: a second counter, so the merchant owes two things in one week
     and the plural commitment list has something to show. */
  await addCounter(db, fixture, {
    supplyId: "browser-repair-second",
    item: "Synthetic pastry",
    quantity: 20,
    weekKey: weeks[0],
    address: "2 Second Way",
  });

  /* Weeks two to four planned, with week three deliberately thin so the
     readiness proof names a real week rather than an empty one. */
  await addCounter(db, fixture, {
    supplyId: "browser-repair-week-2",
    item: "Synthetic 12 oz drink",
    quantity: 20,
    weekKey: weeks[1],
  });
  await addCounter(db, fixture, {
    supplyId: "browser-repair-week-3",
    item: "Synthetic 12 oz drink",
    quantity: 14,
    weekKey: weeks[2],
  });
  await addCounter(db, fixture, {
    supplyId: "browser-repair-week-4",
    item: "Synthetic 12 oz drink",
    quantity: 20,
    weekKey: weeks[3],
  });

  /* A full shelf behind a small commitment. This is the exact case the command
     centre used to report as "80 units remain" when 2 were left to give. */
  await db.query(
    "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values($1,$2,80,'Synthetic restock ahead of the rehearsal.',$3)",
    [id(), fixture.supplyId, fixture.actor.id],
  );

  /* Week one released, with eighteen of the twenty members sent to the first
     counter. That counter holds 100 on the shelf against a commitment of 20:
     the old command centre reported "82 units remain", the repaired one reports
     the 2 that are actually left to give. */
  await releaseWeeklyBenefits(db, fixture.actor, {
    runId: fixture.runId,
    marketId: fixture.marketId,
    weekKey: weeks[0],
    dataKind: "synthetic",
    requestKey: "browser-repair-week-one",
    /* The planner spreads members across both counters; this rehearsal wants
       them concentrated on the first one so the low-supply state is real. */
    overrideReason:
      "Synthetic rehearsal: concentrate week one on the first counter so the low-supply state can be inspected.",
    assignments: fixture.members.map((member, index) => ({
      memberId: member.id,
      supplyId: index < 18 ? fixture.supplyId : "browser-repair-second",
    })),
  });

  /* The local merchant and operator logins see this pilot's organization, so
     the browser rehearsal does not need a separate sign-in path. */
  const [supply] = await db.query<{ organization_id: string }>(
    "select organization_id from network_drop_supplies where id=$1",
    [fixture.supplyId],
  );
  await db.query(
    `insert into memberships(user_id,organization_id,role,can_export)
     values('local-merchant',$1,'merchant',true),('local-operator',$1,'operator',true)
     on conflict do nothing`,
    [supply.organization_id],
  );

  /* A session alone is not enough: memberAccess resolves the session back to a
     confirmed private link, so the rehearsal member needs one. */
  const [rehearsalMember] = await db.query<{ home_zip: string }>(
    "select home_zip from uptick_members where id=$1",
    [fixture.members[0].id],
  );
  const accessId = id();
  const accessToken = token();
  await db.query(
    `insert into member_access(
       id,member_id,token_hash,token_encrypted,purpose,expires_at,
       age_attested,disclosure,home_zip,confirmed_at
     ) values($1,$2,$3,$4,'access',now()+interval '30 days',true,$5,$6,now())`,
    [
      accessId,
      fixture.members[0].id,
      hash(accessToken),
      encrypt(accessToken),
      MEMBERSHIP_DISCLOSURE,
      rehearsalMember.home_zip,
    ],
  );
  const member = await createMemberSession(db, fixture.members[0].id, accessId);
  const file = resolve(
    process.env.LOCAL_DATABASE_PATH!,
    "browser-fixture.json",
  );
  await writeFile(
    file,
    JSON.stringify({ ...fixture, memberSession: member.credential }),
    { mode: 0o600 },
  );
  console.log(
    [
      "Isolated synthetic browser rehearsal ready. No real SMS, no hosted connection.",
      `  run            ${fixture.runId} (${weeks.join(", ")})`,
      `  merchant org   ${supply.organization_id} (two counters in week 1)`,
      `  week 3         14 committed against a 20-member cohort`,
      `  member cookie  uptick-member-access=${member.credential}`,
      `  fixture        ${file}`,
    ].join("\n"),
  );
} finally {
  await db.close?.();
}
