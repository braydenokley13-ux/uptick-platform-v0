import { getDb } from "@/lib/db";
import { prepareMembershipWeek } from "@/lib/member-experience";
import { runScheduledJob } from "@/lib/scheduled-jobs";
import { equal } from "@/lib/security";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    !equal(
      request.headers.get("authorization") || "",
      `Bearer ${process.env.CRON_SECRET}`,
    )
  )
    return new Response("Unauthorized", { status: 401 });
  try {
    const db = await getDb(),
      result = await runScheduledJob(db, "membership_prepare", () =>
        prepareMembershipWeek(db, 25),
      );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
