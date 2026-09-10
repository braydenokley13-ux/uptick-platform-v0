import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import {
  acceptClaim,
  approve,
  authorize,
  confirmPossession,
  confirmPassChoices,
  getClaimChoices,
  createEntitlement,
  getPass,
  isQuietHours,
  joinMerchantDrop,
  offerSelect,
  passState,
  pauseOffer,
  preferences,
  queueMessage,
  rateLimit,
  redeem,
  saveDraft,
  weekKey,
  type Actor,
  type Claim,
  type DraftInput,
  type Offer,
} from "../src/lib/domain";
import {
  dispatch,
  eligibility,
  expandDueBroadcasts,
  inbound,
  statusCallback,
  type Message,
} from "../src/lib/messaging";
import {
  decrypt,
  encrypt,
  equal,
  normalizePhone,
  token,
} from "../src/lib/security";
import { localMode, messagingReady } from "../src/lib/config";

process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
delete process.env.VERCEL;

let db: DB;
const merchant: Actor = {
  id: "merchant-a",
  role: "merchant",
  organizationId: "a",
};
const operator: Actor = {
  id: "operator",
  role: "operator",
  organizationId: "a",
};
const phoneA = "+12125550101",
  phoneB = "+12125550102",
  phoneC = "+12125550103";
let serial = 0;
const providerSid = () => `SM${(++serial).toString(16).padStart(32, "0")}`;
const serviceA = `MG${"a".repeat(32)}`,
  serviceB = `MG${"b".repeat(32)}`;

before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db?.close?.();
});
beforeEach(async () => {
  process.env.UPTICK_LOCAL_MODE = "true";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SMS_TRANSPORT = "development";
  delete process.env.VERCEL;
  await db.query("truncate organizations cascade");
  await db.query("truncate rate_limits");
  for (const org of ["a", "b"]) {
    await db.query("insert into organizations(id,name) values($1,$2)", [
      org,
      `Business ${org.toUpperCase()}`,
    ]);
    await db.query(
      "insert into locations(id,organization_id,name,address) values($1,$2,$3,$4)",
      [`${org}-location`, org, "Main", "123 Test Street"],
    );
    await db.query(
      "insert into senders(id,organization_id,service_sid,phone) values($1,$2,$3,$4)",
      [
        `${org}-sender`,
        org,
        org === "a" ? serviceA : serviceB,
        org === "a" ? "+12125550901" : "+12125550902",
      ],
    );
  }
  await addOffer("anchor-a", "a");
  await addOffer("anchor-b", "b");
});

