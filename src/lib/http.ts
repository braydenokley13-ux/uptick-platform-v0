import { isIP } from "node:net";
import { z } from "zod";
import { appUrl, localMode } from "./config";

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function assertSameOrigin(request: Request) {
  if (
    request.headers.get("origin") !== new URL(appUrl()).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new RequestError("Request origin is not allowed.", 403);
}

// Content-Length is only an early check. Read the stream with an actual byte limit,
// including when a proxy or client omits or understates that header.
export async function readBody(request: Request, limit = 16384) {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limit)
  )
    throw new RequestError("Request too large.", 413);
  if (!request.body) return "";
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new RequestError("Request too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

export async function readJsonBody(request: Request, limit = 16384) {
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  )
    throw new RequestError("Send this request as JSON.", 415);
  const raw = await readBody(request, limit);
  try {
    return z.record(z.string(), z.unknown()).parse(JSON.parse(raw));
  } catch {
    throw new RequestError("Check the fields and try again.");
  }
}

export function requestIdentity(request: Request) {
  // This opt-in is safe only behind a proxy that overwrites x-real-ip. Otherwise
  // callers use an aggregate bucket rather than choosing their own identity.
  if (process.env.TRUST_PROXY_IP_HEADERS === "true") {
    const address = request.headers.get("x-real-ip")?.trim();
    if (address && isIP(address)) return address;
  }
  return localMode() ? "local" : "unattributed";
}

export function requestRatePolicy(request: Request, action: string) {
  const identity = requestIdentity(request),
    sensitive = action === "claim" || action === "login";
  // An unavailable IP is not one customer. Keep a broad aggregate brake while
  // the domain's phone and sign-in account buckets enforce individual limits.
  return {
    identity,
    max:
      identity === "unattributed"
        ? sensitive
          ? 6000
          : 24000
        : sensitive
          ? 30
          : 120,
  };
}

const publicMessages = new Set([
  "You do not have access to this business.",
  "This offer link is no longer available.",
  "Too many attempts. Please wait a few minutes before trying again.",
  "All passes for this offer have been claimed.",
  "This business is not ready to send passes.",
  "This offer is not accepting new claims right now.",
  "Texts to this number are stopped. Reply START to the Uptick number from your earlier text, then try again.",
  "This pass link is not valid.",
  "This pass cannot be redeemed. Check its status and dates.",
  "Redeem this pass before joining from the redemption screen.",
  "This offer’s redemption limit has been reached.",
  "Enter a valid US mobile number, including area code.",
  "Only Uptick can create an Anchor.",
  "Only Uptick can edit an Anchor.",
  "Complete the offer and terms.",
  "Choose a valid offer window.",
  "Choose a positive whole-number offer limit.",
  "Draft not found.",
  "Business cannot change.",
  "Offer type cannot change.",
  "Published terms cannot be edited. Create a new offer.",
  "Add a business location first.",
  "Offer not found.",
  "Only submitted offers can be approved.",
  "Name the free item in the reward before approving this offer.",
  "Schedule within the offer window and in the future.",
  "Schedule between 9 AM and 8 PM in the business’s time zone.",
  "This business already has a Weekly Drop scheduled or sent for that week.",
  "Choose an existing offer and host location.",
  "This location is not configured as a host.",
  "Choose a different host business for local acquisition.",
  "Direct competitor — blocked. Choose a host in a different business category.",
  "Placement not found.",
  "Only an offer awaiting review can be returned or rejected.",
  "Add a clear placement handoff note.",
  "This creative already has a replacement. Open the latest creative source to make another version.",
  "Add a clear note for the merchant.",
  "Source not found.",
  "Submit or publish this offer before preparing screen creative.",
  "Sign-in failed. Check your email and password.",
  "Your account has not been assigned business access.",
  "Unknown action.",
  "Unknown operator action.",
  "This business is not ready to accept customer claims. Please try again later.",
  "Complete production platform and merchant sender setup before approving this offer.",
]);

export function apiError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  let status = 500,
    message = "Something went wrong. Please try again.";
  if (error instanceof RequestError) {
    status = error.status;
    message = error.message;
  } else if (error instanceof z.ZodError || error instanceof SyntaxError) {
    status = 400;
    message = "Check the fields and try again.";
  } else if (code === "23505") {
    status = 409;
    message = "That record already exists.";
  } else if (code === "23503" || code === "23514") {
    status = 400;
    message = "Check the selected records and try again.";
  } else if (error instanceof Error && publicMessages.has(error.message)) {
    message = error.message;
    status = message.startsWith("Too many attempts.")
      ? 429
      : message === "You do not have access to this business."
        ? 403
        : 400;
  }
  // Do not serialize database errors, provider payloads, phone input or bearer credentials.
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
