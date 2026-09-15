import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { memberAccess } from "@/lib/membership-identity";
import { MEMBER_SESSION_COOKIE } from "@/lib/member-session";
import { exportMemberData } from "@/lib/privacy-admin";
import { apiError, RequestError } from "@/lib/http";
import { rateLimit } from "@/lib/domain";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const credential = (await cookies()).get(MEMBER_SESSION_COOKIE)?.value;
    if (!credential)
      throw new RequestError(
        "Sign in to Your Uptick to retrieve your account data.",
        401,
      );
    const db = await getDb(),
      { member } = await memberAccess(db, credential, true);
    await rateLimit(db, `privacy-self-export:${member.id}`, 10, 3600);
    const requestId = new URL(request.url).searchParams.get("requestId");
    if (!requestId)
      throw new RequestError("Choose a verified data-access request.");
    const data = await exportMemberData(db, { memberId: member.id }, requestId);
    return Response.json(data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition":
          "attachment; filename=uptick-my-account-data.json",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
