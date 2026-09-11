import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  apiError,
  assertSameOrigin,
  readJsonBody,
  RequestError,
} from "@/lib/http";
import {
  requestGrowthSupply,
  saveGrowthPreferences,
} from "@/lib/merchant-growth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor)
      throw new RequestError("Sign in to your merchant workspace.", 401);
    const data = await readJsonBody(request),
      db = await getDb();
    if (data.action === "preferences")
      await saveGrowthPreferences(db, actor, data);
    else if (data.action === "supply")
      await requestGrowthSupply(db, actor, data);
    else throw new RequestError("Choose a supported Growth action.");
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
