import { getDb } from "@/lib/db";
import { dispatch, expandDueBroadcasts } from "@/lib/messaging";
import { prepareMembershipWeek } from "@/lib/member-experience";
import { dispatchMemberMessages } from "@/lib/member-messaging";
import { equal } from "@/lib/security";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: Request) {
  if (
    !process.env.CRON_SECRET ||
    !equal(
      req.headers.get("authorization") || "",
      `Bearer ${process.env.CRON_SECRET}`,
    )
  )
    return new Response("Unauthorized", { status: 401 });
  try {
    const db = await getDb();
    await expandDueBroadcasts(db);
    const processed = await dispatch(db, 10);
    const membershipPrepared = await prepareMembershipWeek(db, 100);
    const membershipProcessed = await dispatchMemberMessages(db, 20);
    return Response.json(
      { processed, membershipPrepared, membershipProcessed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
