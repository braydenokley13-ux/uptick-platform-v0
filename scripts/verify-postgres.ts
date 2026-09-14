import assert from "node:assert/strict";
import postgres from "postgres";
import { readFile, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { userInfo } from "node:os";
import { migrate, pgAdapter } from "../src/lib/db";
import {
  acceptClaim,
  redeem,
  saveDraft,
  approve,
  type Actor,
} from "../src/lib/domain";
import { verifyNetworkPostgres } from "./verify-postgres-network";
import { verifyPilotPostgres } from "./verify-postgres-pilot";
import { decrypt } from "../src/lib/security";
process.env.UPTICK_ENV = "development";
process.env.UPTICK_LOCAL_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.SMS_TRANSPORT = "development";
delete process.env.VERCEL;
delete process.env.DATABASE_URL;
const root = await realpath(process.argv[2] || "");
const tempRoot = await realpath("/tmp");
if (
  dirname(root) !== tempRoot ||
  !root.startsWith(tempRoot + "/uptick-pg-check.")
)
  throw Error(
    "Use the isolated cluster wrapper: bash scripts/verify-postgres.sh",
  );
if (
  (await readFile(resolve(root, ".uptick-test-cluster"), "utf8")).trim() !==
  "uptick-isolated-postgres-test-v1"
)
  throw Error("Missing isolated test marker.");
const options = {
  host: root,
  port: 55439,
  database: "postgres",
  user: userInfo().username,
  prepare: false,
  max: 8,
  onnotice: () => {},
};
const bootstrap = postgres(options);
try {
  const [{ data_directory }] = await bootstrap`show data_directory`;
  assert.equal(
    await realpath(data_directory),
    await realpath(resolve(root, "data")),
  );
  const [{ listen_addresses }] = await bootstrap`show listen_addresses`;
  assert.equal(listen_addresses, "");
  await bootstrap.unsafe("create database uptick_isolated_verification");
} finally {
  await bootstrap.end({ timeout: 5 });
}
const sql = postgres({ ...options, database: "uptick_isolated_verification" });
const db = pgAdapter(sql),
  actor: Actor = { id: "operator", role: "operator", organizationId: "a" },
  merchant: Actor = { id: "owner-a", role: "merchant", organizationId: "a" };
try {
  const sessions = await Promise.all(
    Array.from({ length: 4 }, () =>
      sql.begin(async (tx) => {
        const [r] = await tx`select pg_backend_pid() pid,pg_sleep(0.15)`;
        return r.pid;
      }),
    ),
  );
  assert.equal(new Set(sessions).size, 4);
  console.log(
    "PASS: four simultaneously active independent PostgreSQL sessions.",
  );
  await migrate(db);
  const rows = await db.query<{ name: string }>(
    "select name from schema_migrations order by name",
  );
  console.log("Applied migrations:", rows.map((r) => r.name).join(", "));
  async function reset() {
    await db.query("truncate organizations cascade");
    await db.query("truncate customers cascade");
    await db.query("truncate rate_limits");
    for (const org of ["a", "b"]) {
      await db.query("insert into organizations(id,name) values($1,$2)", [
        org,
        `Business ${org}`,
      ]);
      await db.query(
        "insert into locations(id,organization_id,name,address) values($1,$2,$3,$4)",
        [org + "-location", org, "Main", "Sample"],
      );
      await db.query("insert into senders(id,organization_id) values($1,$2)", [
        org + "-sender",
        org,
      ]);
    }
  }
  async function offer(
    offerId = "anchor-a",
    org = "a",
    mode = "unlimited",
    quantity: number | null = null,
  ) {
    await db.query(
      "insert into offers(id,organization_id,location_id,kind,state,title) values($1,$2,$3,'anchor','live','Sample')",
      [offerId, org, org + "-location"],
    );
    await db.query(
      "insert into offer_versions(offer_id,version,qualification,reward,terms,starts_at,expires_at,limit_mode,quantity) values($1,1,'Buy coffee','Get a free snack','One per customer.',now()-interval '1 day',now()+interval '90 days',$2,$3)",
      [offerId, mode, quantity],
    );
    await db.query(
      "insert into sources(id,token,offer_id,campaign,creative) values($1,$2,$3,'Test','V1')",
      [offerId + "-source", offerId + "-token", offerId],
    );
  }
  const claim = (phone = "+12125550101", offerId = "anchor-a") =>
    acceptClaim(db, {
      sourceToken: offerId + "-token",
      phone,
      merchantConsent: false,
      networkConsent: false,
    });
  const count = async (table: string) =>
    Number(
      (await db.query<{ n: number }>(`select count(*)::int n from ${table}`))[0]
        .n,
    );
  await reset();
  await offer();
  const duplicate = await Promise.all(Array.from({ length: 4 }, () => claim()));
  assert.equal(new Set(duplicate.map((c) => c.id)).size, 1);
  assert.equal(await count("claims"), 1);
  assert.equal(await count("messages"), 1);
  assert.equal(await count("claim_consent_choices"), 1);
  assert.equal(
    (await db.query("select jsonb_typeof(snapshot) shape from claims"))[0]
      .shape,
    "object",
  );
  assert.equal(
    (
      await db.query(
        "select jsonb_typeof(detail) shape from audit_events limit 1",
      )
    )[0].shape,
    "object",
  );
  console.log(
    "PASS: four concurrent duplicate claims produce one claim, one message, and one consent-choice record.",
  );
  const redeemed = await Promise.all(
    Array.from({ length: 4 }, () =>
      redeem(db, decrypt(duplicate[0].token_encrypted)),
    ),
  );
  assert.ok(redeemed.every((c) => c.state === "redeemed"));
  assert.equal(await count("redemptions"), 1);
  console.log(
    "PASS: four concurrent redemptions of one credential record exactly one redemption.",
  );
  await reset();
  await offer("anchor-a", "a", "claim", 1);
  const lastClaim = await Promise.allSettled([
    claim("+12125550102"),
    claim("+12125550103"),
  ]);
  assert.equal(lastClaim.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await count("claims"), 1);
  assert.equal(await count("customers"), 1);
  console.log(
    "PASS: competing claims for the final reserved pass admit one customer and fully roll back the other.",
  );
  await reset();
  await offer("anchor-a", "a", "redemption", 1);
  const passes = await Promise.all([
    claim("+12125550104"),
    claim("+12125550105"),
  ]);
  const lastRedemption = await Promise.allSettled(
    passes.map((p) => redeem(db, decrypt(p.token_encrypted))),
  );
  assert.equal(
    lastRedemption.filter((r) => r.status === "fulfilled").length,
    1,
  );
  assert.equal(await count("redemptions"), 1);
  console.log(
    "PASS: competing passes for the final redemption produce one successful redemption.",
  );
  await reset();
  const send = new Date(Date.now() + 8 * 86400000);
  send.setUTCHours(16, 0, 0, 0);
  const draft = (organizationId = "a") => ({
    organizationId,
    kind: "drop" as const,
    title: "Breakfast",
    qualification: "Buy breakfast",
    reward: "Get a free coffee",
    terms: "One per customer.",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    limitMode: "unlimited" as const,
    submit: true,
  });
  const drafts = await Promise.all([
    saveDraft(db, merchant, draft()),
    saveDraft(db, merchant, draft()),
  ]);
  const approvals = await Promise.allSettled(
    drafts.map((id) => approve(db, actor, id, send.toISOString())),
  );
  assert.equal(approvals.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await count("broadcasts"), 1);
  assert.equal(await count("offer_reviews"), 1);
  console.log(
    "PASS: concurrent same-week approvals produce one broadcast and one approved-version record.",
  );
  await assert.rejects(saveDraft(db, merchant, draft("b")), /access/);
  await assert.rejects(
    db.query(
      "insert into offers(id,organization_id,location_id,kind,state,title) values('wrong-tenant','a','b-location','anchor','draft','Wrong')",
    ),
    /foreign key/,
  );
  await offer("anchor-a", "a");
  await offer("anchor-b", "b");
  const tenantClaims = await Promise.all([
    claim("+12125550106", "anchor-a"),
    claim("+12125550106", "anchor-b"),
  ]);
  assert.notEqual(tenantClaims[0].id, tenantClaims[1].id);
  assert.equal(tenantClaims[0].customer_id, tenantClaims[1].customer_id);
  await assert.rejects(
    db.query(
      "insert into redemptions(id,claim_id,organization_id) values('wrong-redemption',$1,'b')",
      [tenantClaims[0].id],
    ),
    /foreign key/,
  );
  console.log(
    "PASS: concurrent same-phone claims retain separate merchant entitlements; domain and database reject cross-tenant writes.",
  );
  await verifyNetworkPostgres(db);
  await verifyPilotPostgres(db);
  console.log("ALL SEPARATE-SESSION POSTGRESQL CHECKS PASSED.");
} finally {
  await sql.end({ timeout: 5 });
}
