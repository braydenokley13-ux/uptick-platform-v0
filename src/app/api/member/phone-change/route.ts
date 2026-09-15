import { z } from "zod";
import { getDb } from "@/lib/db";
import { assertSameOrigin, readJsonBody, apiError } from "@/lib/http";
import { confirmPhoneCorrection } from "@/lib/member-phone-correction";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    const credential = z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(body.credential);
    await confirmPhoneCorrection(await getDb(), credential);
    return Response.json(
      {
        message:
          "Your new number is verified. Uptick support will finish the requested account correction. This check did not sign you in or subscribe you to promotional texts.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
