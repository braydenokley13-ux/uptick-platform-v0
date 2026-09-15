import { createHash } from "node:crypto";
import { z } from "zod";
import type { DB } from "./db";
import { audit, type Actor } from "./domain";
import { RequestError } from "./http";
import { id } from "./security";
import { operationalPilotAudience } from "./member-service";
import { pilotCapacity, loadPilotRun, pilotWeeks } from "./pilot-operations";

export type AssignmentReason = {
  suitable: boolean;
  unknownSuitability: boolean;
  explanation: string;
  homeZipMatch: boolean;
  workZipMatch: boolean;
  driveMinutes: number | null;
  recentDestinationCount: number;
  acquisitionPartner: string | null;
  reviewId: string | null;
  policyId: string | null;
  rotationKey: string;
};
type Candidate = { supplyId: string; reason: AssignmentReason; cost: number };
export type AssignmentPlan = {
  fingerprint: string;
  runId: string;
  weekKey: string;
  admitted: number;
  excluded: number;
  members: { memberId: string; reference: string; candidates: Candidate[] }[];
  assignments: {
    memberId: string;
    supplyId: string;
    reason: AssignmentReason;
  }[];
  destinations: {
    supplyId: string;
    label: string;
    capacity: number;
    fallbackAvailable: number;
    paid: boolean;
    assigned: number;
    repeatedExposure: number;
    unknownSuitability: number;
    hours: string;
  }[];
  unassigned: string[];
  policy: {
    id: string;
    all_destinations_fit: boolean;
    max_drive_minutes: number;
    evidence: string;
  } | null;
};
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Successive shortest augmenting paths: find a complete capacity-safe matching,
// including cases where an earlier flexible member must move for a less flexible one.
export function matchPilotDestinations(
  members: { memberId: string; candidates: Candidate[] }[],
  destinations: {
    supplyId: string;
    capacity: number;
    groupId?: string | null;
    groupCapacity?: number | null;
  }[],
) {
  type Edge = { to: number; rev: number; capacity: number; cost: number };
  const groups = [
    ...new Set(destinations.flatMap((d) => (d.groupId ? [d.groupId] : []))),
  ];
  const groupStart = members.length + destinations.length + 1;
  const sink = groupStart + groups.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const edge = (from: number, to: number, capacity: number, cost: number) => {
    graph[from].push({ to, rev: graph[to].length, capacity, cost });
    graph[to].push({
      to: from,
      rev: graph[from].length - 1,
      capacity: 0,
      cost: -cost,
    });
  };
  members.forEach((member, index) => {
    edge(0, index + 1, 1, 0);
    for (const candidate of member.candidates.filter(
      (c) => c.reason.suitable,
    )) {
      const destination = destinations.findIndex(
        (d) => d.supplyId === candidate.supplyId,
      );
      if (destination >= 0)
        edge(index + 1, members.length + 1 + destination, 1, candidate.cost);
    }
  });
  destinations.forEach((destination, index) =>
    edge(
      members.length + 1 + index,
      destination.groupId
        ? groupStart + groups.indexOf(destination.groupId)
        : sink,
      destination.capacity,
      0,
    ),
  );
  groups.forEach((group, index) =>
    edge(
      groupStart + index,
      sink,
      Math.min(
        ...destinations
          .filter((d) => d.groupId === group)
          .map((d) => d.groupCapacity ?? 0),
      ),
      0,
    ),
  );
  for (;;) {
    const distance = Array(graph.length).fill(Infinity) as number[];
    const previous: [number, number][] = Array(graph.length);
    const queue = [0],
      queued = new Set([0]);
    distance[0] = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const from = queue[cursor];
      queued.delete(from);
      graph[from].forEach((link, index) => {
        if (
          link.capacity > 0 &&
          distance[from] + link.cost < distance[link.to]
        ) {
          distance[link.to] = distance[from] + link.cost;
          previous[link.to] = [from, index];
          if (!queued.has(link.to)) {
            queue.push(link.to);
            queued.add(link.to);
          }
        }
      });
    }
    if (!Number.isFinite(distance[sink])) break;
    for (let to = sink; to !== 0;) {
      const [from, index] = previous[to],
        link = graph[from][index];
      link.capacity--;
      graph[to][link.rev].capacity++;
      to = from;
    }
  }
  return members.flatMap((member, index) => {
    const used = graph[index + 1].find(
      (link) =>
        link.to > members.length && link.to < groupStart && link.capacity === 0,
    );
    if (!used) return [];
    const supplyId = destinations[used.to - members.length - 1].supplyId;
    return [
      {
        memberId: member.memberId,
        supplyId,
        reason: member.candidates.find((c) => c.supplyId === supplyId)!.reason,
      },
    ];
  });
}

