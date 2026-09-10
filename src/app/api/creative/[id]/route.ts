import QRCode from "qrcode";
import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/config";
import { creativeExportData } from "@/lib/operator";
export const runtime = "nodejs";
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function lines(text: string, max: number) {
  const result: string[] = [];
  for (const word of text
    .split(/\s+/)
    .flatMap((word) =>
      word.length > max
        ? word.match(new RegExp(`.{1,${max}}`, "g")) || [word]
        : [word],
    )) {
    if (!result.length || `${result.at(-1)} ${word}`.length > max)
      result.push(word);
    else result[result.length - 1] += ` ${word}`;
  }
  return result;
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActor();
  if (actor?.role !== "operator")
    return new Response("Operator access required", { status: 403 });
  const { id } = await params;
  const c = await creativeExportData(await getDb(), actor, id);
  if (!c)
    return new Response("Create a screen creative for this source first.", {
      status: 404,
    });
  const landscape = c.format === "landscape",
    w = landscape ? 1920 : 1080,
    h = landscape ? 1080 : 1440;
  const qrSize = landscape ? 390 : 310,
    qrX = w - qrSize - 95,
    qrY = landscape ? 320 : 960;
  const qr = await QRCode.toString(`${appUrl()}/c/${c.token}`, {
    type: "svg",
    margin: 3,
    errorCorrectionLevel: "M",
    color: { dark: "#0a202a", light: "#ffffff" },
  });
  const qrInner = qr.replace(
    /<svg[^>]*>/,
    `<svg x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" viewBox="${qr.match(/viewBox="([^"]+)"/)?.[1] || "0 0 37 37"}">`,
  );
  const headline = lines(c.headline, landscape ? 27 : 25),
    reward = lines(c.reward, landscape ? 36 : 32),
    qualification = lines(c.qualification, landscape ? 50 : 45),
    cta = lines(c.cta, landscape ? 24 : 34);
  const headlineSize = landscape ? 79 : 65,
    rewardSize = landscape ? 49 : 43,
    qualificationSize = landscape ? 28 : 26;
  const contentHeight =
    headline.length * (headlineSize + 8) +
    reward.length * (rewardSize + 8) +
    qualification.length * (qualificationSize + 8) +
    75;
  const scale = Math.min(1, (landscape ? 615 : 620) / contentHeight),
    rewardY = 270 + headline.length * (headlineSize + 8) * scale + 30,
    qualY = rewardY + reward.length * (rewardSize + 8) * scale + 25;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(c.merchant)} offer"><rect width="${w}" height="${h}" fill="#0b2630"/><circle cx="${w - 70}" cy="20" r="390" fill="none" stroke="#25434b" stroke-width="2"/><circle cx="${w - 70}" cy="20" r="500" fill="none" stroke="#25434b" stroke-width="2"/><text x="90" y="108" fill="#7de2cb" font-family="Arial,sans-serif" font-size="30" font-weight="700" letter-spacing="4">UPTICK LOCAL${c.is_demo ? " · LOCAL SAMPLE" : ""}</text><text x="90" y="176" fill="#fbf7ef" font-family="Arial,sans-serif" font-size="${c.merchant.length > 40 ? 24 : 34}">${escape(c.merchant)}</text>${headline.map((line, i) => `<text x="85" y="${270 + i * (headlineSize + 8) * scale}" fill="#fbf7ef" font-family="Arial,sans-serif" font-size="${headlineSize * scale}" font-weight="700">${escape(line)}</text>`).join("")}${reward.map((line, i) => `<text x="90" y="${rewardY + i * (rewardSize + 8) * scale}" fill="#f4b75d" font-family="Arial,sans-serif" font-size="${rewardSize * scale}" font-weight="700">${escape(line)}</text>`).join("")}${qualification.map((line, i) => `<text x="90" y="${qualY + i * (qualificationSize + 8) * scale}" fill="#d5dfdb" font-family="Arial,sans-serif" font-size="${qualificationSize * scale}">${escape(line)}</text>`).join("")}${qrInner}${cta.map((line, i) => `<text x="${landscape ? qrX : 90}" y="${(landscape ? qrY + qrSize + 55 : 1010) + i * 36}" fill="#7de2cb" font-family="Arial,sans-serif" font-size="${landscape ? 28 : 24}" font-weight="700">${escape(line)}</text>`).join("")}<text x="90" y="${h - 112}" fill="#d5dfdb" font-family="Arial,sans-serif" font-size="24">No app. No account. Optional marketing.</text><text x="90" y="${h - 73}" fill="#a9bdbb" font-family="Arial,sans-serif" font-size="20">Scan for full terms and current availability. Offer version ${c.offer_version} · creative ${c.version}.</text></svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `${new URL(request.url).searchParams.has("preview") ? "inline" : "attachment"}; filename="uptick-screen-${id}-v${c.version}.svg"`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
