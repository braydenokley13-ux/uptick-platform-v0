import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, type DB } from "../src/lib/db";
import {
  acceptClaim,
  saveDraft,
  sourceOffer,
  redeem,
  type Actor,
  type DraftInput,
} from "../src/lib/domain";
import {
  createCreative,
  createPlacementSource,
  confirmPlacement,
  creativeExportData,
  customerTimeline,
  operatorMessage,
  operatorOverview,
  reviewDecision,
  sourceDetail,
} from "../src/lib/operator";
import { decrypt, encrypt, hash, token } from "../src/lib/security";
import { RequestError } from "../src/lib/http";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
let db: DB;
const operator: Actor = {
    id: "ops",
    role: "operator",
    organizationId: "merchant",
  },
  merchant: Actor = {
    id: "owner",
    role: "merchant",
    organizationId: "merchant",
  };
before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db.close?.();
});
beforeEach(async () => {
  await db.query("truncate organizations cascade");
  await db.query("truncate rate_limits");
  for (const [org, role, category] of [
    ["merchant", "merchant", "fuel-convenience"],
    ["host", "host", "car-wash"],
    ["competitor", "host", "fuel-convenience"],
    ["other", "merchant", "cafe"],
  ]) {
    await db.query(
      "insert into organizations(id,name,capabilities,is_demo) values($1,$2,$3,true)",
      [org, org, [role]],
    );
    await db.query(
      "insert into locations(id,organization_id,name,address) values($1,$2,$3,$4)",
      [`${org}-location`, org, "Main", "123 Sample Street"],
    );
    await db.query(
      "insert into business_profiles(organization_id,category) values($1,$2)",
      [org, category],
    );
    if (role === "merchant")
      await db.query("insert into senders(id,organization_id) values($1,$2)", [
        `${org}-sender`,
        org,
      ]);
  }
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values('anchor','merchant','merchant-location','anchor','live','Fuel + Coffee')",
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at) values('anchor',1,'Buy $25 gas','Get a free coffee','Show your receipt.',now()-interval '1 day',now()+interval '90 days')",
  );
});
const placement = () => ({
  offerId: "anchor",
  locationId: "host-location",
  placement: "Waiting area display",
  campaign: "Neighborhood",
  creative: "Fuel + coffee v1",
  placementType: "Wall TV",
  environment: "Waiting area",
  dwellContext: "During service",
});
const creative = (sourceId: string) => ({
  sourceId,
  headline: "Fill up. Coffee is on us.",
  cta: "Scan for a free coffee",
  format: "landscape" as const,
  notes: "Keep the QR clear.",
});
const draft = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  organizationId: "merchant",
  kind: "drop",
  title: "Breakfast",
  qualification: "Buy breakfast",
  reward: "Get a free coffee",
  terms: "One per customer.",
  startsAt: new Date(Date.now() + 86400000).toISOString(),
  expiresAt: new Date(Date.now() + 172800000).toISOString(),
  limitMode: "unlimited",
  submit: true,
  ...overrides,
});
test("operator workspaces and mutations reject merchant actors, even for their own business", async () => {
  await assert.rejects(operatorOverview(db, merchant), /access/);
  await assert.rejects(
    createPlacementSource(db, merchant, placement()),
    /access/,
  );
  await assert.rejects(
    customerTimeline(db, merchant, "reference", "merchant"),
    /access/,
  );
  await assert.rejects(creativeExportData(db, merchant, "source"), /access/);
  await assert.rejects(operatorMessage(db, merchant, "message"), /access/);
  await assert.rejects(
    confirmPlacement(db, merchant, {
      id: "placement",
      status: "confirmed",
      note: "Installed",
      externalReference: "",
    }),
    /access/,
  );
  await assert.rejects(
    reviewDecision(db, merchant, {
      offerId: "anchor",
      decision: "rejected",
      note: "No",
    }),
    /access/,
  );
});
test("placement creation prevents direct competitors and non-host locations before writing", async () => {
  await assert.rejects(
    createPlacementSource(db, operator, {
      ...placement(),
      locationId: "competitor-location",
    }),
    /competitor/,
  );
  await assert.rejects(
    createPlacementSource(db, operator, {
      ...placement(),
      locationId: "other-location",
    }),
    /not configured as a host/,
  );
  const [{ n }] = await db.query<{ n: number }>(
    "select count(*)::int n from placements",
  );
  assert.equal(n, 0);
  const sourceId = await createPlacementSource(db, operator, placement());
  const detail = await sourceDetail(db, operator, sourceId);
  assert.equal(detail?.source.host, "host");
  assert.equal(detail?.source.status, "intended");
  assert.equal(detail?.source.claims, 0);
});
test("placement updates retain immutable handoff evidence without claiming playback", async () => {
  const sourceId = await createPlacementSource(db, operator, placement()),
    detail = await sourceDetail(db, operator, sourceId);
  assert.ok(detail);
  await confirmPlacement(db, operator, {
    id: detail.source.placement_id,
    status: "confirmed",
    note: "Installed in the customer lounge at the operator handoff.",
    externalReference: "SCREEN-01",
  });
  await confirmPlacement(db, operator, {
    id: detail.source.placement_id,
    status: "paused",
    note: "Host has paused this placement externally.",
    externalReference: "SCREEN-01",
  });
  const updated = await sourceDetail(db, operator, sourceId);
  assert.equal(updated?.history.length, 3);
  assert.equal(updated?.source.status, "paused");
  assert.equal(updated?.source.state, "active");
  await assert.rejects(
    db.query("update placement_events set note='rewritten'"),
    /immutable/,
  );
});
test("creative replacement creates a fresh source while earlier claims retain original context", async () => {
  const original = await createPlacementSource(db, operator, placement());
  const first = await createCreative(db, operator, {
    sourceId: original,
    headline: "Fill up. Coffee is on us.",
    cta: "Scan for a free coffee",
    format: "landscape",
    notes: "Keep the QR clear.",
  });
  assert.equal(first, original);
  const source = await sourceDetail(db, operator, original);
  assert.ok(source);
  const claim = await acceptClaim(db, {
    sourceToken: source.source.token,
    phone: "+12125550121",
    merchantConsent: false,
    networkConsent: false,
  });
  const next = await createCreative(db, operator, {
    sourceId: original,
    headline: "Good coffee. On the house.",
    cta: "Scan for your pass",
    format: "countertop",
    notes: "Counter placement.",
  });
  assert.notEqual(next, original);
  const replacement = await sourceDetail(db, operator, next);
  assert.equal(replacement?.creative.parent_source_id, original);
  assert.equal(replacement?.creative.version, 2);
  assert.equal(replacement?.creative.offer_version, 1);
  assert.notEqual(replacement?.source.token, source.source.token);
  assert.equal(claim.snapshot.origin.source_id, original);
  assert.equal(
    (await sourceDetail(db, operator, original))?.source.state,
    "active",
  );
  await assert.rejects(
    db.query("update source_creatives set headline='Changed later'"),
    /immutable/,
  );
});
test("return and reject preserve submitted version and a merchant-readable review note", async () => {
  const draftId = await saveDraft(db, merchant, {
    organizationId: "merchant",
    kind: "drop",
    title: "Breakfast",
    qualification: "Buy breakfast",
    reward: "Get a free coffee",
    terms: "One per customer.",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 172800000).toISOString(),
    limitMode: "unlimited",
    submit: true,
  });
  await reviewDecision(db, operator, {
    offerId: draftId,
    decision: "returned",
    note: "Please specify the drink size.",
  });
  const [draft] = await db.query<{ state: string; current_version: number }>(
    "select state,current_version from offers where id=$1",
    [draftId],
  );
  assert.equal(draft.state, "draft");
  assert.equal(draft.current_version, 1);
  const [review] = await db.query<{ decision: string; note: string }>(
    "select decision,note from offer_reviews where offer_id=$1",
    [draftId],
  );
  assert.equal(review.decision, "returned");
  assert.equal(review.note, "Please specify the drink size.");
  await assert.rejects(
    reviewDecision(db, operator, {
      offerId: draftId,
      decision: "rejected",
      note: "Rejecting an already returned draft.",
    }),
    /awaiting review/,
  );
  await assert.rejects(
    db.query("update offer_reviews set note='Rewritten'"),
    /immutable/,
  );
});
test("customer timeline is merchant scoped and never includes the phone or private pass token", async () => {
  const sourceId = await createPlacementSource(db, operator, placement()),
    source = await sourceDetail(db, operator, sourceId);
  assert.ok(source);
  const phone = "+12125550125";
  const claim = await acceptClaim(db, {
    sourceToken: source.source.token,
    phone,
    merchantConsent: true,
    networkConsent: false,
  });
  const privateToken = decrypt(claim.token_encrypted);
  const timeline = await customerTimeline(db, operator, phone, "merchant");
  assert.ok(timeline);
  assert.equal(timeline.customer.phone_suffix, "0125");
  assert.ok(timeline.events.some((e) => e.title === "Claim accepted"));
  assert.equal(timeline.subscriptions[0]?.state, "pending");
  const serialized = JSON.stringify(timeline);
  assert.ok(!serialized.includes(phone));
  assert.ok(!serialized.includes(privateToken));
  assert.ok(!serialized.includes("token_encrypted"));
  assert.equal(await customerTimeline(db, operator, phone, "other"), null);
  assert.equal(
    (await customerTimeline(db, operator, privateToken, "merchant"))?.customer
      .id,
    claim.customer_id,
  );
});

