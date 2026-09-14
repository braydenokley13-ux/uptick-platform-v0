import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  approveGrowthProgramVersion,
  createGrowthProgram,
  growthProgramWorkspace,
  linkProgramSupply,
  proposeGrowthProgramAmendment,
  recordProgramCredit,
  submitMerchantSupplyProposal,
  terminateGrowthProgram,
} from "@/lib/growth-programs";
import {
  apiError,
  assertSameOrigin,
  readJsonBody,
  RequestError,
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor)
      throw new RequestError("Sign in to your merchant workspace.", 401);
    return Response.json(await growthProgramWorkspace(await getDb(), actor), {
      headers: noStore,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor)
      throw new RequestError("Sign in to your merchant workspace.", 401);
    const data = await readJsonBody(request);
    const db = await getDb();
    let result: string | number;
    if (data.action === "create_program")
      result = await createGrowthProgram(db, actor, data);
    else if (data.action === "amend_program") {
      if (typeof data.programId !== "string")
        throw new RequestError("Choose a Growth Program to amend.");
      result = await proposeGrowthProgramAmendment(
        db,
        actor,
        data.programId,
        data,
      );
    } else if (data.action === "submit_supply")
      result = await submitMerchantSupplyProposal(db, actor, data);
    else if (data.action === "link_supply")
      result = await linkProgramSupply(db, actor, data);
    else if (data.action === "approve_program")
      result = await approveGrowthProgramVersion(db, actor, data);
    else if (data.action === "record_credit")
      result = await recordProgramCredit(db, actor, data);
    else if (data.action === "terminate_program")
      result = await terminateGrowthProgram(db, actor, data);
    else throw new RequestError("Choose a supported Growth Program action.");
    return Response.json({ ok: true, result }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
