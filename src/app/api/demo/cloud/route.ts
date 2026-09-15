import { cookies } from "next/headers";
import { z } from "zod";
import {
  cloudDemoMode,
  assertCloudDemoEnvironment,
} from "@/lib/cloud-demo-guard";
import {
  CLOUD_DEMO_COOKIE,
  CLOUD_DEMO_LOCK,
  acquireCloudDemoLease,
  cloudDemoConnection,
  requireCloudDemoLease,
  verifyCloudDemoOwnership,
} from "@/lib/cloud-demo-db";
import { resetCloudDemo } from "@/lib/cloud-demo-reset";
import {
  assertSameOrigin,
  readJsonBody,
  apiError,
  RequestError,
} from "@/lib/http";
import { MEMBER_SESSION_COOKIE } from "@/lib/member-session";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!cloudDemoMode()) return new Response("Not found", { status: 404 });
  try {
    assertCloudDemoEnvironment();
    assertSameOrigin(request);
    const input = z
      .object({
        action: z.enum(["unlock", "reset", "end"]),
        accessKey: z.string().max(128).optional(),
      })
      .parse(await readJsonBody(request, 1024));
    const jar = await cookies();
    const existing = jar.get(CLOUD_DEMO_COOKIE)?.value;
    let credential: string | undefined;
    if (input.action === "unlock") {
      credential = await acquireCloudDemoLease(
        cloudDemoConnection(),
        input.accessKey || "",
        existing,
      );
    } else {
      if (!existing) throw new RequestError("Unlock Demo Studio first.", 401);
      if (input.action === "reset")
        credential = await resetCloudDemo(cloudDemoConnection(), existing);
      else
        await cloudDemoConnection().transaction(async (tx) => {
          await tx.query("select pg_advisory_xact_lock($1)", [CLOUD_DEMO_LOCK]);
          await verifyCloudDemoOwnership(tx);
          await requireCloudDemoLease(tx, existing);
          await tx.query(
            "update uptick_demo.lease set token_hash=null,expires_at=null,generation=generation+1 where singleton=true",
          );
        });
    }
    jar.delete(MEMBER_SESSION_COOKIE);
    jar.delete("uptick-session");
    if (credential)
      jar.set(CLOUD_DEMO_COOKIE, credential, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 3600,
      });
    else jar.delete(CLOUD_DEMO_COOKIE);
    return Response.json(
      { ok: true, redirect: "/demo" },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
