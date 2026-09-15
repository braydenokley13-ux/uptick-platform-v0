import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { demoMode, assertDemoStorage } from "@/lib/demo-guard";
import { demoStockout, demoRecovery } from "@/lib/demo-studio";
import { assertSameOrigin, apiError } from "@/lib/http";
import { setSession } from "@/lib/auth";
import { MEMBER_SESSION_COOKIE } from "@/lib/member-session";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!demoMode())
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  try {
    // No DB selection, login or fixture access before the isolation checks.
    assertDemoStorage();
    assertSameOrigin(request);
    const { action } = z
      .object({
        action: z.enum([
          "member",
          "operator",
          "merchant",
          "stockout",
          "recovery",
        ]),
      })
      .parse(await request.json());
    const db = await getDb();
    let redirect = "/demo";
    if (action === "member") {
      (await cookies()).delete(MEMBER_SESSION_COOKIE);
      redirect = "/join";
    }
    if (action === "operator" || action === "merchant") {
      await setSession(`demo-${action}`);
      redirect =
        action === "operator" ? "/operator/pilot" : "/merchant/results";
    }
    if (action === "stockout") await demoStockout(db);
    if (action === "recovery") await demoRecovery(db);
    return Response.json(
      { ok: true, redirect },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
