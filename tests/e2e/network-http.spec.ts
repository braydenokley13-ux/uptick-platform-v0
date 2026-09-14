import { randomBytes } from "node:crypto";
import { test, expect, type APIResponse } from "@playwright/test";

const origin = new URL(process.env.APP_URL || "http://localhost:3000").origin;
const routes = [
  "/api/member",
  "/api/network-ops",
  "/api/merchant-growth",
  "/api/tap",
  "/api/acquisition-visit",
  "/api/pilot-promise",
  "/api/pilot-operations",
  "/api/growth-programs",
];
const publicRoutes = ["/api/member", "/api/tap", "/api/acquisition-visit"];
const unknownCredential = () => randomBytes(32).toString("base64url");

async function expectPrivateError(
  response: APIResponse,
  status: number,
  secrets: string[] = [],
) {
  expect(response.status()).toBe(status);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["error"]);
  expect(body.error).toEqual(expect.any(String));
  expect(body.error.length).toBeGreaterThan(0);
  for (const value of secrets)
    expect(JSON.stringify(body)).not.toContain(value);
  expect(JSON.stringify(body)).not.toMatch(
    /postgres(?:ql)?:\/\/|token_hash|token_encrypted|DATABASE_URL|TWILIO_AUTH_TOKEN/,
  );
}

test("network mutations reject missing, foreign and cross-site origins before any action", async ({
  request,
}) => {
  const invalidOrigins: Record<string, string>[] = [
    { origin: "https://untrusted.example" },
    {},
    { origin, "sec-fetch-site": "cross-site" },
  ];
  for (const route of routes) {
    for (const headers of invalidOrigins) {
      const response = await request.post(route, {
        headers,
        data: { action: "membership-dispatch" },
      });
      await expectPrivateError(response, 403);
    }
  }
});

test("member lookup, sender changes and dispatch require operator authentication", async ({
  request,
}) => {
  const phone = "+12015550148";
  for (const action of [
    "member-lookup",
    "membership-sender-save",
    "membership-prepare",
    "membership-dispatch",
    "supply-approve",
  ]) {
    const response = await request.post("/api/network-ops", {
      headers: { origin },
      data: {
        action,
        phone,
        confirmed: true,
        supplyId: "untrusted-supply",
        approved: true,
      },
    });
    await expectPrivateError(response, 401, [phone, "untrusted-supply"]);
  }
  for (const action of ["preferences", "supply"]) {
    const response = await request.post("/api/merchant-growth", {
      headers: { origin },
      data: {
        action,
        organizationId: "untrusted-merchant",
        offerId: "untrusted-offer",
      },
    });
    await expectPrivateError(response, 401, [
      "untrusted-merchant",
      "untrusted-offer",
    ]);
  }
});

test("Tap point management, simulation and redemption override require an operator", async ({
  request,
}) => {
  const passToken = unknownCredential();
  for (const action of [
    "create-point",
    "rotate",
    "revoke",
    "simulate",
    "override",
  ]) {
    const response = await request.post("/api/tap", {
      headers: { origin },
      data: {
        action,
        passToken,
        pointId: "untrusted-point",
        scenario: "qr",
        type: "qr",
        reason: "An unauthenticated override must never work.",
      },
    });
    await expectPrivateError(response, 403, [passToken, "untrusted-point"]);
  }
});

test("public network APIs enforce JSON object bodies and actual byte limits", async ({
  request,
}) => {
  for (const route of publicRoutes) {
    const contentType = await request.post(route, {
      headers: { origin, "content-type": "text/plain" },
      data: '{"action":"join"}',
    });
    await expectPrivateError(contentType, 415);
    for (const body of ["null", "[]", "{"]) {
      const invalid = await request.post(route, {
        headers: { origin, "content-type": "application/json" },
        data: body,
      });
      await expectPrivateError(invalid, 400);
    }
    const oversized = await request.post(route, {
      headers: { origin },
      data: { padding: "x".repeat(17000) },
    });
    await expectPrivateError(oversized, 413);
  }
});

test("joining cannot skip adult attestation or valid ZIP input", async ({
  request,
}) => {
  const phone = "+12015550148";
  for (const input of [
    { phone, homeZip: "10583", consentRequested: false },
    { phone, homeZip: "10583" },
    { phone, homeZip: "1058", consentRequested: true },
    { phone, homeZip: "10583", workZip: "invalid", consentRequested: true },
  ]) {
    const response = await request.post("/api/member", {
      headers: { origin },
      data: { action: "join", ...input },
    });
    await expectPrivateError(response, 400, [phone]);
  }
});

test("unknown membership credentials cannot confirm, claim, share, change preferences or record engagement", async ({
  request,
}) => {
  const token = unknownCredential();
  for (const action of [
    "confirm",
    "preferences",
    "claim",
    "share",
    "view",
    "directions",
  ]) {
    const response = await request.post("/api/member", {
      headers: { origin },
      data: {
        action,
        token,
        acceptMarketing: false,
        homeZip: "10583",
        workZip: "",
        subscribed: true,
        supplyId: "untrusted-supply",
        provider: "google",
      },
    });
    await expectPrivateError(response, action === "confirm" ? 404 : 401, [
      token,
      "untrusted-supply",
    ]);
  }
  for (const action of ["pair", "pass-directions"]) {
    const response = await request.post("/api/member", {
      headers: { origin },
      data: { action, token, provider: "apple" },
    });
    await expectPrivateError(response, 400, [token]);
  }
});

test("a public Tap URL cannot redeem without a private pass or by inventing its credentials", async ({
  request,
}) => {
  const pointToken = unknownCredential();
  const noPass = await request.post("/api/tap", {
    headers: { origin },
    data: { action: "redeem", pointToken, selfConfirm: true },
  });
  await expectPrivateError(noPass, 401, [pointToken]);
  const passToken = unknownCredential();
  const unknownPass = await request.post("/api/tap", {
    headers: { origin },
    data: { action: "redeem", pointToken, passToken, selfConfirm: true },
  });
  await expectPrivateError(unknownPass, 400, [passToken, pointToken]);
  const malformedPass = await request.post("/api/tap", {
    headers: { origin },
    data: { action: "redeem", pointToken, passToken: "not-a-private-pass" },
  });
  await expectPrivateError(malformedPass, 400, [
    pointToken,
    "not-a-private-pass",
  ]);
});

test("unknown acquisition sources cannot record a visit or reveal source context", async ({
  request,
}) => {
  const sourceToken = `http-check-${unknownCredential()}`;
  const missing = await request.post("/api/acquisition-visit", {
    headers: { origin },
    data: { token: sourceToken },
  });
  await expectPrivateError(missing, 404, [sourceToken]);
  const invalid = await request.post("/api/acquisition-visit", {
    headers: { origin },
    data: { token: "x".repeat(101) },
  });
  await expectPrivateError(invalid, 400);
});
