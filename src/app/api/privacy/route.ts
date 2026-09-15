import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { localMode } from "@/lib/config";
import { preparePhoneCorrection } from "@/lib/member-phone-correction";
import {
  dispatchRequestedMemberAccess,
  memberMessagingReadiness,
} from "@/lib/member-messaging";
import { smsEnvironmentBlock } from "@/lib/environment";
import { normalizePhone } from "@/lib/security";
import {
  apiError,
  assertSameOrigin,
  readJsonBody,
  RequestError,
} from "@/lib/http";
import {
  createPrivacyRequest,
  verifyPrivacyRequest,
  completePrivacyRequest,
  exportMemberData,
  savePrivacyPolicy,
} from "@/lib/privacy-admin";
import {
  completeRetentionReview,
  redactMemberRetentionNotes,
} from "@/lib/privacy-retention";
const headers = { "Cache-Control": "private, no-store" };
export const runtime = "nodejs";
async function operator() {
  const actor = await getActor();
  if (!actor || actor.role !== "operator")
    throw new RequestError("Operator access is required.", 403);
  return actor;
}
export async function GET(request: Request) {
  try {
    const actor = await operator(),
      requestId = new URL(request.url).searchParams.get("requestId");
    if (!requestId) throw new RequestError("Choose a verified access request.");
    return Response.json(
      await exportMemberData(await getDb(), actor, requestId),
      {
        headers: {
          ...headers,
          "Content-Disposition": "attachment; filename=uptick-member-data.json",
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await operator(),
      body = await readJsonBody(request),
      db = await getDb();
    if (body.action === "prepare-phone") {
      const simulated =
        localMode() && process.env.SMS_TRANSPORT === "development";
      const readiness = await memberMessagingReadiness(db);
      if (!simulated && (!readiness.accessReady || readiness.simulated))
        throw new RequestError(
          "Requested verification texts are not commissioned in this environment.",
          503,
        );
      const block = smsEnvironmentBlock(
        normalizePhone(String(body.newPhone || "")),
        "access",
      );
      if (block) throw new RequestError(block, 503);
      const prepared = await preparePhoneCorrection(db, actor, {
        ...body,
        requestedByMember:
          body.requestedByMember === true || body.requestedByMember === "on",
      });
      const delivery = await dispatchRequestedMemberAccess(
        db,
        prepared.messageId,
      );
      return Response.json(
        {
          message: simulated
            ? "SIMULATED verification. No SMS was sent."
            : `Verification delivery: ${delivery.state}. The member must verify the new number before you complete the correction.`,
          ...(simulated
            ? { redirect: `/phone-change/${prepared.credential}` }
            : {}),
        },
        { headers },
      );
    } else if (body.action === "request")
      await createPrivacyRequest(db, actor, body);
    else if (body.action === "verify")
      await verifyPrivacyRequest(db, actor, body);
    else if (body.action === "complete")
      await completePrivacyRequest(db, actor, {
        ...body,
        homeZip: body.homeZip || undefined,
        workZip: body.workZip || undefined,
        correctPhone: body.correctPhone === true || body.correctPhone === "on",
        retainedEvidenceReviewed:
          body.retainedEvidenceReviewed === true ||
          body.retainedEvidenceReviewed === "on",
      });
    else if (body.action === "redact-notes")
      await redactMemberRetentionNotes(db, actor, String(body.requestId || ""));
    else if (body.action === "retention-review")
      await completeRetentionReview(db, actor, {
        ...body,
        nextReviewAt: body.nextReviewAt
          ? new Date(String(body.nextReviewAt)).toISOString()
          : undefined,
        identifiersReviewed:
          body.identifiersReviewed === true ||
          body.identifiersReviewed === "on",
      });
    else if (body.action === "policy")
      await savePrivacyPolicy(db, actor, {
        ...body,
        reviewDueAt: new Date(String(body.reviewDueAt)).toISOString(),
        retentionDays: Object.fromEntries(
          ["identifiers", "support", "consent", "operational", "financial"].map(
            (k) => [k, body[k]],
          ),
        ),
      });
    else throw new RequestError("Choose an available privacy action.");
    return Response.json(
      { message: "Privacy action recorded with an audit trail." },
      { headers },
    );
  } catch (error) {
    return apiError(error);
  }
}
