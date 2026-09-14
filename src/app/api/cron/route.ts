import { getDb } from "@/lib/db";
import { dispatchMemberMessages } from "@/lib/member-messaging";
import { equal } from "@/lib/security";
import { apiError } from "@/lib/http";
import { runScheduledJob } from "@/lib/scheduled-jobs";
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
    // Two provider requests, each with a 15-second timeout, fit comfortably
    // within this route's 60-second budget. Preparation has a separate route.
    const result = await runScheduledJob(db, "membership_dispatch", () =>
      dispatchMemberMessages(db, 2),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
