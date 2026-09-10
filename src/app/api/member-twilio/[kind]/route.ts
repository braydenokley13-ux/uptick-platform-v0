import { getDb } from "@/lib/db";
import {
  memberInbound,
  memberMessageStatus,
  verifyMemberWebhook,
} from "@/lib/member-messaging";
import { RequestError } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  try {
    const { kind } = await params;
    const { fields, messageId } = await verifyMemberWebhook(request, kind);
    const db = await getDb();
    if (kind === "inbound") await memberInbound(db, fields);
    else
      await memberMessageStatus(
        db,
        messageId,
        fields.MessageSid,
        fields.MessageStatus,
        fields.ErrorCode,
      );
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return new Response("Membership callback could not be processed.", {
      status: error instanceof RequestError ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
