import { cookies } from "next/headers";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/domain";
import {
  apiError,
  assertSameOrigin,
  readJsonBody,
  requestRatePolicy,
  RequestError,
} from "@/lib/http";
import { decrypt, hash } from "@/lib/security";
import {
  createRedemptionPoint,
  operatorOverride,
  redeemAtPoint,
  revokeRedemptionPoint,
  rotateTapCredential,
  simulateTap,
} from "@/lib/tap";
export const runtime = "nodejs";
const privateToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const data = await readJsonBody(request),
      db = await getDb();
    const action = z
      .enum([
        "redeem",
        "create-point",
        "rotate",
        "revoke",
        "simulate",
        "override",
      ])
      .parse(data.action);
    const policy = requestRatePolicy(request, "tap");
    await rateLimit(db, `tap:${hash(policy.identity)}`, policy.max, 3600);
    if (action === "redeem") {
      let credential = data.passToken;
      if (!credential) {
        const encrypted = (await cookies()).get("uptick-active-pass")?.value;
        if (encrypted) {
          try {
            credential = decrypt(encrypted);
          } catch {
            /* Invalid credentials never identify a pass. */
          }
        }
      }
      if (!credential)
        throw new RequestError(
          "Open your private Uptick pass on this phone, then scan the store’s Tap again.",
          401,
        );
      const result = await redeemAtPoint(db, privateToken.parse(credential), {
        pointToken: data.pointToken
          ? privateToken.parse(data.pointToken)
          : undefined,
        selfConfirm: data.selfConfirm === true,
        nfc: data.nfc
          ? z
              .object({
                encryptedPicc: z.string().regex(/^[a-fA-F0-9]{32}$/),
                mac: z.string().regex(/^[a-fA-F0-9]{16}$/),
              })
              .strict()
              .parse(data.nfc)
          : undefined,
      });
      const recovery = "recovery" in result ? result.recovery : null;
      return Response.json(
        {
          redeemed: true,
          reward:
            recovery?.member_snapshot.exact_item || result.claim.snapshot.reward,
          merchant:
            recovery?.member_snapshot.merchant || result.claim.snapshot.merchant,
          redeemedAt: recovery?.redeemed_at || result.claim.redeemed_at,
          timezone: result.claim.snapshot.timezone,
          evidence: result.evidence,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const actor = await getActor();
    if (!actor || actor.role !== "operator")
      throw new RequestError(
        "Sign in as an Uptick operator to manage redemption points.",
        403,
      );
    if (action === "create-point") {
      const input = z
        .object({
          organizationId: z.string().min(1).max(100),
          locationId: z.string().min(1).max(100),
          name: z.string().min(1).max(100),
          exposure: z.enum(["staff", "public"]),
        })
        .parse(data);
      const result = await createRedemptionPoint(db, actor, input);
      return Response.json({ pointId: result.point.id });
    }
    if (action === "override") {
      await operatorOverride(
        db,
        actor,
        privateToken.parse(data.passToken),
        z.string().min(12).max(1000).parse(data.reason),
      );
      return Response.json({ ok: true });
    }
    const pointId = z.string().min(1).max(100).parse(data.pointId);
    if (action === "revoke") await revokeRedemptionPoint(db, actor, pointId);
    if (action === "rotate") {
      const type = z.enum(["qr", "secure_nfc"]).parse(data.type);
      await rotateTapCredential(
        db,
        actor,
        pointId,
        type === "qr"
          ? { type }
          : {
              type,
              uid: z.string().max(14).parse(data.uid),
              metaKeyRef: z.string().max(95).parse(data.metaKeyRef),
              fileKeyRef: z.string().max(95).parse(data.fileKeyRef),
            },
      );
    }
    if (action === "simulate") {
      const scenario = z
        .enum([
          "qr",
          "secure_nfc_vector",
          "wrong_location",
          "replay",
          "revoked",
        ])
        .parse(data.scenario);
      const result = await simulateTap(db, actor, pointId, scenario);
      return Response.json({ ok: true, simulation: result });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
