import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  assertSameOrigin,
  readJsonBody,
  apiError,
  RequestError,
} from "@/lib/http";
import {
  saveMarket,
  saveMarketLocation,
  savePartner,
  saveAcquisitionSource,
  saveSupply,
  approveSupply,
  adjustSupply,
  pauseSupply,
  resumeSupply,
  allocateMarket,
  saveMembershipSender,
  prepareMembershipMessages,
  dispatchMembershipMessages,
  lookupNetworkMember,
} from "@/lib/network-operations";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor) throw new RequestError("Sign in to continue.", 401);
    if (actor.role !== "operator")
      throw new RequestError("Operator access is required.", 403);
    const body = await readJsonBody(request, 16000),
      db = await getDb();
    const action = z.string().max(60).parse(body.action);
    let message = "Saved. The network workspace now reflects this change.";
    let redirect: string | undefined;
    let memberSupport:
      Awaited<ReturnType<typeof lookupNetworkMember>> | undefined;
    if (action === "member-lookup") {
      memberSupport = await lookupNetworkMember(db, actor, body);
      message = memberSupport
        ? "Matching member found. This support lookup is recorded in the audit history."
        : "No Uptick membership matches that phone number.";
    } else if (action === "market-save") {
      const marketId = await saveMarket(db, actor, body);
      redirect = `/operator/network/markets?market=${marketId}`;
      message =
        "Market saved. Its operating state is an operator decision; coverage and evidence remain separate.";
    } else if (action === "market-location-save")
      await saveMarketLocation(db, actor, body);
    else if (action === "partner-save") await savePartner(db, actor, body);
    else if (action === "source-save")
      await saveAcquisitionSource(db, actor, body);
    else if (action === "supply-save") await saveSupply(db, actor, body);
    else if (action === "supply-approve") {
      await approveSupply(
        db,
        actor,
        z.string().min(1).max(100).parse(body.supplyId),
      );
      message =
        "Drop supply approved. The saved offer version, verification policy and economics are recorded in the audit history.";
    } else if (action === "supply-adjust") await adjustSupply(db, actor, body);
    else if (action === "supply-pause") {
      await pauseSupply(db, actor, body);
      message =
        "New allocations and claims are paused. Existing passes keep their saved terms.";
    } else if (action === "supply-resume") {
      await resumeSupply(db, actor, body);
      message =
        "Drop supply resumed with its original approved version and rules.";
    } else if (action === "allocate") {
      const result = await allocateMarket(
        db,
        actor,
        z.string().min(1).max(100).parse(body.marketId),
      );
      message = `${result.checked} permissioned members checked. ${result.allocated} have saved options; ${result.withoutOptions} have no current option. No messages were sent.`;
    } else if (action === "membership-sender-save") {
      await saveMembershipSender(db, actor, body);
      message =
        "Uptick membership sender saved. Provider approval remains an operator attestation; delivery still checks every platform gate.";
    } else if (action === "membership-prepare") {
      const queued = await prepareMembershipMessages(db, actor);
      message = `${queued} current-week membership messages prepared. No messages were sent. Review the ledger before dispatching.`;
    } else if (action === "membership-dispatch") {
      const result = await dispatchMembershipMessages(db, actor, body);
      message = `${result.processed} queued membership messages processed. ${result.simulated ? "Development transport: no SMS was sent." : "The ledger records accepted, suppressed or uncertain outcomes. Provider acceptance is not delivery."}`;
    } else throw new RequestError("Unknown network action.");
    return Response.json(
      {
        message,
        ...(redirect ? { redirect } : {}),
        ...(memberSupport !== undefined ? { memberSupport } : {}),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
