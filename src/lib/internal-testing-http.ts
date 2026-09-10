import twilio from "twilio";
import { z } from "zod";
import type { DB } from "./db";
import type { Actor } from "./domain";
import { rateLimit } from "./domain";
import { hash } from "./security";
import { appUrl } from "./config";
import {
  assertSameOrigin,
  readJsonBody,
  readBody,
  RequestError,
  apiError,
} from "./http";
import {
  createInternalTest,
  recordInternalTestPassAction,
  internalTestStatus,
} from "./internal-testing";

export async function handleInternalTestRequest(
  request: Request,
  actor: Actor | null,
  db: DB,
) {
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    if (body.action === "create") {
      if (!actor) throw new RequestError("Please sign in to continue.", 401);
      const input = z
        .object({
          organizationId: z.string().min(1).max(80),
          offerId: z.string().min(1).max(80),
          kind: z.enum(["anchor", "drop"]),
          phone: z.string().min(5).max(40),
          requestKey: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
          confirmed: z.literal(true),
        })
        .parse(body);
      return Response.json(
        { ok: true, test: await createInternalTest(db, actor, input) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const input = z
      .object({
        action: z.enum(["open", "redeem"]),
        token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
      })
      .parse(body);
    await rateLimit(db, `internal-test-pass:${hash(input.token)}`, 120, 3600);
    return Response.json(
      {
        ok: true,
        ...(await recordInternalTestPassAction(db, input.token, input.action)),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function verifyInternalTestWebhook(request: Request) {
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/x-www-form-urlencoded"
  )
    throw new RequestError("Unsupported content type.", 415);
  const url = new URL(request.url),
    fields = Object.fromEntries(new URLSearchParams(await readBody(request)));
  const canonical = `${appUrl().replace(/\/$/, "")}/api/twilio-test${url.search}`;
  if (
    !process.env.TWILIO_AUTH_TOKEN ||
    !twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      request.headers.get("x-twilio-signature") || "",
      canonical,
      fields,
    ) ||
    fields.AccountSid !== process.env.TWILIO_ACCOUNT_SID
  )
    throw new RequestError("Invalid provider signature or account.", 403);
  const testId = url.searchParams.get("test") || "";
  if (!/^[a-f0-9]{24}$/.test(testId))
    throw new RequestError("Invalid test reference.");
  return { testId, fields };
}
export async function handleInternalTestWebhook(request: Request, db: DB) {
  try {
    const { testId, fields } = await verifyInternalTestWebhook(request);
    await internalTestStatus(
      db,
      testId,
      fields.MessageSid,
      fields.MessageStatus,
      fields.ErrorCode,
    );
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return new Response("Test callback could not be processed.", {
      status: error instanceof RequestError ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