export async function recommendPilotAssignments(
  db: DB,
  runId: string,
  weekKey: string,
): Promise<AssignmentPlan> {
  const run = await loadPilotRun(db, runId);
  if (!pilotWeeks(run).includes(weekKey))
    throw new RequestError("Choose one of this pilot's four weeks.");
  const audience = await operationalPilotAudience(db, runId);
  const [policy] = await db.query<NonNullable<AssignmentPlan["policy"]>>(
    "select * from pilot_assignment_policies where run_id=$1 order by sequence desc limit 1",
    [runId],
  );
  const capacity = await pilotCapacity(db, run);
  const supplies = await db.query<{
    id: string;
    label: string;
    location_id: string;
    postal_code: string | null;
    drive_minutes: number | null;
    active: boolean;
    hours: string;
    fallback_available: number;
    paid: boolean;
  }>(
    `select s.id,o.name||' — '||t.exact_item label,s.location_id,l.postal_code,ml.drive_minutes,
     (ml.active and not exists(select 1 from location_outages outage where outage.location_id=s.location_id and outage.closed_at is null) and d.state='ready' and d.stock_confirmed_at<=now() and d.stock_confirmed_at>now()-interval '72 hours' and d.valid_until>now()) active,t.usable_hours hours,
     greatest(0,f.usable_capacity-(select count(*) from recovery_grants r where r.fallback_id=f.id and (r.state='redeemed' or (r.state='issued' and r.superseded_at is null and r.expires_at>now()))))::int fallback_available,
     exists(select 1 from program_supply_links pl where pl.supply_id=s.id) paid
     from effective_pilot_week_supplies p join network_drop_supplies s on s.id=p.supply_id
     join organizations o on o.id=s.organization_id join locations l on l.id=s.location_id
     join market_locations ml on ml.market_id=s.market_id and ml.location_id=s.location_id
     join pilot_supply_terms t on t.supply_id=s.id join pilot_supply_fallbacks f on f.supply_id=s.id
     join destination_readiness d on d.supply_id=s.id
     where p.run_id=$1 and p.week_key=$2 order by s.id`,
    [runId, weekKey],
  );
  const profiles = await db.query<{
    id: string;
    home_zip: string;
    work_zip: string | null;
    partner: string | null;
    in_market: boolean;
  }>(
    `select m.id,m.home_zip,m.work_zip,ap.name partner,
     exists(select 1 from market_zips z where z.market_id=$2 and z.zip in(m.home_zip,m.work_zip)) in_market
     from uptick_members m left join acquisition_sources a on a.id=m.source_id left join acquisition_partners ap on ap.id=a.partner_id
     where m.id=any($1::text[]) order by m.id`,
    [audience.included.map((m) => m.member_id), run.market_id],
  );
  const reviews = await db.query<{
    id: string;
    member_id: string;
    location_id: string;
    suitable: boolean;
    drive_minutes: number | null;
    evidence: string;
  }>(
    "select distinct on(member_id,location_id) * from member_destination_reviews where member_id=any($1::text[]) order by member_id,location_id,sequence desc",
    [profiles.map((m) => m.id)],
  );
  const history = await db.query<{
    member_id: string;
    location_id: string;
    count: number;
  }>(
    "select member_id,location_id,count(*)::int count from fulfillment_grants where member_id=any($1::text[]) and week_key<$2 and week_key>=($2::date-28)::text group by member_id,location_id",
    [profiles.map((m) => m.id), weekKey],
  );
  const destinations = supplies.map((supply) => ({
    supplyId: supply.id,
    label: supply.label,
    groupId: capacity.supplies.find(
      (s) => s.week_key === weekKey && s.supply_id === supply.id,
    )?.programId,
    groupCapacity: capacity.supplies.find(
      (s) => s.week_key === weekKey && s.supply_id === supply.id,
    )?.commercialCapacity,
    capacity: Math.min(
      capacity.supplies.find(
        (s) => s.week_key === weekKey && s.supply_id === supply.id,
      )?.quantity || 0,
      supply.fallback_available,
    ),
    fallbackAvailable: supply.fallback_available,
    paid: supply.paid,
    assigned: 0,
    repeatedExposure: 0,
    unknownSuitability: 0,
    hours: supply.hours,
  }));
  const members = profiles.map((profile) => ({
    memberId: profile.id,
    reference: profile.id.slice(-8),
    candidates: supplies.map((supply) => {
      const review = reviews.find(
        (r) =>
          r.member_id === profile.id && r.location_id === supply.location_id,
      );
      const home = profile.home_zip === supply.postal_code,
        work = Boolean(
          profile.work_zip && profile.work_zip === supply.postal_code,
        );
      const drive = review?.drive_minutes ?? supply.drive_minutes;
      const known = Boolean(
        review ||
        policy?.all_destinations_fit ||
        home ||
        work ||
        (profile.in_market && drive !== null),
      );
      const supplyReady =
        supply.active &&
        (destinations.find((d) => d.supplyId === supply.id)?.capacity || 0) > 0;
      const suitable =
        supplyReady &&
        (review
          ? review.suitable
          : (drive === null || drive <= (policy?.max_drive_minutes || 20)) &&
            (Boolean(policy?.all_destinations_fit) ||
              home ||
              work ||
              (profile.in_market && drive !== null)));
      const recent =
        history.find(
          (h) =>
            h.member_id === profile.id && h.location_id === supply.location_id,
        )?.count || 0;
      const rotationKey = digest([
        runId,
        weekKey,
        profile.id,
        supply.location_id,
      ]);
      const reason: AssignmentReason = {
        suitable:
          suitable || (supplyReady && !known && run.data_kind !== "real"),
        unknownSuitability: !known,
        explanation: review
          ? review.evidence
          : policy?.all_destinations_fit
            ? policy.evidence
            : home || work
              ? "Destination shares the member's home or work ZIP."
              : profile.in_market && drive !== null
                ? "Member ZIP is in the cell; operator drive estimate is within the reviewed limit."
                : "Travel suitability is unknown; needs operator review before real release.",
        homeZipMatch: home,
        workZipMatch: work,
        driveMinutes: drive,
        recentDestinationCount: recent,
        acquisitionPartner: profile.partner,
        reviewId: review?.id || null,
        policyId: policy?.id || null,
        rotationKey,
      };
      return {
        supplyId: supply.id,
        reason,
        cost:
          recent * 100000 +
          (drive ?? 30) * 100 +
          (parseInt(rotationKey.slice(0, 4), 16) % 100),
      };
    }),
  }));
  const assignments = matchPilotDestinations(members, destinations);
  for (const assignment of assignments) {
    const destination = destinations.find(
      (d) => d.supplyId === assignment.supplyId,
    )!;
    destination.assigned++;
    if (assignment.reason.recentDestinationCount)
      destination.repeatedExposure++;
    if (assignment.reason.unknownSuitability) destination.unknownSuitability++;
  }
  const unassigned = members
    .filter(
      (member) => !assignments.some((a) => a.memberId === member.memberId),
    )
    .map((member) => member.memberId);
  return {
    fingerprint: digest({
      runId,
      weekKey,
      members,
      destinations,
      excluded: audience.excluded,
    }),
    runId,
    weekKey,
    admitted: audience.admitted,
    excluded: audience.excluded.length,
    members,
    assignments,
    destinations,
    unassigned,
    policy: policy || null,
  };
}

