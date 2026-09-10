import QRCode from "qrcode";
import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/config";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor();
    if (actor?.role !== "operator")
      return new Response("Unauthorized", { status: 403 });
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id))
      return new Response("Not found", { status: 404 });
    const [s] = await (
      await getDb()
    ).query<{ token: string }>("select token from sources where id=$1", [id]);
    if (!s) return new Response("Not found", { status: 404 });
    const svg = await QRCode.toString(
      `${appUrl().replace(/\/$/, "")}/c/${s.token}`,
      {
        type: "svg",
        margin: 4,
        errorCorrectionLevel: "M",
        color: { dark: "#0a1820", light: "#ffffff" },
      },
    );
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="uptick-source-${id}.svg"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
