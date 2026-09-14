import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { marketWeekWindow } from "../src/lib/network";

const origin = process.env.APP_URL || "";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
assert.ok(
  process.env.LOCAL_DATABASE_PATH?.startsWith(
    "/private/tmp/uptick-browser-rehearsal-",
  ),
);
assert.equal(process.env.DATABASE_URL, undefined);
const fixture = JSON.parse(
  await readFile(
    resolve(process.env.LOCAL_DATABASE_PATH!, "browser-fixture.json"),
    "utf8",
  ),
);
async function post(route: string, body: object, cookie = "") {
  const response = await fetch(origin + route, {
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  assert.ok(
    response.ok,
    `${route}: ${response.status} ${result.error || "request failed"}`,
  );
  return { response, result };
}
const login = await post("/api/action", { action: "login", mode: "operator" });
const operatorCookie = login.response.headers.get("set-cookie")!.split(";")[0];
const assignments = fixture.members.map((member: { id: string }) => ({
  memberId: member.id,
  supplyId: fixture.supplyId,
}));
const releaseBody = {
  action: "release_week",
  runId: fixture.runId,
  marketId: fixture.marketId,
  dataKind: "synthetic",
  weekKey: fixture.weekKey,
  requestKey: `http:${fixture.runId}:${fixture.weekKey}`,
  assignments,
};
const [first, duplicate] = await Promise.all([
  post("/api/pilot-promise", releaseBody, operatorCookie),
  post("/api/pilot-promise", releaseBody, operatorCookie),
]);
assert.equal(
  first.result.result.release.id,
  duplicate.result.result.release.id,
);
assert.equal(first.result.result.grants.length, 3);
console.log(
  "PASS HTTP: competing release requests return one complete 3-member release.",
);
const until = new Date(
  marketWeekWindow(new Date(), "America/New_York").end.getTime() + 3600000,
).toISOString();
for (let index = 0; index < 2; index++) {
  const memberId = fixture.members[index].id;
  const invitation = await post("/api/member", {
    action: "join",
    phone: `+1212${5560000 + index}`,
    homeZip: "10001",
    ageAttested: true,
    consentRequested: false,
  });
  assert.equal(invitation.result.development, true);
  const confirmation = await post("/api/member", {
    action: "confirm",
    token: invitation.result.privateUrl.split("/").pop(),
    acceptMarketing: false,
  });
  const sessionHeader = confirmation.response.headers.get("set-cookie")!;
  assert.match(sessionHeader, /httponly/i);
  const cookie = sessionHeader.split(";")[0];
  const grant = first.result.result.grants.find(
    (g: { member_id: string }) => g.member_id === memberId,
  );
  const claimed = await post(
    "/api/member",
    { action: "claim", supplyId: fixture.supplyId },
    cookie,
  );
  const passToken = claimed.result.redirect.split("/").pop();
  if (index === 1)
    await post(
      "/api/tap",
      { action: "redeem", passToken, pointToken: fixture.pointToken },
      cookie,
    );
  const incidentBody = {
    action: "incident",
    grantId: grant.id,
    incidentType: "out_of_stock",
    message: "Synthetic counter rehearsal: primary item unavailable.",
    idempotencyKey: `http-incident-${memberId}`,
  };
  const incident = await post("/api/member", incidentBody, cookie);
  const incidentAgain = await post("/api/member", incidentBody, cookie);
  assert.equal(incident.result.incidentId, incidentAgain.result.incidentId);
  // A failure restricts the counter. Explicitly record restored readiness and
  // usable independent fallback before promising the remedy.
  const now = new Date(Date.now() - 1000).toISOString();
  await post(
    "/api/pilot-promise",
    {
      action: "save_readiness",
      supplyId: fixture.supplyId,
      state: "ready",
      ownerApprovedBy: "Synthetic operator",
      primaryManager: "Synthetic manager",
      primaryContact: "manager@example.test",
      backupContact: "backup@example.test",
      stockConfirmedAt: now,
      exactItemConfirmed: true,
      staffInstructionsConfirmed: true,
      shiftsBriefedAt: now,
      validHoursConfirmed: true,
      qrRehearsedAt: now,
      supportEscalation: "Synthetic operator at counter",
      validUntil: until,
    },
    operatorCookie,
  );
  const recoveryBody = {
    action: "issue_recovery",
    incidentId: incident.result.incidentId,
    remedyType: "same_counter",
    fallbackId: fixture.fallbackId,
    replacementSupplyId: null,
    payerOrganizationId: fixture.actor.organizationId,
    payerEvidence: "Synthetic manager approved the reserved substitute.",
    expiresAt: until,
  };
  const recovery = await post(
    "/api/pilot-promise",
    recoveryBody,
    operatorCookie,
  );
  const recoveryAgain = await post(
    "/api/pilot-promise",
    recoveryBody,
    operatorCookie,
  );
  assert.equal(recovery.result.result.id, recoveryAgain.result.result.id);
  const redeemed = await post(
    "/api/tap",
    { action: "redeem", passToken, pointToken: fixture.pointToken },
    cookie,
  );
  assert.equal(redeemed.result.reward, "Synthetic bottled drink");
  const repeat = await post(
    "/api/tap",
    { action: "redeem", passToken, pointToken: fixture.pointToken },
    cookie,
  );
  assert.equal(repeat.result.redeemedAt, redeemed.result.redeemedAt);
  console.log(
    `PASS HTTP: ${index === 0 ? "before" : "after"} original redemption, exact-pass incident and backed recovery are idempotent.`,
  );
}
const status = await fetch(origin + "/operator/pilot", {
  headers: { cookie: operatorCookie },
});
assert.equal(status.status, 200);
console.log(
  "PASS HTTP: operator Today renders after recovery; real project untouched; no real SMS.",
);
