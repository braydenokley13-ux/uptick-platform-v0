import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { memoryDb, type DB } from "../src/lib/db";
import {
  createEntitlement,
  offerSelect,
  type Actor,
  type Offer,
} from "../src/lib/domain";
import { decrypt, id } from "../src/lib/security";
import { aesCmac, NFC_PROFILE, nfcKey, verifyNtag424 } from "../src/lib/nfc";
import {
  createRedemptionPoint,
  operatorOverride,
  redeemAtPoint,
  revokeRedemptionPoint,
  rotateTapCredential,
  simulateTap,
  tapLanding,
} from "../src/lib/tap";

process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
delete process.env.VERCEL;
const operator: Actor = {
  id: "operator",
  role: "operator",
  organizationId: "a",
};
const merchant: Actor = {
  id: "merchant",
  role: "merchant",
  organizationId: "a",
};
const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
let db: DB;
before(async () => {
  db = await memoryDb();
});
after(async () => {
  await db?.close?.();
});
beforeEach(async () => {
  await db.query("truncate organizations cascade");
  await db.query("truncate market_cells cascade");
  process.env.UPTICK_NFC_KEY_TEST_META = key.toString("hex");
  process.env.UPTICK_NFC_KEY_TEST_FILE = key.toString("hex");
  for (const org of ["a", "b"]) {
    await db.query("insert into organizations(id,name) values($1,$2)", [
      org,
      `Store ${org}`,
    ]);
    await db.query(
      "insert into locations(id,organization_id,name,address) values($1,$2,'Counter','Test address')",
      [`${org}-location`, org],
    );
  }
  await db.query(
    "insert into market_cells(id,name,slug,state) values('market','Test market','test','pilot')",
  );
  await db.query(
    "insert into market_locations(market_id,location_id,organization_id) values('market','a-location','a')",
  );
});

async function setup(
  options: {
    mode?: string;
    quantity?: number;
    reservedUntil?: string;
    legacy?: boolean;
  } = {},
) {
  const offerId = id(),
    supplyId = id();
  await db.query(
    "insert into offers(id,organization_id,location_id,kind,state,title) values($1,'a','a-location','drop','live','Coffee Drop')",
    [offerId],
  );
  await db.query(
    "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode) values($1,1,'No purchase required','Free coffee','One per member',now()-interval '1 day',now()+interval '7 days','unlimited')",
    [offerId],
  );
  if (!options.legacy)
    await db.query(
      "insert into network_drop_supplies(id,market_id,organization_id,location_id,offer_id,offer_version,state,starts_at,expires_at,inventory_policy,quantity,verification_mode,self_confirm_approved,approved_by) values($1,'market','a','a-location',$2,1,'approved',now()-interval '1 day',now()+interval '7 days','redemption',$3,$4,$5,'operator')",
      [
        supplyId,
        offerId,
        options.quantity || 10,
        options.mode || "staff_tap",
        options.mode === "self_confirm",
      ],
    );
  const point = await createRedemptionPoint(db, operator, {
    organizationId: "a",
    locationId: "a-location",
    name: "Counter 01",
    exposure: "staff",
  });
  async function claim() {
    const customerId = id(),
      memberId = id(),
      allocationId = id();
    await db.query("insert into customers(id,phone) values($1,$2)", [
      customerId,
      `+1${Date.now()}${Math.random()}`,
    ]);
    const [offer] = await db.query<Offer>(`${offerSelect} where o.id=$1`, [
      offerId,
    ]);
    const claimed = await createEntitlement(db, offer, customerId, null, {});
    if (!options.legacy) {
      await db.query(
        "insert into uptick_members(id,customer_id,home_zip,market_id,state) values($1,$2,'12345','market','active')",
        [memberId, customerId],
      );
      await db.query(
        "insert into member_allocations(id,member_id,market_id,week_key) values($1,$2,'market','2026-09-07')",
        [allocationId, memberId],
      );
      await db.query(
        "insert into allocation_options(allocation_id,supply_id,market_id,rank,reason) values($1,$2,'market',1,'{}')",
        [allocationId, supplyId],
      );
      await db.query(
        "insert into member_claims(claim_id,member_id,customer_id,organization_id,supply_id,offer_id,allocation_id,reserved_until) values($1,$2,$3,'a',$4,$5,$6,$7)",
        [
          claimed.id,
          memberId,
          customerId,
          supplyId,
          offerId,
          allocationId,
          options.reservedUntil || null,
        ],
      );
    }
    return {
      ...claimed,
      privateToken: decrypt(claimed.token_encrypted),
      memberId,
    };
  }
  return { ...point, offerId, supplyId, claim };
}
function proof(counter: number) {
  const uid = Buffer.from("04DE5F1EACC040", "hex"),
    picc = Buffer.alloc(16);
  picc[0] = 0xc7;
  uid.copy(picc, 1);
  picc.writeUIntLE(counter, 8, 3);
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  const encryptedPicc = Buffer.concat([
    cipher.update(picc),
    cipher.final(),
  ]).toString("hex");
  const session = aesCmac(
    key,
    Buffer.concat([Buffer.from("3cc300010080", "hex"), picc.subarray(1, 11)]),
  );
  const mac = Buffer.from(
    aesCmac(session, Buffer.alloc(0)).filter((_, i) => i % 2 === 1),
  ).toString("hex");
  return { encryptedPicc, mac };
}

