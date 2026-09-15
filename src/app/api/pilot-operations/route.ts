import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { amendPilotSupply } from "@/lib/pilot-supply-amendments";
import { recordMemberServiceEvent } from "@/lib/member-service";
import {
  apiError,
  assertSameOrigin,
  readJsonBody,
  RequestError,
} from "@/lib/http";
import {
  admitPilotMember,
  classifyPilotEntity,
  commitPilotSupply,
  completePartnerCommitment,
  createPilotRun,
  recordEconomicEntry,
  recordLabor,
  reverseEconomicEntry,
  savePartnerCommitment,
  setPilotState,
} from "@/lib/pilot-operations";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor || actor.role !== "operator")
      throw new RequestError("Operator access is required.", 403);
    const db = await getDb(),
      body = await readJsonBody(request);
    let message = "Saved. The pilot record has been updated.",
      redirect: string | undefined;
    switch (body.action) {
      case "member-service":
        await recordMemberServiceEvent(db, actor, body);
        message =
          "Account status recorded. Original cohort and issued benefit history are preserved.";
        break;
      case "run-create": {
        const runId = await createPilotRun(db, actor, body);
        redirect = `/operator/pilot?run=${encodeURIComponent(runId)}`;
        break;
      }
      case "supply-commit":
        await commitPilotSupply(db, actor, body);
        break;
      case "supply-amend":
        await amendPilotSupply(db, actor, body);
        message =
          "Future supply replaced. Original commitment and issued history are preserved. Any pending commercial version still requires approval.";
        break;
      case "admit": {
        const result = await admitPilotMember(db, actor, body);
        message =
          result.state === "admitted"
            ? "Member admitted to the backed four-week cohort."
            : result.state === "waitlisted"
              ? "Capacity reached. Member added to the waitlist."
              : "No eligible run is accepting this member yet.";
        break;
      }
      case "run-state": {
        const checklist = Object.fromEntries(
          [
            "ownerAgreements",
            "staffRehearsal",
            "recoveryFunded",
            "supportCoverage",
            "partnerDistribution",
            "privacyIdentity",
            "releaseVerified",
          ].map((key) => [key, body[key] === "on" || body[key] === true]),
        );
        await setPilotState(db, actor, { ...body, checklist });
        break;
      }
      case "partner-plan":
        await savePartnerCommitment(db, actor, {
          ...body,
          plannedAt: new Date(String(body.plannedAt)).toISOString(),
          intendedPopulation:
            body.intendedPopulation === "" ? null : body.intendedPopulation,
        });
        break;
      case "partner-complete":
        await completePartnerCommitment(db, actor, {
          ...body,
          reportedDelivered:
            body.reportedDelivered === "" ? null : body.reportedDelivered,
        });
        break;
      case "economic-entry":
        await recordEconomicEntry(db, actor, {
          ...body,
          programId: body.programId || null,
        });
        break;
      case "economic-reverse":
        await reverseEconomicEntry(db, actor, body);
        break;
      case "labor-entry":
        await recordLabor(db, actor, body);
        break;
      case "classify":
        await classifyPilotEntity(db, actor, body);
        break;
      default:
        throw new RequestError("Choose an available pilot action.");
    }
    return Response.json(
      { message, ...(redirect ? { redirect } : {}) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
