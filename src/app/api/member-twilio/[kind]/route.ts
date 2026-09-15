import { getDb } from "@/lib/db";
import {
  memberInbound,
  memberMessageStatus,
  verifyMemberWebhook,
} from "@/lib/member-messaging";
import { RequestError } from "@/lib/http";
import { recordCallbackHealth } from "@/lib/release-readiness";
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
  const { kind } = await params;
  let authenticated = false;
  try {
    const { fields, messageId } = await verifyMemberWebhook(request, kind);
    authenticated = true;
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
    try {
      const [source] =
        kind === "inbound"
          ? await db.query<{ sender_id: string }>(
              "select sender_id from member_inbound_events where provider_sid=$1",
              [fields.MessageSid],
            )
          : await db.query<{ sender_id: string }>(
              "select sender_id from member_messages where id=$1",
              [messageId],
            );
      await recordCallbackHealth(db, kind, true, undefined, source?.sender_id);
    } catch {
      console.error("member_callback_health_write_failed", { kind });
    }
    const body = inbound?.shouldReply
      ? `<Response><Message>${xml(inbound.reply)}</Message></Response>`
      : "<Response/>";
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    });
  } catch (error) {
    try {
      if (authenticated)
        await recordCallbackHealth(
          await getDb(),
          kind,
          false,
          error instanceof RequestError ? error.status : 500,
        );
    } catch {
      /* Callback response stays safe if its health ledger is unavailable. */
    }
    return new Response("Membership callback could not be processed.", {
      status: error instanceof RequestError ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