test("AES-CMAC passes independent NIST vectors for empty, full, and partial blocks", () => {
  const k = Buffer.from("2b7e151628aed2a6abf7158809cf4f3c", "hex");
  const cases = [
    ["", "bb1d6929e95937287fa37d129b756746"],
    ["6bc1bee22e409f96e93d7e117393172a", "070a16b46b4d4144f79bdd9dd04a287c"],
    [
      "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411",
      "dfa66747de9ae63030ca32611497c827",
    ],
  ];
  for (const [message, expected] of cases)
    assert.equal(
      aesCmac(k, Buffer.from(message, "hex")).toString("hex"),
      expected,
    );
});
test("secure NFC validates the published NXP encrypted PICC example and rejects altered inputs", () => {
  const config = {
    uid: "04DE5F1EACC040",
    metaKey: Buffer.alloc(16),
    fileKey: Buffer.alloc(16),
    profile: NFC_PROFILE,
  };
  const vector = {
    encryptedPicc: "EF963FF7828658A599F3041510671E88",
    mac: "94EED9EE65337086",
  };
  assert.deepEqual(verifyNtag424(vector, config), {
    uid: config.uid,
    counter: 61,
  });
  assert.throws(
    () => verifyNtag424({ ...vector, mac: "94EED9EE65337087" }, config),
    /could not be verified/,
  );
  assert.throws(
    () => verifyNtag424(vector, { ...config, uid: "14DE5F1EACC040" }),
    /could not be verified/,
  );
  assert.throws(
    () => verifyNtag424({ ...vector, encryptedPicc: "bad" }, config),
    /could not be verified/,
  );
  assert.throws(
    () => verifyNtag424(vector, { ...config, profile: "unrecognized" }),
    /could not be verified/,
  );
  process.env.UPTICK_NFC_KEY_DEFAULT = "0".repeat(32);
  assert.throws(() => nfcKey("UPTICK_NFC_KEY_DEFAULT"), /awaiting/);
  assert.throws(() => nfcKey("DATABASE_URL"), /awaiting/);
});
test("permanent QR records honest location evidence and is independent of the Drop", async () => {
  const setup1 = await setup(),
    claim = await setup1.claim();
  const result = await redeemAtPoint(db, claim.privateToken, {
    pointToken: setup1.credential.public_token,
  });
  assert.equal(result.claim.state, "redeemed");
  assert.equal(result.evidence!.method, "qr");
  assert.equal(result.evidence!.verification_level, 1);
  assert.equal(result.evidence!.staff_gated, true);
  assert.equal(result.evidence!.transaction_verified, false);
  const setup2 = await setup(),
    claim2 = await setup2.claim();
  await redeemAtPoint(db, claim2.privateToken, {
    pointToken: setup1.credential.public_token,
  });
  assert.equal((await db.query("select * from redemptions")).length, 2);
  assert.equal((await db.query("select * from consent_events")).length, 0);
  await assert.rejects(
    db.query("delete from redemption_evidence"),
    /immutable/,
  );
});
test("wrong stores, public points for staff offers, and revoked points cannot redeem", async () => {
  const s = await setup(),
    claim = await s.claim();
  const wrong = await createRedemptionPoint(db, operator, {
    organizationId: "b",
    locationId: "b-location",
    name: "Other store",
    exposure: "staff",
  });
  const pub = await createRedemptionPoint(db, operator, {
    organizationId: "a",
    locationId: "a-location",
    name: "Public",
    exposure: "public",
  });
  await assert.rejects(
    redeemAtPoint(db, claim.privateToken, {
      pointToken: wrong.credential.public_token,
    }),
    /different store/,
  );
  await assert.rejects(
    redeemAtPoint(db, claim.privateToken, {
      pointToken: pub.credential.public_token,
    }),
    /staff Uptick Tap/,
  );
  await assert.rejects(
    revokeRedemptionPoint(db, merchant, s.point.id),
    /access/,
  );
  await revokeRedemptionPoint(db, operator, s.point.id);
  await assert.rejects(
    redeemAtPoint(db, claim.privateToken, {
      pointToken: s.credential.public_token,
    }),
    /revoked/,
  );
  assert.equal((await db.query("select * from redemptions")).length, 0);
});
test("rotation replaces credentials and preserves audit, while merchant cannot provision keys", async () => {
  const s = await setup();
  await assert.rejects(
    rotateTapCredential(db, merchant, s.point.id, { type: "qr" }),
    /access/,
  );
  const replacement = await rotateTapCredential(db, operator, s.point.id, {
    type: "qr",
  });
  assert.equal(replacement.version, 2);
  await assert.rejects(
    tapLanding(db, s.credential.public_token),
    /unavailable/,
  );
  assert.equal((await tapLanding(db, replacement.public_token)).id, s.point.id);
  await assert.rejects(
    db.query(
      "update redemption_credentials set point_id='missing' where id=$1",
      [replacement.id],
    ),
    /immutable/,
  );
});
test("secure NFC counter is consumed atomically and its replay cannot redeem another pass", async () => {
  const s = await setup();
  const secure = await rotateTapCredential(db, operator, s.point.id, {
    type: "secure_nfc",
    uid: "04DE5F1EACC040",
    metaKeyRef: "UPTICK_NFC_KEY_TEST_META",
    fileKeyRef: "UPTICK_NFC_KEY_TEST_FILE",
  });
  const a = await s.claim(),
    b = await s.claim();
  const outcomes = await Promise.allSettled(
    [a, b].map((c) =>
      redeemAtPoint(db, c.privateToken, {
        pointToken: secure.public_token,
        nfc: proof(10),
      }),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const failedClaim = outcomes[0].status === "rejected" ? a : b;
  await assert.rejects(
    redeemAtPoint(db, failedClaim.privateToken, {
      pointToken: secure.public_token,
      nfc: proof(9),
    }),
    /already been used/,
  );
  const fresh = await redeemAtPoint(db, failedClaim.privateToken, {
    pointToken: secure.public_token,
    nfc: proof(11),
  });
  assert.equal(fresh.evidence!.verification_level, 2);
  assert.equal(fresh.evidence!.transaction_verified, false);
});
test("duplicate redemption and final quantity race create exactly one ledger row", async () => {
  const s = await setup({ quantity: 1 }),
    a = await s.claim(),
    b = await s.claim();
  const outcomes = await Promise.allSettled(
    [a, b].map((c) =>
      redeemAtPoint(db, c.privateToken, {
        pointToken: s.credential.public_token,
      }),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const winner = outcomes[0].status === "fulfilled" ? a : b;
  assert.equal(
    (
      await redeemAtPoint(db, winner.privateToken, {
        pointToken: s.credential.public_token,
      })
    ).repeated,
    true,
  );
  assert.equal((await db.query("select * from redemptions")).length, 1);
  assert.equal((await db.query("select * from redemption_evidence")).length, 1);
});
test("expired reservations and unsupported self-confirm fail; approved self-confirm remains explicitly weak evidence", async () => {
  const expired = await setup({
      reservedUntil: new Date(Date.now() - 1000).toISOString(),
    }),
    a = await expired.claim();
  await assert.rejects(
    redeemAtPoint(db, a.privateToken, {
      pointToken: expired.credential.public_token,
    }),
    /reservation has expired/,
  );
  await assert.rejects(
    redeemAtPoint(db, a.privateToken, { selfConfirm: true }),
    /requires the Uptick Tap/,
  );
  const approved = await setup({ mode: "self_confirm" }),
    b = await approved.claim();
  await db.query("update uptick_members set state='paused' where id=$1", [
    b.memberId,
  ]);
  const result = await redeemAtPoint(db, b.privateToken, { selfConfirm: true });
  assert.equal(result.evidence!.verification_level, 0);
  assert.equal(result.evidence!.staff_gated, false);
});
test("operator exceptions require access and a reason and cannot bypass expiry or capacity", async () => {
  const s = await setup(),
    a = await s.claim();
  await assert.rejects(
    operatorOverride(db, merchant, a.privateToken, "Customer needs assistance"),
    /access/,
  );
  await assert.rejects(
    operatorOverride(db, operator, a.privateToken, "short"),
    /12 characters/,
  );
  const result = await operatorOverride(
    db,
    operator,
    a.privateToken,
    "Cashier reported damaged sign; assisted at counter.",
  );
  assert.equal(result.evidence!.method, "operator_override");
  assert.equal(result.evidence!.verification_level, 0);
});
test("Tap rehearsals stay in their own ledger with no claim, redemption, or production counter changes", async () => {
  const s = await setup();
  await assert.rejects(simulateTap(db, merchant, s.point.id, "qr"), /access/);
  for (const scenario of [
    "qr",
    "secure_nfc_vector",
    "wrong_location",
    "replay",
    "revoked",
  ] as const)
    await simulateTap(db, operator, s.point.id, scenario);
  assert.equal((await db.query("select * from tap_test_events")).length, 5);
  assert.equal((await db.query("select * from claims")).length, 0);
  assert.equal((await db.query("select * from redemptions")).length, 0);
  assert.equal((await db.query("select * from redemption_evidence")).length, 0);
  assert.equal(
    (
      await db.query<{ last_counter: number }>(
        "select last_counter from redemption_credentials",
      )
    )[0].last_counter,
    -1,
  );
});
test("pausing supply preserves issued promises and recorded replenishment restores capacity", async () => {
  const s = await setup({ quantity: 1 }),
    first = await s.claim(),
    second = await s.claim();
  await redeemAtPoint(db, first.privateToken, {
    pointToken: s.credential.public_token,
  });
  await assert.rejects(
    redeemAtPoint(db, second.privateToken, {
      pointToken: s.credential.public_token,
    }),
    /remaining quantity/,
  );
  await db.query(
    "insert into supply_adjustments(id,supply_id,delta,reason,actor_id) values($1,$2,1,'One extra coffee restocked','operator')",
    [id(), s.supplyId],
  );
  await db.query(
    "update network_drop_supplies set state='paused' where id=$1",
    [s.supplyId],
  );
  const result = await redeemAtPoint(db, second.privateToken, {
    pointToken: s.credential.public_token,
  });
  assert.equal(result.claim.state, "redeemed");
  assert.equal(
    (
      await db.query(
        "select * from demand_events where kind='redemption_completed'",
      )
    ).length,
    2,
  );
});
test("rotating the same tag preserves its replay high-water mark", async () => {
  const s = await setup(),
    first = await s.claim(),
    second = await s.claim();
  const input = {
    type: "secure_nfc" as const,
    uid: "04DE5F1EACC040",
    metaKeyRef: "UPTICK_NFC_KEY_TEST_META",
    fileKeyRef: "UPTICK_NFC_KEY_TEST_FILE",
  };
  const initial = await rotateTapCredential(db, operator, s.point.id, input);
  await redeemAtPoint(db, first.privateToken, {
    pointToken: initial.public_token,
    nfc: proof(25),
  });
  const rotated = await rotateTapCredential(db, operator, s.point.id, input);
  assert.equal(rotated.last_counter, 25);
  await assert.rejects(
    redeemAtPoint(db, second.privateToken, {
      pointToken: rotated.public_token,
      nfc: proof(25),
    }),
    /already been used/,
  );
  assert.equal(
    (
      await redeemAtPoint(db, second.privateToken, {
        pointToken: rotated.public_token,
        nfc: proof(26),
      })
    ).claim.state,
    "redeemed",
  );
});
