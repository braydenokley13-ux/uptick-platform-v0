import { NextRequest, NextResponse } from "next/server";
import {
  cloudDemoMode,
  assertCloudDemoEnvironment,
} from "./lib/cloud-demo-guard";

export function proxy(request: NextRequest) {
  if (!cloudDemoMode()) return NextResponse.next();
  let origin: string;
  try {
    origin = assertCloudDemoEnvironment().origin;
  } catch {
    return new NextResponse("Cloud demo configuration is unavailable.", {
      status: 503,
    });
  }
  const path = request.nextUrl.pathname;
  const noStore = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (request.nextUrl.origin !== origin)
    return new NextResponse("Use the canonical demo website.", {
      status: 421,
      headers: noStore,
    });
  if (
    /^\/api\/(cron|twilio|twilio-test|member-twilio|account)(\/|$)/.test(
      path,
    ) ||
    path.startsWith("/account/")
  )
    return new NextResponse("Not found", { status: 404, headers: noStore });
  const open =
    path === "/" ||
    path === "/demo" ||
    path === "/api/demo/cloud" ||
    path.startsWith("/_next/") ||
    path === "/favicon.ico" ||
    path === "/robots.txt";
  if (
    !open &&
    !/^[A-Za-z0-9_-]{43}$/.test(
      request.cookies.get("__Host-uptick-demo")?.value || "",
    )
  ) {
    if (path.startsWith("/api/"))
      return NextResponse.json(
        { error: "Unlock Demo Studio first." },
        { status: 401, headers: noStore },
      );
    return NextResponse.redirect(new URL("/demo", origin));
  }
  // This is only an early gate. getDb revalidates the opaque lease against the
  // database on every data operation, including RSC and direct API requests.
  return NextResponse.next({ headers: noStore });
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
