import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/domain";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return new Response("Export must be opened from Uptick.", {
        status: 403,
      });
    const a = await getActor();
    if (!a || !a.canExport)
      return new Response("Export is not enabled for this account.", {
        status: 403,
      });
    const db = await getDb();
    const rows = await db.query(
      `select c.phone,s.state,s.updated_at consent_updated_at,exists(select 1 from suppressions x join senders se on se.id=x.sender_id where x.phone=c.phone and se.organization_id=$1 and x.suppressed) sender_suppressed,(select jsonb_agg(jsonb_build_object('accepted',e.accepted,'at',e.created_at,'disclosure',e.disclosure,'version',e.disclosure_version,'source',e.source_ui) order by e.created_at) from consent_events e where e.customer_id=c.id and e.organization_id=$1 and e.purpose='merchant') evidence from subscriptions s join customers c on c.id=s.customer_id where s.organization_id=$1 and s.state='subscribed'`,
      [a.organizationId],
    );
    await audit(
      db,
      a.id,
      a.organizationId,
      "contacts.exported",
      a.organizationId,
      { count: rows.length },
    );
    return Response.json(rows, {
      headers: {
        "Content-Disposition":
          'attachment; filename="uptick-consented-contacts.json"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
