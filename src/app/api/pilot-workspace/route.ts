import { z } from "zod";
import { switchPilotWorkspace } from "@/lib/auth";
import { apiError, assertSameOrigin, readJsonBody } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { organizationId } = z
      .object({ organizationId: z.string().min(1).max(80).nullable() })
      .parse(await readJsonBody(request));
    return Response.json(
      { redirect: await switchPilotWorkspace(organizationId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