async function addOffer(
  offerId: string,
  org = "a",
  options: {
    state?: string;
    kind?: "anchor" | "drop";
    mode?: "unlimited" | "claim" | "redemption";
    quantity?: number;
    starts?: Date;
    expires?: Date;
  } = {},
) {
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,$4,$5,$6)",
    [
      offerId,
      org,
      `${org}-location`,
      options.kind || "anchor",
      options.state || "live",
      offerId,
    ],
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity) values($1,1,$2,$3,$4,$5,$6,$7,$8)",
    [
      offerId,
      "Buy a sandwich",
      "Get a free coffee",
      "One per customer. Show the cashier.",
      (options.starts || new Date(Date.now() - 86400000)).toISOString(),
      (options.expires || new Date(Date.now() + 90 * 86400000)).toISOString(),
      options.mode || "unlimited",
      options.quantity || null,
    ],
  );
  await db.query(
    "insert into sources(id,token,offer_id,campaign,creative) values($1,$2,$3,$4,$5)",
    [
      `${offerId}-source`,
      `${offerId}-token`,
      offerId,
      "Test placement campaign",
      "Creative 1",
    ],
  );
}
async function claim(
  offerId = "anchor-a",
  phone = phoneA,
  merchantConsent = false,
  networkConsent = false,
) {
  return acceptClaim(db, {
    sourceToken: `${offerId}-token`,
    phone,
    merchantConsent,
    networkConsent,
  });
}
async function rows<T = Record<string, unknown>>(
  table: string,
  where = "",
  params: unknown[] = [],
) {
  return db.query<T>(`select * from ${table} ${where}`, params);
}
async function count(table: string, where = "", params: unknown[] = []) {
  const [r] = await db.query<{ n: number }>(
    `select count(*)::int n from ${table} ${where}`,
    params,
  );
  return r.n;
}
function nextSend() {
  const d = new Date(Date.now() + 8 * 86400000);
  d.setUTCHours(16, 0, 0, 0);
  return d;
}
function draft(overrides: Partial<DraftInput> = {}): DraftInput {
  const starts = new Date(Date.now() + 86400000),
    expires = new Date(Date.now() + 30 * 86400000);
  return {
    organizationId: "a",
    title: "Breakfast Drop",
    qualification: "Buy breakfast",
    reward: "Get a free coffee",
    terms: "One per customer.",
    startsAt: starts.toISOString(),
    expiresAt: expires.toISOString(),
    limitMode: "unlimited",
    submit: true,
    ...overrides,
  };
}
async function makeDropMessage(
  claimed: Claim,
  offerId = "drop-a",
  timezone = "America/New_York",
  now = new Date(),
) {
  await db.query("update organizations set timezone=$2 where id=$1", [
    claimed.organization_id,
    timezone,
  ]);
  await addOffer(offerId, claimed.organization_id, { kind: "drop" });
  const broadcastId = `${offerId}-broadcast`;
  await db.query(
    "insert into broadcasts(id,offer_id,organization_id,scheduled_at,week_key,state,approved_by) values($1,$2,$3,$4,$5,'queued',$6)",
    [
      broadcastId,
      offerId,
      claimed.organization_id,
      now.toISOString(),
      weekKey(now, timezone),
      "operator",
    ],
  );
  const [offer] = await db.query<Offer>(`${offerSelect} where o.id=$1`, [
    offerId,
  ]);
  await db.transaction(async (tx) => {
    const pass = await createEntitlement(
      tx,
      offer,
      claimed.customer_id,
      null,
      { broadcast_id: broadcastId },
      broadcastId,
    );
    await queueMessage(tx, pass, "merchant", broadcastId);
  });
  const [message] = await rows<Message>("messages", "where broadcast_id=$1", [
    broadcastId,
  ]);
  return message;
}

test("private credentials use authenticated encryption and strict bearer lookup", async () => {
  assert.equal(normalizePhone("(212) 555-0101"), phoneA);
  assert.throws(() => normalizePhone("123"));
  assert.throws(() => normalizePhone("+442079460123"));
  const secret = token(),
    encrypted = encrypt(secret);
  assert.equal(secret.length, 43);
  assert.equal(decrypt(encrypted), secret);
  assert.notEqual(encrypt(secret), encrypted);
  const bytes = Buffer.from(encrypted, "base64url");
  bytes[15] ^= 1;
  assert.throws(() => decrypt(bytes.toString("base64url")));
  assert.throws(() => decrypt("abc"));
  assert.equal(equal("é", "aa"), false);
  assert.equal(equal("same", "same"), true);
  const accepted = await claim();
  assert.equal(
    (await getPass(db, decrypt(accepted.token_encrypted))).id,
    accepted.id,
  );
  await assert.rejects(getPass(db, accepted.id), /not valid/);
  await assert.rejects(getPass(db, token()), /not valid/);
  assert.equal(
    await count("relationships", "where possession_confirmed_at is not null"),
    0,
    "A read or link preview is not possession confirmation.",
  );
});

test("duplicate concurrent claims issue one durable pass, one relationship, and one delivery job", async () => {
  const accepted = await Promise.all([claim(), claim()]);
  assert.equal(accepted[0].id, accepted[1].id);
  assert.equal(await count("claims"), 1);
  assert.equal(await count("relationships"), 1);
  assert.equal(await count("messages"), 1);
  assert.equal(await count("audit_events", "where action='claim.accepted'"), 1);
  assert.equal(accepted[0].snapshot.origin.creative, "Creative 1");
  assert.equal(await count("subscriptions"), 0);
  assert.equal(
    await count("consent_events"),
    4,
    "The first claim records all choices; a public retry records only its fulfillment request.",
  );
});

