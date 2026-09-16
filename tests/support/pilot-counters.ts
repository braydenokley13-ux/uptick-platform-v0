/* Building another fully eligible counter for a pilot week.

   `pilot_week_supplies.supply_id` is unique, so a commitment belongs to exactly
   one week: any week beyond the fixture's first is a different supply. That
   supply has to satisfy the whole eligibility chain `pilotCapacity` checks —
   approved state, free terms, a same-organization fulfiller, dates covering the
   week, a rehearsed destination still in date at the end of that week, an
   approved fallback on a different dependency, a staff QR credential and an
   active market location — or it contributes nothing and a test built on it
   proves nothing. */
import type { DB } from "../../src/lib/db";
import type { SyntheticPilotFixture } from "../../scripts/verify-postgres-pilot";

export async function addEligibleCounter(
  db: DB,
  fixture: SyntheticPilotFixture,
  supplyId: string,
  quantity: number,
  weekKey: string,
) {
  const [source] = await db.query<{
    organization_id: string;
    location_id: string;
    starts_at: string;
    expires_at: string;
  }>(
    `select s.organization_id,s.location_id,s.starts_at,s.expires_at
       from network_drop_supplies s where s.id=$1`,
    [fixture.supplyId],
  );
  const org = source.organization_id;
  const loc = source.location_id;
  const actor = fixture.actor.id;
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'drop','live','Synthetic second item')",
    [supplyId, org, loc],
  );
  await db.query(
    `insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity)
     values($1,1,'No purchase required','One free synthetic item','One per admitted synthetic member.',$2,$3,'claim',$4)`,
    [supplyId, source.starts_at, source.expires_at, quantity],
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
      supplyId,
      fixture.marketId,
      org,
      loc,
      source.starts_at,
      source.expires_at,
      quantity,
      actor,
    ],
  );
  await db.query(
    `insert into pilot_supply_terms(
       supply_id,exact_item,item_sku,size_label,usable_hours,dependency_key,
       funder_organization_id,fulfiller_organization_id,data_kind,created_by
     ) values($1,'Synthetic 12 oz drink','SYN-12','12 oz',
      'Current pilot week during posted store hours','primary-tank',$2,$2,'synthetic',$3)`,
    [supplyId, org, actor],
  );
  await db.query(
    `insert into pilot_supply_fallbacks(
       id,supply_id,substitute_item,substitute_sku,size_label,dependency_key,
       usable_capacity,instructions,payer_organization_id,state,approved_by,created_by
     ) values($1||'-fallback',$1,'Synthetic bottled drink','SYN-BTL','12 oz','sealed-bottle-stock',$2,
      'Hand over one sealed substitute and scan the same staff QR.',$3,'approved',$4,$4)`,
    [supplyId, quantity, org, actor],
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
    [supplyId, org, loc, actor, weekKey],
  );
  await db.query(
    "insert into pilot_week_supplies(run_id,week_key,supply_id,committed_quantity,confirmed_by) values($1,$2,$3,$4,$5)",
    [fixture.runId, weekKey, supplyId, quantity, actor],
  );
}
