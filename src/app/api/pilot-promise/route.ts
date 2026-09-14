import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
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
    if (data.action === "configure_supply")
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