test("the claim quantity cap remains intact when two people claim the final pass", async () => {
  await addOffer("limited", "a", { mode: "claim", quantity: 1 });
  const results = await Promise.allSettled([
    claim("limited", phoneA),
    claim("limited", phoneB),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await count("claims", "where offer_id='limited'"), 1);
  assert.equal(
    await count("customers"),
    1,
    "The rejected claim transaction rolls back its customer record.",
  );
});

test("concurrent redemption is idempotent and records exactly one completion", async () => {
  const accepted = await claim(),
    credential = decrypt(accepted.token_encrypted);
  const results = await Promise.all([
    redeem(db, credential),
    redeem(db, credential),
  ]);
  assert.ok(results.every((r) => r.state === "redeemed"));
  assert.equal(results[0].id, results[1].id);
  assert.equal(await count("redemptions"), 1);
  assert.equal(
    await count("audit_events", "where action='redemption.completed'"),
    1,
  );
  assert.equal(
    passState(
      {
        ...accepted,
        snapshot: { ...accepted.snapshot, expires_at: "2030-01-01T00:00:00Z" },
      },
      new Date("2030-01-01T00:00:00Z"),
    ),
    "expired",
  );
});

test("redemption cap gives the final available redemption to exactly one customer", async () => {
  await addOffer("limited-redemption", "a", {
    mode: "redemption",
    quantity: 1,
  });
  const passes = await Promise.all([
    claim("limited-redemption", phoneA),
    claim("limited-redemption", phoneB),
  ]);
  const results = await Promise.allSettled(
    passes.map((c) => redeem(db, decrypt(c.token_encrypted))),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await count("redemptions"), 1);
  assert.equal(await count("claims", "where state='active'"), 1);
});

test("tenant checks reject cross-business writes in both domain and database", async () => {
  assert.throws(() => authorize(merchant, "b"), /access/);
  assert.throws(() => authorize(merchant, "a", true), /access/);
  assert.doesNotThrow(() => authorize(operator, "b", true));
  await assert.rejects(
    saveDraft(db, merchant, draft({ organizationId: "b" })),
    /access/,
  );
  await assert.rejects(pauseOffer(db, merchant, "anchor-a"), /access/);
  await assert.rejects(
    db.query(
      "insert into offers(id,organization_id,location_id,kind,state,title) values('wrong','a','b-location','anchor','draft','Wrong tenant')",
    ),
    /foreign key/,
  );
  const accepted = await claim();
  await assert.rejects(
    db.query(
      "insert into messages(id,organization_id,customer_id,sender_id,claim_id,purpose) values('wrong-message','b',$1,'b-sender',$2,'merchant')",
      [accepted.customer_id, accepted.id],
    ),
    /foreign key/,
  );
  await assert.rejects(
    db.query(
      "insert into redemptions(id,claim_id,organization_id) values('wrong-redemption',$1,'b')",
      [accepted.id],
    ),
    /foreign key/,
  );
});

test("published promise, attribution, and observable history cannot be rewritten", async () => {
  const accepted = await claim(),
    credential = decrypt(accepted.token_encrypted);
  await db.query(
    "update organizations set name='Renamed Business' where id='a'",
  );
  await db.query(
    "update locations set address='New address' where id='a-location'",
  );
  assert.equal((await getPass(db, credential)).snapshot.merchant, "Business A");
  assert.equal(
    (await getPass(db, credential)).snapshot.address,
    "123 Test Street",
  );
  await assert.rejects(
    db.query(
      "update offer_versions set reward='Changed reward' where offer_id='anchor-a'",
    ),
    /immutable/,
  );
  await assert.rejects(
    db.query(
      "update sources set campaign='Reattributed' where id='anchor-a-source'",
    ),
    /immutable/,
  );
  await assert.rejects(
    db.query("update claims set snapshot='{}' where id=$1", [accepted.id]),
    /immutable/,
  );
  await assert.rejects(
    db.query(
      "update consent_events set accepted=false where purpose='fulfillment'",
    ),
    /immutable/,
  );
  await pauseOffer(db, operator, "anchor-a");
  await assert.rejects(claim("anchor-a", phoneB), /not accepting/);
  const redeemed = await redeem(db, credential);
  assert.equal(
    redeemed.state,
    "redeemed",
    "Pausing acquisition still honors the original pass.",
  );
  await assert.rejects(
    db.query("update claims set state='active',redeemed_at=null where id=$1", [
      accepted.id,
    ]),
    /cannot be reset/,
  );
  await assert.rejects(db.query("delete from redemptions"), /immutable/);
});

test("marketing is optional, phone possession is explicit, and a new claim does not downgrade existing consent", async () => {
  const accepted = await claim("anchor-a", phoneA, true, true),
    credential = decrypt(accepted.token_encrypted);
  assert.deepEqual(
    (await rows<{ state: string }>("subscriptions")).map((s) => s.state),
    ["pending", "pending"],
  );
  await getPass(db, credential);
  assert.equal(await count("subscriptions", "where state='subscribed'"), 0);
  await db.transaction((tx) => confirmPossession(tx, accepted));
  assert.equal(await count("subscriptions", "where state='subscribed'"), 0);
  await confirmPassChoices(db, credential, true, true);
  assert.equal(await count("subscriptions", "where state='subscribed'"), 2);
  await claim("anchor-a", phoneA, true, true);
  assert.equal(await count("subscriptions", "where state='subscribed'"), 2);
  await claim("anchor-a", phoneA, false, false);
  assert.equal(
    await count("subscriptions", "where state='subscribed'"),
    2,
    "Unchecked optional boxes do not revoke earlier permission.",
  );
  await preferences(db, credential, false, true);
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='a'"))[0]
      .state,
    "unsubscribed",
  );
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='network'"))[0]
      .state,
    "subscribed",
  );
});

