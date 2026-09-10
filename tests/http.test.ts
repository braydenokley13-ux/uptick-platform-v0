import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { appUrl } from "../src/lib/config";
import {
  apiError,
  assertSameOrigin,
  readBody,
  readJsonBody,
  requestIdentity,
  requestRatePolicy,
} from "../src/lib/http";

beforeEach(() => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.UPTICK_LOCAL_MODE = "true";
  delete process.env.VERCEL;
  delete process.env.TRUST_PROXY_IP_HEADERS;
});
const request = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/action", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

test("canonical origins with a trailing slash produce the same pass and callback URLs", () => {
  process.env.APP_URL = "https://uptick.example/";
  assert.equal(appUrl(), "https://uptick.example");
  assert.equal(`${appUrl()}/p/private-credential`, "https://uptick.example/p/private-credential");
  assert.equal(`${appUrl()}/api/twilio/status?message=test`, "https://uptick.example/api/twilio/status?message=test");
  process.env.APP_URL = "http://localhost:3000/";
  assert.equal(appUrl(), "http://localhost:3000");
});

test("body limits count actual bytes when Content-Length is absent or understated", async () => {
  await assert.rejects(readBody(request("x".repeat(33)), 32), /too large/);
  await assert.rejects(
    readBody(request("x".repeat(33), { "content-length": "1" }), 32),
    /too large/,
  );
  await assert.rejects(readBody(request("é".repeat(17)), 32), /too large/);
  assert.equal(await readBody(request("é".repeat(16)), 32), "é".repeat(16));
});
test("JSON mutations reject other content types, malformed input and non-object payloads", async () => {
  await assert.rejects(
    readJsonBody(request("{}", { "content-type": "text/plain" })),
    /as JSON/,
  );
  for (const body of ["{", "null", "[]", "1"])
    await assert.rejects(readJsonBody(request(body)), /Check the fields/);
  assert.deepEqual(await readJsonBody(request('{"action":"login"}')), {
    action: "login",
  });
});
test("mutation origin and browser site metadata must match the canonical application", () => {
  assert.throws(() => assertSameOrigin(request("{}")), /origin/);
  assert.throws(
    () =>
      assertSameOrigin(request("{}", { origin: "https://untrusted.example" })),
    /origin/,
  );
  assert.throws(
    () =>
      assertSameOrigin(
        request("{}", {
          origin: "http://localhost:3000",
          "sec-fetch-site": "cross-site",
        }),
      ),
    /origin/,
  );
  assert.doesNotThrow(() =>
    assertSameOrigin(request("{}", { origin: "http://localhost:3000" })),
  );
});
test("untrusted proxy identity cannot be chosen by an arbitrary client header", () => {
  const req = request("{}", { "x-real-ip": "203.0.113.9" });
  assert.equal(requestIdentity(req), "local");
  process.env.APP_URL = "https://uptick.example";
  assert.equal(requestIdentity(req), "unattributed");
  process.env.TRUST_PROXY_IP_HEADERS = "true";
  assert.equal(requestIdentity(req), "203.0.113.9");
  assert.equal(
    requestIdentity(request("{}", { "x-real-ip": "not-an-address" })),
    "unattributed",
  );
});
test("a missing trusted client IP does not impose one customer limit on all production visitors", () => {
  process.env.APP_URL = "https://uptick.example";
  const req = request("{}", { "x-real-ip": "203.0.113.9" });
  assert.equal(requestRatePolicy(req, "claim").max, 6000);
  assert.equal(requestRatePolicy(req, "login").max, 6000);
  process.env.TRUST_PROXY_IP_HEADERS = "true";
  assert.equal(requestRatePolicy(req, "claim").max, 30);
});
test("unknown SQL, provider and credential errors are never serialized to the browser", async () => {
  const sensitive =
    "postgres://secret:password@database.invalid phone +12125550199 private-pass-token";
  const response = apiError(new Error(sensitive));
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes(sensitive));
  const duplicate = apiError(
    Object.assign(new Error(sensitive), { code: "23505" }),
  );
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), {
    error: "That record already exists.",
  });
  const limited = apiError(
    new Error(
      "Too many attempts. Please wait a few minutes before trying again.",
    ),
  );
  assert.equal(limited.status, 429);
});
