import { getDb } from "@/lib/db";
import {
  verifyInternalTestWebhook,
  handleInternalTestWebhook,
} from "@/lib/internal-testing-http";
import { RequestError } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await verifyInternalTestWebhook(request.clone());
    return handleInternalTestWebhook(request, await getDb());
  } catch (error) {
    return new Response("Test callback could not be processed.", {
      status: error instanceof RequestError ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
