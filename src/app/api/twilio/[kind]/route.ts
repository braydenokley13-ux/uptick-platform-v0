import twilio from "twilio";
import { appUrl } from "@/lib/config";
import { getDb } from "@/lib/db";
import { inbound, statusCallback } from "@/lib/messaging";
import { readBody, RequestError } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!["inbound", "status"].includes(kind))
    return new Response("", { status: 404 });
  try {
    if (
      req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
    )
      return new Response("Unsupported content type", { status: 415 });
    const url = new URL(req.url);
    const fields = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const canonical = `${appUrl().replace(/\/$/, "")}/api/twilio/${kind}${url.search}`;
    if (
      !process.env.TWILIO_AUTH_TOKEN ||
      !twilio.validateRequest(
        process.env.TWILIO_AUTH_TOKEN,
        req.headers.get("x-twilio-signature") || "",
        canonical,
        fields,
      )
    )
      return new Response("Invalid signature", { status: 403 });
    if (fields.AccountSid !== process.env.TWILIO_ACCOUNT_SID)
      return new Response("Invalid account", { status: 403 });
    const db = await getDb();
    if (kind === "status")
      await statusCallback(
        db,
        url.searchParams.get("message") || "",
        fields.MessageSid,
        fields.MessageStatus,
        fields.ErrorCode,
      );
    else await inbound(db, fields);
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return new Response("Webhook could not be processed", {
      status: error instanceof RequestError ? error.status : 400,
    });
  }
}