test("a changed category is checked again at confirmation and rejection leaves no handoff evidence", async () => {
  const sourceId = await createPlacementSource(db, operator, placement()),
    source = await sourceDetail(db, operator, sourceId);
  assert.ok(source);
  await db.query(
    "update business_profiles set category='fuel-convenience' where organization_id='host'",
  );
  await assert.rejects(
    confirmPlacement(db, operator, {
      id: source.source.placement_id,
      status: "confirmed",
      note: "Ready for the room.",
      externalReference: "DISPLAY-1",
    }),
    /competitor/,
  );
  const unchanged = await sourceDetail(db, operator, sourceId);
  assert.equal(unchanged?.source.status, "intended");
  assert.equal(unchanged?.source.external_reference, null);
  assert.equal(unchanged?.history.length, 1);
  await confirmPlacement(db, operator, {
    id: source.source.placement_id,
    status: "paused",
    note: "Do not install: category conflict found.",
    externalReference: "",
  });
  assert.equal(
    (await sourceDetail(db, operator, sourceId))?.source.status,
    "paused",
    "A conflicted placement can still be paused.",
  );
});

test("concurrent creative replacements have one successor QR and preserve the first export identity", async () => {
  const original = await createPlacementSource(db, operator, placement());
  await createCreative(db, operator, creative(original));
  const first = await creativeExportData(db, operator, original);
  assert.ok(first);
  const replacement = await Promise.allSettled([
    createCreative(db, operator, {
      ...creative(original),
      headline: "A fresh coffee, on us.",
    }),
    createCreative(db, operator, {
      ...creative(original),
      headline: "Another version.",
    }),
  ]);
  assert.equal(replacement.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(replacement.filter((r) => r.status === "rejected").length, 1);
  const detail = await sourceDetail(db, operator, original);
  assert.equal(detail?.children.length, 1);
  assert.equal(detail?.children[0].version, 2);
  const next = detail!.children[0].source_id,
    nextExport = await creativeExportData(db, operator, next);
  assert.ok(nextExport);
  assert.notEqual(first.token, nextExport.token);
  await db.query(
    "update organizations set name='A renamed merchant',is_demo=false where id='merchant'",
  );
  const preserved = await creativeExportData(db, operator, original);
  assert.equal(preserved?.merchant, "merchant");
  assert.equal(preserved?.is_demo, true);
  assert.equal(preserved?.token, first.token);
  assert.equal(preserved?.headline, first.headline);
  const third = await createCreative(db, operator, creative(next));
  assert.equal((await creativeExportData(db, operator, third))?.version, 3);
  await assert.rejects(
    db.query(
      "update source_creatives set merchant_name='Rewritten' where source_id=$1",
      [original],
    ),
    /immutable/,
  );
});

test("revised review creative keeps its original promise and cannot claim against the new promise", async () => {
  const offerId = await saveDraft(db, operator, draft({ kind: "anchor" })),
    sourceId = await createPlacementSource(db, operator, {
      ...placement(),
      offerId,
    });
  await createCreative(db, operator, creative(sourceId));
  const original = await creativeExportData(db, operator, sourceId);
  assert.ok(original);
  await saveDraft(
    db,
    operator,
    draft({ id: offerId, kind: "anchor", reward: "Get a free large tea" }),
  );
  const preserved = await creativeExportData(db, operator, sourceId);
  assert.equal(preserved?.reward, "Get a free coffee");
  assert.equal(preserved?.offer_version, 1);
  await assert.rejects(sourceOffer(db, original.token), /no longer available/);
  const next = await createCreative(db, operator, creative(sourceId));
  const updated = await creativeExportData(db, operator, next);
  assert.equal(updated?.reward, "Get a free large tea");
  assert.equal(updated?.offer_version, 2);
  assert.equal(
    (await sourceOffer(db, updated!.token)).offer.current_version,
    2,
  );
});

test("return, revise and reject records each submitted version with no loss of the proposal", async () => {
  const offerId = await saveDraft(db, merchant, draft());
  await assert.rejects(
    reviewDecision(db, operator, {
      offerId,
      decision: "returned",
      note: "   ",
    }),
    /note/,
  );
  assert.equal(
    (
      await db.query<{ state: string }>(
        "select state from offers where id=$1",
        [offerId],
      )
    )[0].state,
    "review",
  );
  await reviewDecision(db, operator, {
    offerId,
    decision: "returned",
    note: "Specify the size of the free drink.",
  });
  await saveDraft(
    db,
    merchant,
    draft({ id: offerId, reward: "Get a free large coffee" }),
  );
  await reviewDecision(db, operator, {
    offerId,
    decision: "rejected",
    note: "This proposal duplicates the approved weekly offer.",
  });
  const reviews = await db.query<{ offer_version: number; decision: string }>(
    "select offer_version,decision from offer_reviews where offer_id=$1 order by offer_version",
    [offerId],
  );
  assert.deepEqual(reviews, [
    { offer_version: 1, decision: "returned" },
    { offer_version: 2, decision: "rejected" },
  ]);
  const [offer] = await db.query<{ state: string; current_version: number }>(
    "select state,current_version from offers where id=$1",
    [offerId],
  );
  assert.equal(offer.state, "draft");
  assert.equal(offer.current_version, 2);
  assert.equal(
    (
      await db.query("select version from offer_versions where offer_id=$1", [
        offerId,
      ])
    ).length,
    2,
  );
  await assert.rejects(
    db.query(
      "insert into offer_reviews(id,offer_id,offer_version,decision,actor) values('invalid',$1,99,'approved','ops')",
      [offerId],
    ),
    /foreign key/,
  );
});

test("support references cannot cross merchants even when one customer has both relationships", async () => {
  const a = await createPlacementSource(db, operator, placement()),
    aSource = await sourceDetail(db, operator, a);
  assert.ok(aSource);
  const phone = "+12125550127",
    aClaim = await acceptClaim(db, {
      sourceToken: aSource.source.token,
      phone,
      merchantConsent: true,
      networkConsent: true,
    });
  const bOffer = await saveDraft(
    db,
    operator,
    draft({
      organizationId: "other",
      kind: "anchor",
      startsAt: new Date(Date.now() - 86400000).toISOString(),
    }),
  );
  await db.query("update offers set state='live' where id=$1", [bOffer]);
  const b = await createPlacementSource(db, operator, {
      ...placement(),
      offerId: bOffer,
    }),
    bSource = await sourceDetail(db, operator, b);
  assert.ok(bSource);
  const bClaim = await acceptClaim(db, {
    sourceToken: bSource.source.token,
    phone,
    merchantConsent: true,
    networkConsent: false,
  });
  await redeem(db, decrypt(bClaim.token_encrypted));
  const timeline = await customerTimeline(db, operator, phone, "merchant");
  assert.ok(timeline);
  assert.deepEqual(
    timeline.claims.map((c) => c.id),
    [aClaim.id],
  );
  assert.equal(timeline.subscriptions[0].state, "pending");
  assert.ok(!JSON.stringify(timeline).includes(bClaim.id));
  assert.ok(!timeline.events.some((e) => e.title.includes("redemption")));
  assert.equal(
    await customerTimeline(db, operator, bClaim.id, "merchant"),
    null,
  );
  assert.equal(
    await customerTimeline(
      db,
      operator,
      decrypt(bClaim.token_encrypted),
      "merchant",
    ),
    null,
  );
  const messages = await operatorOverview(db, operator);
  assert.ok(!JSON.stringify(messages.messages).includes(phone));
  assert.ok(messages.messages.every((m) => m.phone_suffix === "0127"));
});

async function supportClaim(
  claimId: string,
  organizationId: string,
  customerId: string,
  phone: string,
  offerId = "anchor",
) {
  const credential = token();
  await db.query("insert into customers(id,phone) values($1,$2)", [customerId, phone]);
  await db.query(
    "insert into claims(id,customer_id,organization_id,offer_id,offer_version,token_hash,token_encrypted,snapshot) values($1,$2,$3,$4,1,$5,$6,$7)",
    [claimId, customerId, organizationId, offerId, hash(credential), encrypt(credential), JSON.stringify({ merchant: organizationId })],
  );
  await db.query(
    "insert into relationships(customer_id,organization_id,acquisition_claim_id) values($1,$2,$3)",
    [customerId, organizationId, claimId],
  );
}

test("printed UP references match case-insensitively within the selected merchant", async () => {
  const claimId = "000000000000000000abcdef";
  await supportClaim(claimId, "merchant", "support-a", "+12125550131");
  for (const reference of ["UP-ABCDEF", "up-abcdef", "Up-aBcDeF"])
    assert.equal((await customerTimeline(db, operator, reference, "merchant"))?.customer.id, "support-a");
  assert.equal(await customerTimeline(db, operator, "UP-ABCDEF", "other"), null);
  assert.equal(await customerTimeline(db, operator, "UP-000000", "merchant"), null);
  const otherOffer = await saveDraft(db, operator, draft({ organizationId: "other", kind: "anchor" }));
  await supportClaim("111111111111111111abcdef", "other", "support-b", "+12125550132", otherOffer);
  assert.equal((await customerTimeline(db, operator, "UP-ABCDEF", "merchant"))?.customer.id, "support-a");
  assert.equal((await customerTimeline(db, operator, "UP-ABCDEF", "other"))?.customer.id, "support-b");
});

test("an ambiguous printed reference requires a full reference without selecting a customer", async () => {
  const first = "000000000000000000abcdef", second = "111111111111111111abcdef";
  await supportClaim(first, "merchant", "support-c", "+12125550133");
  await supportClaim(second, "merchant", "support-d", "+12125550134");
  await assert.rejects(customerTimeline(db, operator, "up-ABCDEF", "merchant"), error => error instanceof RequestError && /more than one pass.*full pass reference/.test(error.message));
  assert.equal((await customerTimeline(db, operator, first, "merchant"))?.customer.id, "support-c");
  assert.equal((await customerTimeline(db, operator, second, "merchant"))?.customer.id, "support-d");
});