test("a public retry cannot add marketing choices to an existing private pass or undo an unsubscribe", async () => {
  const original = await claim("anchor-a", phoneA, false, false),
    credential = decrypt(original.token_encrypted);
  const retry = await claim("anchor-a", phoneA, true, true);
  assert.equal(retry.id, original.id);
  assert.equal(await count("messages"), 1);
  assert.deepEqual(await getClaimChoices(db, original.id), {
    merchant: false,
    network: false,
  });
  assert.equal(await count("subscriptions"), 0);
  assert.equal(
    await count(
      "consent_events",
      "where purpose in ('merchant','network') and accepted",
    ),
    0,
  );
  await db.transaction((tx) => confirmPossession(tx, original));
  assert.equal(
    await count("subscriptions"),
    0,
    "Opening the original pass cannot activate choices from the public retry.",
  );
  await preferences(db, credential, true, true);
  assert.equal(
    await count("subscriptions", "where state='subscribed'"),
    2,
    "The private preferences screen can explicitly opt in.",
  );
  await preferences(db, credential, false, false);
  await claim("anchor-a", phoneA, true, true);
  assert.equal(await count("subscriptions", "where state='unsubscribed'"), 2);
  assert.equal(await count("subscriptions", "where state='pending'"), 0);
});

test("claim-specific choices are immutable, and opening or redeeming alone never activates marketing", async () => {
  const accepted = await claim("anchor-a", phoneA, true, true),
    credential = decrypt(accepted.token_encrypted);
  await claim("anchor-a", phoneA, false, false);
  assert.deepEqual(await getClaimChoices(db, accepted.id), {
    merchant: true,
    network: true,
  });
  await assert.rejects(
    db.query(
      "update claim_consent_choices set merchant_requested=false where claim_id=$1",
      [accepted.id],
    ),
    /immutable/,
  );
  await assert.rejects(
    db.query("delete from claim_consent_choices where claim_id=$1", [
      accepted.id,
    ]),
    /immutable/,
  );
  await db.transaction((tx) => confirmPossession(tx, accepted));
  assert.equal(await count("subscriptions", "where state='pending'"), 2);
  await redeem(db, credential);
  assert.equal(
    await count("subscriptions", "where state='pending'"),
    2,
    "Counter redemption is not marketing consent.",
  );
  await confirmPassChoices(db, credential, true, false);
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='a'"))[0]
      .state,
    "subscribed",
  );
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='network'"))[0]
      .state,
    "unsubscribed",
  );
  assert.deepEqual(
    (
      await rows<{ purpose: string; accepted: boolean }>(
        "consent_events",
        "where source_ui='pass-open' order by purpose",
      )
    ).map((e) => ({ purpose: e.purpose, accepted: e.accepted })),
    [
      { purpose: "merchant", accepted: true },
      { purpose: "network", accepted: false },
    ],
  );
});

