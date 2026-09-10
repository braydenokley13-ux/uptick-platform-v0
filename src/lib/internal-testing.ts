import twilio from "twilio";
import type { DB } from "./db";
import {
  authorize,
  offerSelect,
  rateLimit,
  type Actor,
  type Offer,
} from "./domain";
import { businessReadiness } from "./launch";
import { appUrl, localMode } from "./config";
import { id, token, hash, encrypt, decrypt, normalizePhone } from "./security";
import { RequestError } from "./http";
import { internalTestMessage } from "./testing-copy";
export { internalTestMessage } from "./testing-copy";

export type InternalTestSnapshot = {
  merchant: string;
  title: string;
  qualification: string;
  reward: string;
  terms: string;
  starts_at: string;
  expires_at: string;
  address: string;
  timezone: string;
  is_demo: boolean;
};
export type InternalTestRun = {
  id: string;
  organization_id: string;
  offer_id: string;
  offer_version: number;
  actor_id: string;
  request_key: string;
  test_kind: "anchor" | "drop";
  sender_id: string | null;
  service_sid: string | null;
  phone_encrypted: string;
  phone_hash: string;
  phone_suffix: string;
  token_hash: string;
  token_encrypted: string;
  snapshot: InternalTestSnapshot;
  transport: "development" | "twilio";
  send_state: string;
  provider_sid: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  opened_at: string | null;
  redeemed_at: string | null;
};
export type InternalTestInput = {
  organizationId: string;
  offerId: string;
  kind: "anchor" | "drop";
  phone: string;
  requestKey: string;
  confirmed: true;
};
export type InternalTestProvider = (input: {
  to: string;
  messagingServiceSid: string;
  body: string;
  statusCallback: string;
}) => Promise<{ sid: string }>;
const provider: InternalTestProvider = (input) =>
  twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, {
    autoRetry: false,
    timeout: 15000,
  }).messages.create(input);