export async function saveAssignmentReview(db: DB, actor: Actor, raw: unknown) {
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  const input = z
    .discriminatedUnion("scope", [
      z.object({
        scope: z.literal("pilot"),
        runId: z.string().min(1),
        allDestinationsFit: z.boolean(),
        maxDriveMinutes: z.coerce.number().int().min(1).max(60),
        evidence: z.string().trim().min(10).max(1500),
      }),
      z.object({
        scope: z.literal("member"),
        memberId: z.string().min(1),
        locationId: z.string().min(1),
        suitable: z.boolean(),
        driveMinutes: z.coerce.number().int().min(0).max(180).nullable(),
        evidence: z.string().trim().min(10).max(1500),
      }),
    ])
    .parse(raw);
  return db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const reviewId = id();
    if (input.scope === "pilot")
      await tx.query(
        "insert into pilot_assignment_policies(id,run_id,all_destinations_fit,max_drive_minutes,evidence,actor_id) values($1,$2,$3,$4,$5,$6)",
        [
          reviewId,
          input.runId,
          input.allDestinationsFit,
          input.maxDriveMinutes,
          input.evidence,
          actor.id,
        ],
      );
    else
      await tx.query(
        "insert into member_destination_reviews(id,member_id,location_id,suitable,drive_minutes,evidence,actor_id) values($1,$2,$3,$4,$5,$6,$7)",
        [
          reviewId,
          input.memberId,
          input.locationId,
          input.suitable,
          input.driveMinutes,
          input.evidence,
          actor.id,
        ],
      );
    await audit(
      tx,
      actor.id,
      actor.organizationId,
      "assignment_suitability_review",
      reviewId,
      input,
    );
    return reviewId;
  });
}