test("private pass confirmation selects explicit scopes and preserves unrelated confirmed subscriptions", async () => {
  const a = await claim("anchor-a", phoneA, true, false),
    b = await claim("anchor-b", phoneA, true, true);
  await confirmPassChoices(db, decrypt(a.token_encrypted), true, false);
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='a'"))[0]
      .state,
    "subscribed",
  );
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='b'"))[0]
      .state,
    "pending",
    "Another merchant’s intent is not silently activated.",
  );
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='network'"))[0]
      .state,
    "unsubscribed",
    "An unchecked scope can decline pending intent.",
  );
  await confirmPassChoices(db, decrypt(b.token_encrypted), true, true);
  await confirmPassChoices(db, decrypt(a.token_encrypted), false, false);
  assert.equal(
    await count("subscriptions", "where state='subscribed'"),
    3,
    "Unshown or unchecked choices on a later opening do not revoke confirmed permission.",
  );
  const drop = await makeDropMessage(a, "historical-drop");
  assert.deepEqual(
    await getClaimChoices(db, drop.claim_id),
    { merchant: false, network: false },
    "A pass without a saved initial choice never infers one.",
  );
});

test("STOP is idempotent and sender-scoped; START does not restore marketing consent", async () => {
  const a = await claim("anchor-a", phoneA, true, true),
    b = await claim("anchor-b", phoneA, true, false);
  await confirmPassChoices(db, decrypt(a.token_encrypted), true, true);
  await confirmPassChoices(db, decrypt(b.token_encrypted), true, false);
  const stop = {
    MessageSid: providerSid(),
    From: phoneA,
    MessagingServiceSid: serviceA,
    To: "+12125550902",
    Body: "stop",
  };
  await inbound(db, stop);
  await inbound(db, stop);
  assert.equal(await count("inbound_events"), 1);
  assert.equal(
    await count("consent_events", "where source_ui='twilio-inbound'"),
    2,
  );
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='a'"))[0]
      .state,
    "unsubscribed",
  );
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='network'"))[0]
      .state,
    "unsubscribed",
  );
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='b'"))[0]
      .state,
    "subscribed",
  );
  assert.equal(
    (await rows<Message>("messages", "where organization_id='a'"))[0].state,
    "suppressed",
  );
  assert.equal(
    (await rows<Message>("messages", "where organization_id='b'"))[0].state,
    "queued",
  );
  await assert.rejects(
    claim("anchor-a", phoneB).then(() => claim("anchor-a", phoneA)),
    /stopped/,
  );
  await inbound(db, { ...stop, MessageSid: providerSid(), Body: "START" });
  assert.equal(
    (
      await rows<{ suppressed: boolean }>(
        "suppressions",
        "where sender_id='a-sender'",
      )
    )[0].suppressed,
    false,
  );
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='a'"))[0]
      .state,
    "unsubscribed",
  );
  await assert.rejects(
    inbound(db, {
      ...stop,
      MessageSid: providerSid(),
      MessagingServiceSid: "MGunknown",
    }),
    /Unknown sender/,
  );
});

test("provider callbacks retain monotonic state and immutable, idempotent evidence", async () => {
  await claim();
  const [message] = await rows<Message>("messages"),
    sid = providerSid();
  await assert.rejects(
    statusCallback(db, message.id, sid, "delivered"),
    /not submitted/,
  );
  await db.query("update messages set state='submitting' where id=$1", [
    message.id,
  ]);
  await statusCallback(db, message.id, sid, "sent");
  await statusCallback(db, message.id, sid, "undelivered", "30003");
  await statusCallback(db, message.id, sid, "undelivered", "30099");
  assert.equal(
    (await rows<Message>("messages"))[0].error_code,
    "30003",
    "A replay cannot replace the original terminal error.",
  );
  await statusCallback(db, message.id, sid, "queued");
  assert.equal((await rows<Message>("messages"))[0].state, "undelivered");
  await statusCallback(db, message.id, sid, "delivered");
  await statusCallback(db, message.id, sid, "failed", "30005");
  assert.equal((await rows<Message>("messages"))[0].state, "delivered");
  assert.equal((await rows<Message>("messages"))[0].error_code, null);
  assert.equal(await count("message_events"), 5);
  await assert.rejects(
    statusCallback(db, message.id, providerSid(), "sent"),
    /Unknown provider/,
  );
  await assert.rejects(db.query("delete from message_events"), /immutable/);
});

