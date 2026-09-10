import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertSameOrigin, readJsonBody, apiError } from "@/lib/http";
import { saveDraft, rateLimit } from "@/lib/domain";
import { offerGoals, offerTemplates } from "@/lib/product";
export const runtime = "nodejs";
const estimate = z.number().finite().min(0).max(1000000).nullable();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Please sign in to continue." },
        { status: 401 },
      );
    const body = await readJsonBody(request);
    const input = z
      .object({
        id: z.string().optional(),
        organizationId: z.string(),
        title: z.string().trim().min(1).max(100),
        qualification: z.string().trim().min(1).max(160),
        reward: z.string().trim().min(1).max(160),
        terms: z.string().trim().min(1).max(1000),
        startsAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        limitMode: z.enum(["unlimited", "claim", "redemption"]),
        quantity: z.number().int().positive().max(100000).nullable(),
        submit: z.boolean(),
        kind: z.enum(["anchor", "drop"]),
        productMetadata: z.object({
          goal: z.string().refine((v) => offerGoals.some((g) => g.id === v)),
          templateId: z
            .string()
            .nullable()
            .refine(
              (v) => v === null || offerTemplates.some((t) => t.id === v),
            ),
          customerValue: estimate,
          rewardCost: estimate,
          requiredPurchase: estimate,
          staffInstructions: z.string().max(1500),
        }),
      })
      .parse(body);
    const db = await getDb();
    await rateLimit(db, `studio:${actor.id}`, 60, 3600);
    const offerId = await saveDraft(db, actor, input);
    return NextResponse.json({
      ok: true,
      redirect: `/${actor.role === "operator" ? "operator/review" : "merchant/drops"}?saved=${offerId}`,
    });
  } catch (error) {
    return apiError(error);
  }
}
