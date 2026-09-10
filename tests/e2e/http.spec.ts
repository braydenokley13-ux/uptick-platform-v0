import { test, expect } from "@playwright/test";

const origin = new URL(process.env.APP_URL || "http://localhost:3000").origin;
test("mutation endpoints reject another site before any business action", async ({
  request,
}) => {
  for (const route of ["/api/action", "/api/studio", "/api/operator-action"]) {
    const response = await request.post(route, {
      headers: { origin: "https://untrusted.example" },
      data: { action: "login" },
    });
    expect(response.status()).toBe(403);
  }
});
test("public actions require JSON and enforce the actual body limit", async ({
  request,
}) => {
  const content = await request.post("/api/action", {
    headers: { origin, "content-type": "text/plain" },
    data: '{"action":"claim"}',
  });
  expect(content.status()).toBe(415);
  const large = await request.post("/api/action", {
    headers: { origin },
    data: { action: "claim", padding: "x".repeat(17000) },
  });
  expect(large.status()).toBe(413);
  const invalid = await request.post("/api/action", {
    headers: { origin, "content-type": "application/json" },
    data: "null",
  });
  expect(invalid.status()).toBe(400);
});
test("private exports, QR downloads and operator changes need a signed-in role", async ({
  request,
}) => {
  expect((await request.get("/api/export")).status()).toBe(403);
  expect((await request.get("/api/qr/example-source")).status()).toBe(403);
  expect(
    (
      await request.post("/api/operator-action", {
        headers: { origin },
        data: { action: "customer-lookup" },
      })
    ).status(),
  ).toBe(401);
});
test("scheduler and provider callbacks reject unsigned requests", async ({
  request,
}) => {
  expect((await request.get("/api/cron")).status()).toBe(401);
  expect(
    (
      await request.post("/api/twilio/inbound", {
        form: { AccountSid: "ACinvalid", MessageSid: "SMinvalid" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.post("/api/twilio/unknown", { form: {} })).status(),
  ).toBe(404);
});
