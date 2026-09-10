import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertSameOrigin, apiError } from "@/lib/http";
import { handleInternalTestRequest } from "@/lib/internal-testing-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return handleInternalTestRequest(request, await getActor(), await getDb());
  } catch (error) {
    return apiError(error);
  }
}
