import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  apiError,
  assertSameOrigin,
  readJsonBody,
  RequestError,
} from "@/lib/http";
import {
  recordCommissioningEvidence,
  reviewLegacyMigrationBaseline,
} from "@/lib/release-readiness";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor || actor.role !== "operator")
      throw new RequestError("Operator access is required.", 403);
    const input = await readJsonBody(request),
      db = await getDb();
    if (input.action === "commissioning")
      await recordCommissioningEvidence(db, actor, {
        ...input,
        reviewDueAt: new Date(String(input.reviewDueAt)).toISOString(),
      });
    else if (input.action === "migration-baseline")
      await reviewLegacyMigrationBaseline(
        db,
        actor,
        String(input.evidence || ""),
      );
    else throw new RequestError("Choose an available readiness action.");
    return Response.json(
      { message: "Evidence recorded for the current release and schema." },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
