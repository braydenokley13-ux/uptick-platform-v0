import { getDb } from "@/lib/db";
import { acquisitionSource, demandEvent } from "@/lib/network";
import { rateLimit } from "@/lib/domain";
import {
  assertSameOrigin,
  readJsonBody,
  requestIdentity,
  apiError,
} from "@/lib/http";
import { hash } from "@/lib/security";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    const db = await getDb();
    await rateLimit(
      db,
      `acquisition-visit:${hash(requestIdentity(request))}`,
      2400,
      3600,
    );
    const source = await acquisitionSource(
      db,
      z.string().max(100).parse(body.token),
    );
    await demandEvent(db, {
      kind: "source_loaded",
      marketId: source.market_id,
      sourceId: source.id,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
