import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertSameOrigin, readJsonBody, apiError } from "@/lib/http";
import { audit } from "@/lib/domain";
import { id } from "@/lib/security";
import {
  confirmPlacement,
  createCreative,
  createPlacementSource,
  customerTimeline,
  reviewDecision,
} from "@/lib/operator";
export const runtime = "nodejs";
const text = (max = 200) => z.string().trim().max(max);
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Sign in to continue." },
        { status: 401 },
      );
    if (actor.role !== "operator")
      return NextResponse.json(
        { error: "Operator access is required." },
        { status: 403 },
      );
    const data = await readJsonBody(request, 16000);
    const action = text(50).parse(data.action);
    const db = await getDb();
    if (action === "placement-confirmation") {
      await confirmPlacement(
        db,
        actor,
        z
          .object({
            id: text(80),
            status: z.enum(["confirmed", "intended", "paused"]),
            note: text(600).min(5),
            externalReference: text(120),
          })
          .parse(data),
      );
      return NextResponse.json({
        message:
          "Placement status and confirmation note saved. This records the handoff, not screen playback.",
      });
    }
    if (action === "create-placement-source") {
      const sourceId = await createPlacementSource(
        db,
        actor,
        z
          .object({
            offerId: text(80),
            locationId: text(80),
            placement: text(100).min(2),
            campaign: text(120).min(2),
            creative: text(120).min(2),
            placementType: text(80),
            environment: text(160),
            dwellContext: text(160),
          })
          .parse(data),
      );
      return NextResponse.json({ redirect: `/operator/sources/${sourceId}` });
    }
    if (action === "review-decision") {
      await reviewDecision(
        db,
        actor,
        z
          .object({
            offerId: text(80),
            decision: z.enum(["returned", "rejected"]),
            note: text(1000).min(5),
          })
          .parse(data),
      );
      return NextResponse.json({
        message:
          "Decision saved. The merchant can see your note and revise the draft.",
        redirect: "/operator/review",
      });
    }
    if (action === "create-creative") {
      const sourceId = await createCreative(
        db,
        actor,
        z
          .object({
            sourceId: text(80),
            headline: text(80).min(3),
            cta: text(60).min(3),
            format: z.enum(["landscape", "countertop"]),
            notes: text(600),
          })
          .parse(data),
      );
      return NextResponse.json({
        redirect: `/operator/sources/${sourceId}?creative=saved`,
      });
    }
    if (action === "business-profile") {
      const input = z
        .object({
          organizationId: text(80),
          category: z.enum([
            "",
            "fuel-convenience",
            "car-wash",
            "auto-service",
            "cafe",
            "restaurant",
            "retail",
            "wellness",
            "other",
          ]),
          growthGoal: text(300),
        })
        .parse(data);
      await db.transaction(async (tx) => {
        await tx.query(
          "insert into business_profiles(organization_id,category,growth_goal) values($1,$2,$3) on conflict(organization_id) do update set category=excluded.category,growth_goal=excluded.growth_goal,updated_at=now()",
          [input.organizationId, input.category, input.growthGoal],
        );
        await audit(
          tx,
          actor.id,
          input.organizationId,
          "business.profile-updated",
          input.organizationId,
          { category: input.category },
        );
      });
      return NextResponse.json({
        message: "Category and acquisition goal saved.",
      });
    }
    if (action === "add-location") {
      const input = z
        .object({
          organizationId: text(80),
          name: text(100).min(2),
          address: text(240).min(5),
        })
        .parse(data);
      await db.transaction(async (tx) => {
        const locationId = id();
        await tx.query(
          "insert into locations(id,organization_id,name,address) values($1,$2,$3,$4)",
          [locationId, input.organizationId, input.name, input.address],
        );
        await audit(
          tx,
          actor.id,
          input.organizationId,
          "location.created",
          locationId,
        );
      });
      return NextResponse.json({ message: "Location added." });
    }
    if (action === "launch-check") {
      const input = z
        .object({
          organizationId: text(80),
          checkKey: z.enum(["claim-tested", "pass-tested", "staff-briefed"]),
          note: text(600).min(8),
        })
        .parse(data);
      await db.transaction(async (tx) => {
        await tx.query(
          "insert into launch_checks(organization_id,check_key,note,actor) values($1,$2,$3,$4) on conflict(organization_id,check_key) do update set note=excluded.note,actor=excluded.actor,checked_at=now()",
          [input.organizationId, input.checkKey, input.note, actor.id],
        );
        await audit(
          tx,
          actor.id,
          input.organizationId,
          "launch.check-recorded",
          input.organizationId,
          { check: input.checkKey, note: input.note },
        );
      });
      return NextResponse.json({
        message:
          "Manual test evidence recorded. Recheck after changing an offer or sender.",
      });
    }
    if (action === "customer-lookup") {
      const input = z
        .object({ query: text(500).min(1), organizationId: text(80).min(1) })
        .parse(data);
      const result = await customerTimeline(
        db,
        actor,
        input.query,
        input.organizationId,
      );
      return NextResponse.json(
        { result },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    throw Error("Unknown operator action.");
  } catch (error) {
    return apiError(error);
  }
}
