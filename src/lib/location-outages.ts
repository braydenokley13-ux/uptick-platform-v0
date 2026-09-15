import { z } from "zod";
import type { DB } from "./db";
import { audit, type Actor } from "./domain";
import { RequestError } from "./http";
import { id } from "./security";

export async function locationAvailable(db: DB, locationId: string) {
  const [row] = await db.query<{ available: boolean }>(
    "select exists(select 1 from market_locations where location_id=$1 and active) and not exists(select 1 from location_outages where location_id=$1 and closed_at is null) available",
    [locationId],
  );
  return row.available;
}
export async function assertLocationAvailable(db: DB, locationId: string) {
  if (!(await locationAvailable(db, locationId)))
    throw new RequestError(
      "This destination is unavailable. Uptick support will help with your existing benefit; please do not travel there.",
      409,
    );
}
export async function openLocationOutage(db: DB, actor: Actor, raw: unknown) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  const input = z
    .object({
      locationId: z.string().min(1),
      reason: z.string().trim().min(10).max(1500),
      owner: z.string().trim().min(1).max(200),
      requestKey: z.string().min(8).max(200),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const [existing] = await tx.query<{
      id: string;
      location_id: string;
      reason: string;
      owner: string;
    }>("select * from location_outages where request_key=$1", [
      input.requestKey,
    ]);
    if (existing) {
      if (
        existing.location_id !== input.locationId ||
        existing.reason !== input.reason ||
        existing.owner !== input.owner
      )
        throw new RequestError(
          "This outage request was already used for different details.",
        );
      return existing.id;
    }
    const [location] = await tx.query<{ organization_id: string }>(
      "select organization_id from locations where id=$1 for update",
      [input.locationId],
    );
    if (!location)
      throw new RequestError("Choose an existing destination.", 404);
    const [open] = await tx.query(
      "select id from location_outages where location_id=$1 and closed_at is null",
      [input.locationId],
    );
    if (open)
      throw new RequestError("This destination already has an open outage.");
    await tx.query(
      "select id from network_drop_supplies where location_id=$1 order by id for update",
      [input.locationId],
    );
    const outageId = id();
    await tx.query(
      "insert into location_outages(id,location_id,reason,owner,opened_by,request_key) values($1,$2,$3,$4,$5,$6)",
      [
        outageId,
        input.locationId,
        input.reason,
        input.owner,
        actor.id,
        input.requestKey,
      ],
    );
    await tx.query(
      "update market_locations set active=false where location_id=$1",
      [input.locationId],
    );
    await tx.query(
      "update network_drop_supplies set state='paused' where location_id=$1 and state='approved'",
      [input.locationId],
    );
    await tx.query(
      "update destination_readiness set state='suspended',updated_at=now() where supply_id in(select id from network_drop_supplies where location_id=$1)",
      [input.locationId],
    );
    // Queue affected promises for human recovery review. Digital use may have
    // happened without physical handoff, so a queue row is not a failure claim.
    await tx.query(
      `insert into location_outage_obligations(outage_id,grant_id)
      select $1,g.id from fulfillment_grants g where (g.location_id=$2 and g.expires_at>now()) or exists(
       select 1 from recovery_grants r where r.original_grant_id=g.id and r.target_location_id=$2 and r.superseded_at is null and r.expires_at>now())`,
      [outageId, input.locationId],
    );
    await audit(
      tx,
      actor.id,
      location.organization_id,
      "location_outage_opened",
      outageId,
      input,
    );
    return outageId;
  });
}
export async function closeLocationOutage(db: DB, actor: Actor, raw: unknown) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  const input = z
    .object({
      outageId: z.string().min(1),
      evidence: z.string().trim().min(10).max(1500),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const [outage] = await tx.query<{
      location_id: string;
      closed_at: string | null;
    }>("select * from location_outages where id=$1 for update", [
      input.outageId,
    ]);
    if (!outage) throw new RequestError("Choose an existing outage.", 404);
    if (outage.closed_at)
      throw new RequestError("This outage is already closed.");
    await tx.query(
      "update location_outages set closed_at=now(),closed_by=$2,resolution_evidence=$3 where id=$1",
      [input.outageId, actor.id, input.evidence],
    );
    // Closing the incident never silently reapproves stale stock or staff evidence.
    await audit(
      tx,
      actor.id,
      actor.organizationId,
      "location_outage_closed",
      input.outageId,
      input,
    );
    return input.outageId;
  });
}