test("draft revisions retain version history and product metadata, with complete domain validation", async () => {
  const offerId = await saveDraft(
    db,
    merchant,
    draft({
      submit: false,
      productMetadata: {
        goal: "return",
        templateId: "breakfast",
        customerValue: 3,
        rewardCost: 0.5,
        requiredPurchase: 6,
        staffInstructions: "Check receipt; give coffee.",
      },
    }),
  );
  await saveDraft(
    db,
    merchant,
    draft({ id: offerId, reward: "Get a free large coffee" }),
  );
  assert.equal(
    await count("offer_versions", "where offer_id=$1", [offerId]),
    2,
  );
  assert.equal(
    await count("offer_product_metadata", "where offer_id=$1", [offerId]),
    2,
  );
  const versions = await rows<{ reward: string }>(
    "offer_versions",
    "where offer_id=$1 order by version",
    [offerId],
  );
  assert.equal(versions[0].reward, "Get a free coffee");
  assert.equal(versions[1].reward, "Get a free large coffee");
  await assert.rejects(
    saveDraft(db, merchant, draft({ expiresAt: "not a date" })),
    /valid offer window/,
  );
  await assert.rejects(
    saveDraft(db, merchant, draft({ limitMode: "claim", quantity: 0 })),
    /positive whole/,
  );
  const anchor = await saveDraft(
    db,
    operator,
    draft({ kind: "anchor", submit: false }),
  );
  await assert.rejects(
    saveDraft(db, merchant, draft({ id: anchor })),
    /Only Uptick can edit/,
  );
  await assert.rejects(
    saveDraft(db, operator, draft({ id: offerId, kind: "anchor" })),
    /type cannot change/,
  );
});