export function internalTestAllowlist() {
  const numbers = (process.env.INTERNAL_TEST_NUMBERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [
    ...new Set(
      numbers.flatMap((value) => {
        try {
          return [normalizePhone(value)];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
function approvedNumber(input: string) {
  const phone = normalizePhone(input);
  if (!internalTestAllowlist().includes(phone))
    throw new RequestError(
      "This number is not approved for internal tests. Ask the infrastructure owner to update INTERNAL_TEST_NUMBERS.",
      403,
    );
  return phone;
}
function operator(actor: Actor) {
  authorize(actor, actor.organizationId, true);
}
function safeRun(run: InternalTestRun) {
  return {
    id: run.id,
    organizationId: run.organization_id,
    offerId: run.offer_id,
    offerVersion: run.offer_version,
    kind: run.test_kind,
    merchant: run.snapshot.merchant,
    title: run.snapshot.title,
    phoneSuffix: run.phone_suffix,
    transport: run.transport,
    state: run.send_state,
    providerSid: run.provider_sid,
    errorCode: run.error_code,
    createdAt: run.created_at,
    expiresAt: run.expires_at,
    openedAt: run.opened_at,
    redeemedAt: run.redeemed_at,
    passUrl: `/t/${decrypt(run.token_encrypted)}`,
  };
}
export async function createInternalTest(
  db: DB,
  actor: Actor,
  input: InternalTestInput,
  send: InternalTestProvider = provider,
) {
  operator(actor);
  if (input.confirmed !== true)
    throw new RequestError(
      "Confirm that the approved tester requested this internal message.",
    );
  if (
    !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey) ||
    !["anchor", "drop"].includes(input.kind)
  )
    throw new RequestError("Check the test request and try again.");
  const phone = approvedNumber(input.phone);
  const [existing] = await db.query<InternalTestRun>(
    "select * from internal_test_runs where actor_id=$1 and request_key=$2",
    [actor.id, input.requestKey],
  );
  if (existing) {
    if (
      existing.organization_id !== input.organizationId ||
      existing.offer_id !== input.offerId ||
      existing.phone_hash !== hash(phone) ||
      existing.test_kind !== input.kind
    )
      throw new RequestError(
        "This test request was already used for different details.",
        409,
      );
    return safeRun(existing);
  }
  await rateLimit(db, `internal-test:${actor.id}`, 20, 3600);
  await rateLimit(db, `internal-test-phone:${hash(phone)}`, 8, 3600);
  const development = localMode() && process.env.SMS_TRANSPORT !== "twilio";
  const prepared = await db.transaction(async (tx) => {
    await tx.query("select id from offers where id=$1 for update", [
      input.offerId,
    ]);
    const [duplicate] = await tx.query<InternalTestRun>(
      "select * from internal_test_runs where actor_id=$1 and request_key=$2",
      [actor.id, input.requestKey],
    );
    if (duplicate) {
      if (
        duplicate.organization_id !== input.organizationId ||
        duplicate.offer_id !== input.offerId ||
        duplicate.phone_hash !== hash(phone) ||
        duplicate.test_kind !== input.kind
      )
        throw new RequestError(
          "This test request was already used for different details.",
          409,
        );
      return { run: duplicate, created: false };
    }
    const [offer] = await tx.query<Offer>(
      `${offerSelect} where o.id=$1 and o.organization_id=$2 and 'merchant'=any(g.capabilities)`,
      [input.offerId, input.organizationId],
    );
    if (!offer)
      throw new RequestError(
        "Choose a saved offer from the selected merchant.",
      );
    if (offer.kind !== input.kind)
      throw new RequestError("Choose an offer whose type matches this test.");
    if (
      !development &&
      !(await businessReadiness(tx, offer.organization_id)).readyToAcceptClaims
    )
      throw new RequestError(
        "Production test sending needs a real merchant, its approved sender, and all platform readiness checks.",
      );
    const [sender] = await tx.query<{ id: string; service_sid: string }>(
      "select id,service_sid from senders where organization_id=$1",
      [offer.organization_id],
    );
    if (
      sender &&
      (
        await tx.query(
          "select 1 from suppressions where phone=$1 and sender_id=$2 and suppressed",
          [phone, sender.id],
        )
      ).length
    )
      throw new RequestError(
        "This internal number has stopped texts from this sender. The tester must reply START first.",
      );
    const credential = token(),
      testId = id();
    const snapshot: InternalTestSnapshot = {
      merchant: offer.merchant,
      title: offer.title,
      qualification: offer.qualification,
      reward: offer.reward,
      terms: offer.terms,
      starts_at: offer.starts_at,
      expires_at: offer.expires_at,
      address: offer.address,
      timezone: offer.timezone,
      is_demo: offer.is_demo,
    };
    const [run] = await tx.query<InternalTestRun>(
      `insert into internal_test_runs(id,organization_id,offer_id,offer_version,actor_id,request_key,test_kind,sender_id,service_sid,phone_encrypted,phone_hash,phone_suffix,token_hash,token_encrypted,snapshot,transport,send_state) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
      [
        testId,
        offer.organization_id,
        offer.id,
        offer.current_version,
        actor.id,
        input.requestKey,
        input.kind,
        sender?.id || null,
        sender?.service_sid || null,
        encrypt(phone),
        hash(phone),
        phone.slice(-4),
        hash(credential),
        encrypt(credential),
        snapshot,
        development ? "development" : "twilio",
        development ? "development" : "submitting",
      ],
    );
    await tx.query(
      "insert into internal_test_events(id,test_id,kind) values($1,$2,'created')",
      [id(), testId],
    );
    return { run, created: true };
  });
  const run = prepared.run;
  if (!prepared.created || development) return safeRun(run);
  // The durable submitting record is committed before any provider request. No retry path exists.
  const ready = await businessReadiness(db, run.organization_id);
  const [currentSender] = await db.query<{ service_sid: string }>(
    "select service_sid from senders where id=$1 and organization_id=$2",
    [run.sender_id, run.organization_id],
  );
  const suppressed =
    (
      await db.query(
        "select 1 from suppressions where phone=$1 and sender_id=$2 and suppressed",
        [phone, run.sender_id],
      )
    ).length > 0;
  if (
    !ready.readyToAcceptClaims ||
    currentSender?.service_sid !== run.service_sid ||
    !internalTestAllowlist().includes(phone) ||
    suppressed
  ) {
    await db.query(
      "update internal_test_runs set send_state='suppressed',error_code=$2,updated_at=now() where id=$1 and send_state='submitting'",
      [run.id, suppressed ? "sender_opt_out" : "readiness_changed"],
    );
  } else {
    try {
      const sent = await send({
        to: phone,
        messagingServiceSid: run.service_sid!,
        body: internalTestMessage(
          run.snapshot,
          run.test_kind,
          `${new URL(appUrl()).origin}/t/${decrypt(run.token_encrypted)}`,
        ),
        statusCallback: `${new URL(appUrl()).origin}/api/twilio-test?test=${run.id}`,
      });
      if (!/^SM[0-9a-fA-F]{32}$/.test(sent.sid))
        throw Error("Unexpected provider result.");
      await db.query(
        "update internal_test_runs set provider_sid=$2,send_state=case when send_state='submitting' then 'provider_accepted' else send_state end,updated_at=now() where id=$1",
        [run.id, sent.sid],
      );
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const definitive =
        typeof status === "number" && status >= 400 && status < 500;
      const code = (error as { code?: number })?.code;
      await db.query(
        "update internal_test_runs set send_state=$2,error_code=$3,updated_at=now() where id=$1 and send_state='submitting'",
        [
          run.id,
          definitive ? "failed" : "unknown",
          typeof code === "number"
            ? String(code)
            : "provider_outcome_uncertain",
        ],
      );
    }
  }
  const [saved] = await db.query<InternalTestRun>(
    "select * from internal_test_runs where id=$1",
    [run.id],
  );
  return safeRun(saved);
}

export async function recentInternalTests(db: DB, actor: Actor) {
  operator(actor);
  await db.query(
    "update internal_test_runs set send_state='unknown',error_code='worker_interrupted',updated_at=now() where send_state='submitting' and updated_at<now()-interval '5 minutes'",
  );
  return (
    await db.query<InternalTestRun>(
      "select * from internal_test_runs order by created_at desc limit 40",
    )
  ).map(safeRun);
}
export async function getInternalTestPass(db: DB, credential: string) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(credential))
    throw new RequestError("This internal test pass is not valid.", 404);
  const [run] = await db.query<InternalTestRun>(
    "select * from internal_test_runs where token_hash=$1",
    [hash(credential)],
  );
  if (!run)
    throw new RequestError("This internal test pass is not valid.", 404);
  return run;
}
export async function recordInternalTestPassAction(
  db: DB,
  credential: string,
  action: "open" | "redeem",
) {
  if (!["open", "redeem"].includes(action))
    throw new RequestError("Choose a valid test action.");
  const pass = await getInternalTestPass(db, credential);
  return db.transaction(async (tx) => {
    const [run] = await tx.query<InternalTestRun>(
      "select * from internal_test_runs where id=$1 for update",
      [pass.id],
    );
    if (action === "redeem" && run.redeemed_at)
      return { redeemedAt: run.redeemed_at, openedAt: run.opened_at };
    if (new Date(run.expires_at) <= new Date())
      throw new RequestError(
        "This internal test pass has expired. Ask Uptick to create a new rehearsal.",
      );
    await tx.query(
      "update internal_test_runs set opened_at=coalesce(opened_at,now()),updated_at=now() where id=$1",
      [run.id],
    );
    await tx.query(
      "insert into internal_test_events(id,test_id,kind) values($1,$2,'opened') on conflict do nothing",
      [id(), run.id],
    );
    if (action === "redeem") {
      await tx.query(
        "update internal_test_runs set redeemed_at=coalesce(redeemed_at,now()),updated_at=now() where id=$1",
        [run.id],
      );
      await tx.query(
        "insert into internal_test_events(id,test_id,kind) values($1,$2,'redeemed') on conflict do nothing",
        [id(), run.id],
      );
    }
    const [saved] = await tx.query<InternalTestRun>(
      "select * from internal_test_runs where id=$1",
      [run.id],
    );
    return { redeemedAt: saved.redeemed_at, openedAt: saved.opened_at };
  });
}
const statusRank: Record<string, number> = {
  submitting: 0,
  unknown: 0,
  provider_accepted: 1,
  sent: 2,
  failed: 3,
  undelivered: 3,
  delivered: 4,
};
export async function internalTestStatus(
  db: DB,
  testId: string,
  sid: string,
  status: string,
  errorCode?: string,
) {
  if (!/^SM[0-9a-fA-F]{32}$/.test(sid))
    throw new RequestError("Invalid provider message.", 400);
  if (
    ![
      "accepted",
      "queued",
      "sending",
      "sent",
      "failed",
      "undelivered",
      "delivered",
    ].includes(status)
  )
    return;
  const state = ["accepted", "queued", "sending"].includes(status)
    ? "provider_accepted"
    : status;
  await db.transaction(async (tx) => {
    const [run] = await tx.query<InternalTestRun>(
      "select * from internal_test_runs where id=$1 for update",
      [testId],
    );
    if (
      !run ||
      run.transport !== "twilio" ||
      !(run.send_state in statusRank) ||
      (run.provider_sid && run.provider_sid !== sid)
    )
      throw new RequestError("Unknown test message.", 400);
    const code = errorCode && /^\d{1,8}$/.test(errorCode) ? errorCode : null;
    const added = await tx.query(
      "insert into internal_test_events(id,test_id,kind,provider_sid,state,error_code) values($1,$2,'callback',$3,$4,$5) on conflict(provider_sid,state) do nothing returning id",
      [id(), run.id, sid, state, code],
    );
    if (!added.length) return;
    if (statusRank[state] > statusRank[run.send_state])
      await tx.query(
        "update internal_test_runs set send_state=$2,provider_sid=$3,error_code=$4,updated_at=now() where id=$1",
        [run.id, state, sid, code],
      );
    else if (!run.provider_sid)
      await tx.query(
        "update internal_test_runs set provider_sid=$2 where id=$1",
        [run.id, sid],
      );
  });
}
