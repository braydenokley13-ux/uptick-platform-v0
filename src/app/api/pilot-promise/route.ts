import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  recommendPilotAssignments,
  saveAssignmentReview,
} from "@/lib/pilot-assignment";
import { z } from "zod";
import {
  openLocationOutage,
  closeLocationOutage,
} from "@/lib/location-outages";
import {
  apiError,
  assertSameOrigin,
  readJsonBody,
  RequestError,
} from "@/lib/http";
import {
  configurePilotSupply,
  issueIncidentRecovery,
  pilotPromiseOperations,
  releaseWeeklyBenefits,
  reportFulfillmentIncident,
  saveDestinationReadiness,
  savePilotFallback,
} from "@/lib/pilot-promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

async function operator() {
  const actor = await getActor();
  if (!actor) throw new RequestError("Sign in to continue.", 401);
  if (actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  return actor;
}

export async function GET(request: Request) {
  try {
    const actor = await operator();
    const runId = new URL(request.url).searchParams.get("runId");
    return Response.json(
      await pilotPromiseOperations(await getDb(), actor, runId),
      { headers: noStore },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await operator();
    const data = await readJsonBody(request, 128000);
    const db = await getDb();
    let result: unknown;
    if (data.action === "open_location_outage")
      result = await openLocationOutage(db, actor, data);
    else if (data.action === "close_location_outage")
      result = await closeLocationOutage(db, actor, data);
    else if (data.action === "recommend_assignments") {
      const input = z
        .object({
          runId: z.string().min(1),
          weekKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .parse(data);
      result = await recommendPilotAssignments(db, input.runId, input.weekKey);
    } else if (data.action === "review_suitability")
      result = await saveAssignmentReview(db, actor, {
        ...data,
        allDestinationsFit:
          data.allDestinationsFit === true || data.allDestinationsFit === "on",
        suitable: data.suitable === true || data.suitable === "true",
        driveMinutes: data.driveMinutes === "" ? null : data.driveMinutes,
      });
    else if (data.action === "configure_supply")
      result = await configurePilotSupply(db, actor, data);
    else if (data.action === "save_fallback")
      result = await savePilotFallback(db, actor, data);
    else if (data.action === "save_readiness")
      result = await saveDestinationReadiness(db, actor, data);
    else if (data.action === "release_week")
      result = await releaseWeeklyBenefits(db, actor, data);
    else if (data.action === "report_incident")
      result = await reportFulfillmentIncident(db, actor, data);
    else if (data.action === "issue_recovery")
      result = await issueIncidentRecovery(db, actor, data);
    else throw new RequestError("Choose a supported pilot promise action.");
    return Response.json({ ok: true, result }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