test("one business can approve only one Weekly Drop per local week under contention", async () => {
  const first = await saveDraft(db, merchant, draft()),
    second = await saveDraft(db, merchant, draft({ title: "Another Drop" })),
    send = nextSend();
  const result = await Promise.allSettled([
    approve(db, operator, first, send.toISOString()),
    approve(db, operator, second, send.toISOString()),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await count("broadcasts"), 1);
  const [broadcast] = await rows<{ offer_id: string }>("broadcasts");
  await assert.rejects(
    approve(db, operator, broadcast.offer_id, send.toISOString()),
    /Only submitted/,
  );
  assert.equal(
    weekKey(new Date("2026-09-14T02:00:00Z"), "America/New_York"),
    "2026-09-07",
  );
  assert.equal(
    weekKey(new Date("2026-09-14T04:00:00Z"), "America/New_York"),
    "2026-09-14",
  );
  assert.equal(
    isQuietHours(new Date("2026-11-01T13:59:00Z"), "America/New_York"),
    true,
  );
  assert.equal(
    isQuietHours(new Date("2026-11-01T14:00:00Z"), "America/New_York"),
    false,
  );
  assert.equal(
    isQuietHours(new Date("2026-09-15T00:00:00Z"), "America/New_York"),
    true,
  );
});

test("Drop expansion uses confirmed merchant permission and creates one queued entitlement per person", async () => {
  const confirmed = await claim("anchor-a", phoneA, true),
    pending = await claim("anchor-a", phoneB, true);
  await claim("anchor-a", phoneC, false);
  await confirmPassChoices(db, decrypt(confirmed.token_encrypted), true, false);
  const offerId = await saveDraft(db, merchant, draft()),
    send = nextSend();
  await approve(db, operator, offerId, send.toISOString());
  assert.equal(await expandDueBroadcasts(db, send), 1);
  assert.equal(await expandDueBroadcasts(db, send), 0);
  const issued = await rows<Claim>("claims", "where offer_id=$1", [offerId]);
  assert.equal(issued.length, 1);
  assert.equal(issued[0].customer_id, confirmed.customer_id);
  assert.notEqual(issued[0].customer_id, pending.customer_id);
  assert.equal(await count("messages", "where purpose='merchant'"), 1);
  assert.ok(issued[0].broadcast_id);
});

test("approval requires a clearly named free reward", async () => {
  const offerId = await saveDraft(
    db,
    merchant,
    draft({ reward: "Save 10 percent on coffee" }),
  );
  await assert.rejects(
    approve(db, operator, offerId, nextSend().toISOString()),
    /Name the free item/,
  );
  assert.equal(await count("broadcasts"), 0);
  assert.equal(
    (await rows<Offer>("offers", "where id=$1", [offerId]))[0].state,
    "review",
  );
});

test("a complete acquisition to recorded return uses durable records", async () => {
  const now = new Date(),
    timezone = Array.from({ length: 25 }, (_, i) => i - 12)
      .map((offset) => `Etc/GMT${offset >= 0 ? "+" : ""}${offset}`)
      .find((tz) => !isQuietHours(now, tz))!;
  await db.query("update organizations set timezone=$1 where id='a'", [
    timezone,
  ]);
  const initial = await claim(),
    credential = decrypt(initial.token_encrypted);
  assert.equal(await dispatch(db), 1);
  assert.equal((await rows<Message>("messages"))[0].state, "development");
  const firstRedemption = await redeem(db, credential);
  assert.equal(firstRedemption.state, "redeemed");
  assert.equal(await count("subscriptions"), 0);
  await preferences(db, credential, true, false);
  assert.equal(
    (await rows<{ state: string }>("subscriptions", "where scope='a'"))[0]
      .state,
    "subscribed",
  );
  const send = new Date(now.getTime() + 60000);
  const offerId = await saveDraft(
    db,
    merchant,
    draft({
      startsAt: new Date(now.getTime() - 60000).toISOString(),
      expiresAt: new Date(now.getTime() + 86400000).toISOString(),
    }),
  );
  await approve(db, operator, offerId, send.toISOString());
  assert.equal(await expandDueBroadcasts(db, now), 0);
  assert.equal(await expandDueBroadcasts(db, send), 1);
  assert.equal(await dispatch(db), 1);
  const [dropMessage] = await rows<Message>(
    "messages",
    "where purpose='merchant'",
  );
  assert.equal(dropMessage.state, "development");
  assert.equal(dropMessage.provider_sid, null);
  const [returnPass] = await rows<Claim>("claims", "where id=$1", [
    dropMessage.claim_id,
  ]);
  assert.equal(returnPass.customer_id, initial.customer_id);
  assert.equal(returnPass.broadcast_id, dropMessage.broadcast_id);
  const recordedReturn = await redeem(db, decrypt(returnPass.token_encrypted));
  assert.equal(recordedReturn.state, "redeemed");
  assert.equal(await count("redemptions"), 2);
  assert.ok(
    new Date(recordedReturn.redeemed_at!) >
      new Date(firstRedemption.redeemed_at!),
  );
  assert.equal(
    await count("message_events"),
    0,
    "Local simulation is never represented as provider evidence.",
  );
  const [result] = await db.query<{ n: number }>(
    "select count(*)::int n from claims initial join claims later on later.customer_id=initial.customer_id and later.organization_id=initial.organization_id where initial.id=$1 and initial.state='redeemed' and later.state='redeemed' and later.broadcast_id is not null and later.redeemed_at>initial.redeemed_at",
    [initial.id],
  );
  assert.equal(
    result.n,
    1,
    "The stored data supports one later, Drop-linked recorded return.",
  );
});

test("send eligibility rechecks consent, possession, suppression, tenant, schedule, and sample mode", async () => {
  const accepted = await claim("anchor-a", phoneA, true),
    now = new Date();
  const timezone = Array.from({ length: 25 }, (_, i) => i - 12)
    .map((offset) => `Etc/GMT${offset >= 0 ? "+" : ""}${offset}`)
    .find((tz) => !isQuietHours(now, tz))!;
  const message = await makeDropMessage(accepted, "drop-check", timezone, now);
  assert.equal(
    await eligibility(db, message, now),
    "No current merchant consent",
  );
  await confirmPassChoices(db, decrypt(accepted.token_encrypted), true, false);
  assert.equal(await eligibility(db, message, now), null);
  assert.equal(
    await eligibility(db, { ...message, organization_id: "b" }, now),
    "Sender does not match this business",
  );
  await preferences(db, decrypt(accepted.token_encrypted), false, false);
  assert.equal(
    await eligibility(db, message, now),
    "No current merchant consent",
  );
  await preferences(db, decrypt(accepted.token_encrypted), true, false);
  await db.query(
    "insert into suppressions(phone,sender_id,suppressed) values($1,'a-sender',true)",
    [phoneA],
  );
  assert.equal(await eligibility(db, message, now), "Sender opt-out");
  await db.query("update suppressions set suppressed=false");
  await pauseOffer(db, operator, "drop-check");
  assert.equal(await eligibility(db, message, now), "Offer paused");
  await db.query("update organizations set is_demo=true where id='b'");
  const sample = await claim("anchor-b", phoneB);
  const [sampleMessage] = await rows<Message>("messages", "where claim_id=$1", [
    sample.id,
  ]);
  process.env.SMS_TRANSPORT = "twilio";
  assert.equal(
    await eligibility(db, sampleMessage, now),
    "Sample passes cannot be sent through a live provider",
  );
  assert.equal(messagingReady(), false);
});

test("quiet hours on one tenant do not block another requested pass; development never reports delivery", async () => {
  const accepted = await claim("anchor-a", phoneA, true);
  await confirmPassChoices(db, decrypt(accepted.token_encrypted), true, false);
  await db.query("update messages set state='development'");
  const now = new Date(),
    quietZone = Array.from({ length: 25 }, (_, i) => i - 12)
      .map((offset) => `Etc/GMT${offset >= 0 ? "+" : ""}${offset}`)
      .find((tz) => isQuietHours(now, tz))!;
  const drop = await makeDropMessage(accepted, "quiet-drop", quietZone, now);
  await claim("anchor-b", phoneB);
  assert.equal(await dispatch(db, 10), 1);
  assert.equal(
    (await rows<Message>("messages", "where id=$1", [drop.id]))[0].state,
    "queued",
  );
  assert.equal(
    (await rows<Message>("messages", "where organization_id='b'"))[0].state,
    "development",
  );
  assert.equal(await count("messages", "where state='delivered'"), 0);
  assert.equal(await count("message_events"), 0);
});

test("uncertain worker submissions are recorded for review and never automatically retried", async () => {
  await claim();
  const [message] = await rows<Message>("messages");
  await db.query(
    "update messages set state='submitting',updated_at=now()-interval '10 minutes' where id=$1",
    [message.id],
  );
  assert.equal(await dispatch(db), 0);
  const [updated] = await rows<Message>("messages");
  assert.equal(updated.state, "unknown");
  assert.equal(updated.error_code, "worker_interrupted");
  assert.equal(await dispatch(db), 0);
  assert.equal((await rows<Message>("messages"))[0].state, "unknown");
});

test("rate limits count rejected requests and local access cannot be enabled on public hosts", async () => {
  await rateLimit(db, "attempt", 1, 3600);
  await assert.rejects(rateLimit(db, "attempt", 1, 3600), /Too many attempts/);
  await db.query("update rate_limits set window_at=now()-interval '2 hours'");
  await rateLimit(db, "attempt", 1, 3600);
  assert.equal(localMode(), true);
  process.env.APP_URL = "https://uptick.example";
  assert.equal(localMode(), false);
  process.env.APP_URL = "not a url";
  assert.equal(localMode(), false);
  process.env.APP_URL = "http://localhost:3000";
  process.env.VERCEL = "1";
  assert.equal(localMode(), false);
});

test("the post-redemption merchant join records only its displayed scope and never changes network consent", async () => {
  for (const [phone,networkState] of [[phoneA,"absent"],[phoneB,"pending"],[phoneC,"subscribed"],["+12125550104","unsubscribed"]] as const) {
    const accepted=await claim("anchor-a",phone,false,networkState==="pending");
    const credential=decrypt(accepted.token_encrypted);
    if(networkState==="subscribed"||networkState==="unsubscribed")await preferences(db,credential,false,true);
    if(networkState==="unsubscribed")await preferences(db,credential,false,false);
    const networkBefore=await rows("subscriptions","where customer_id=$1 and scope='network'",[accepted.customer_id]);
    const evidenceBefore=await rows("consent_events","where customer_id=$1 and purpose='network' order by created_at,id",[accepted.customer_id]);
    await assert.rejects(joinMerchantDrop(db,credential),/Redeem this pass/);
    assert.equal(await count("consent_events","where customer_id=$1 and source_ui='post-redemption'",[accepted.customer_id]),0);
    await redeem(db,credential);
    await joinMerchantDrop(db,credential);
    assert.equal((await rows<{state:string}>("subscriptions","where customer_id=$1 and scope='a'",[accepted.customer_id]))[0].state,"subscribed");
    assert.deepEqual(await rows("subscriptions","where customer_id=$1 and scope='network'",[accepted.customer_id]),networkBefore);
    assert.deepEqual(await rows("consent_events","where customer_id=$1 and purpose='network' order by created_at,id",[accepted.customer_id]),evidenceBefore);
    const joined=await rows<{purpose:string;accepted:boolean;source_ui:string}>("consent_events","where customer_id=$1 and source_ui='post-redemption'",[accepted.customer_id]);
    assert.equal(joined.length,1);assert.equal(joined[0].purpose,"merchant");assert.equal(joined[0].accepted,true);
  }
});
