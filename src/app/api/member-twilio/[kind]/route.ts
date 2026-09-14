import { getDb } from "@/lib/db";
import {
  memberInbound,
  memberMessageStatus,
  verifyMemberWebhook,
} from "@/lib/member-messaging";
import { RequestError } from "@/lib/http";
export const runtime = "nodejs";
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  try {
    const { kind } = await params;
    const { fields, messageId } = await verifyMemberWebhook(request, kind);
    const db = await getDb();
    const inbound = kind === "inbound" ? await memberInbound(db, fields) : null;
    if (kind !== "inbound")
      await memberMessageStatus(
        db,
        messageId,
        fields.MessageSid,
        fields.MessageStatus,
        fields.ErrorCode,
      );
    const body = inbound
      ? `<Response><Message>${xml(inbound.reply)}</Message></Response>`
      : "<Response/>";
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return new Response("Membership callback could not be processed.", {
      status: error instanceof RequestError ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
