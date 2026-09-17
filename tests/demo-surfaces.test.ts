/* The demo has to show the product, not a near-miss of it.

   Three of the surfaces repaired in this pass only look different from the
   broken ones when there is more than one of something, and the demo fixture
   had exactly one of everything:

   - the merchant overview lists every commitment a store owes in a week, and
     with one counter the singular and the plural render identically;
   - the member's Places tab lists the counters backing that member's week, and
     with one counter it cannot show that a neighbourhood has several;
   - the operator's four-week backing panel compares each week's usable supply
     with the members owed a benefit, and needs all four weeks planned.

   On top of that, the demo's merchant button landed on `/merchant/results` —
   the growth-programme reporting section, which never renders a commitment at
   all. Someone walking the demo saw the old surfaces and concluded the repair
   had not shipped.

   This test seeds the real demo dataset in a real isolated demo environment —
   the same guard, root marker and loopback settings `npm run demo` uses — and
   asserts the fixture actually exercises the repaired views. It is deliberately
   an integration test: a unit test of the seeding SQL would pass while the demo
   a person clicks through stayed thin. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEMO_WORKSPACE_PATHS } from "../src/lib/demo-studio";

const tsxLoader = resolve("node_modules/tsx/dist/loader.mjs");

let temporaryParent = "";
let demoRoot = "";
let databasePath = "";

/** The demo environment, built the way `scripts/demo.ts` builds it: loopback
    only, local storage under an owned root, development SMS, enrollment and
    production delivery off, and throwaway keys. Nothing here can reach a hosted
    database or a real phone. */
function demoEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    UPTICK_DEMO_MODE: "true",
    UPTICK_DEMO_ROOT: demoRoot,
    UPTICK_ENV: "development",
    UPTICK_LOCAL_MODE: "true",
    APP_URL: "http://127.0.0.1:3210",
    LOCAL_DATABASE_PATH: databasePath,
    SMS_TRANSPORT: "development",
    PILOT_ENROLLMENT_ENABLED: "false",
    PRODUCTION_DELIVERY_ENABLED: "false",
  };
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "SHELL"] as const) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  for (const key of [
    "SESSION_SECRET",
    "PASS_ENCRYPTION_KEY",
    "CRON_SECRET",
  ] as const) {
    environment[key] = randomBytes(32).toString("hex");
  }
  return environment;
}

/** Run a program against the seeded demo database in its own process, so the
    demo's environment never leaks into the rest of the test run. */
function readDemoSurfaces() {
  const program = String.raw`
    const { getDb } = await import("./src/lib/db.ts");
    const { seedDemoStudio, DEMO_PHONE } = await import("./src/lib/demo-studio.ts");
    const { merchantOverview } = await import("./src/lib/merchant-overview.ts");
    const { memberPlaces } = await import("./src/lib/member-experience.ts");
    const { requestMemberAccess, exchangeMemberAccess } = await import(
      "./src/lib/membership-identity.ts"
    );
    const db = await getDb();
    try {
      await seedDemoStudio(db);

      /* The demo's own merchant login, not an invented one. */
      const merchant = await merchantOverview(db, {
        id: "demo-merchant",
        role: "merchant",
        organizationId: "demo-store",
        canExport: false,
      });

      /* Exactly the journey the demo's "Open member journey" button starts:
         join with the sample number, confirm, land on the member app. */
      const requested = await requestMemberAccess(db, {
        phone: DEMO_PHONE,
        homeZip: "10583",
        consentRequested: false,
        ageAttested: true,
      });
      const exchanged = await exchangeMemberAccess(db, requested.credential, false);
      const member = await memberPlaces(db, exchanged.credential);

      const weeks = await db.query(
        "select week_key,count(*)::int counters from pilot_week_supplies where run_id='demo-run' group by week_key order by week_key"
      );

      console.log("SURFACES=" + JSON.stringify({
        commitments: merchant.commitments,
        commitmentWeekState: merchant.commitmentWeekState,
        admitted: member.admitted,
        inCoverage: member.inCoverage,
        weekState: member.weekState,
        places: member.places,
        weeks,
      }));
    } finally {
      await db.close?.();
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", program],
    {
      cwd: process.cwd(),
      env: demoEnvironment(),
      encoding: "utf8",
      timeout: 300_000,
    },
  );
  assert.equal(
    result.status,
    0,
    `demo seeding failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const line = result.stdout
    .split("\n")
    .find((row) => row.startsWith("SURFACES="));
  assert.ok(line, `no surfaces reported\nstdout:\n${result.stdout}`);
  return JSON.parse(line.slice("SURFACES=".length)) as {
    commitments: {
      supplyId: string;
      locationId: string;
      address: string;
      exactItem: string;
      committedQuantity: number;
      substituteItem: string | null;
      fallbackAvailable: number | null;
    }[];
    commitmentWeekState: string;
    admitted: boolean;
    inCoverage: boolean;
    weekState: string;
    places: {
      supplyId: string;
      name: string;
      address: string;
      driveMinutes: number | null;
      state: string;
      why: string;
    }[];
    weeks: { week_key: string; counters: number }[];
  };
}

beforeEach(async () => {
  temporaryParent = await realpath(
    await mkdtemp(join(tmpdir(), "uptick-demo-surfaces-")),
  );
  demoRoot = join(temporaryParent, ".demo-studio");
  databasePath = join(demoRoot, "database");
  await mkdir(databasePath, { recursive: true });
  await writeFile(
    join(demoRoot, "ownership.json"),
    JSON.stringify({
      kind: "uptick-isolated-demo-v1",
      repository: temporaryParent,
      database: databasePath,
    }),
  );
});

afterEach(async () => {
  if (temporaryParent)
    await rm(temporaryParent, { recursive: true, force: true });
});

test("the demo dataset exercises every surface this pass repaired", async () => {
  const surfaces = readDemoSurfaces();

  /* Merchant overview. Two commitments in the current week, at two different
     counters, each with its own exact item and its own approved substitute —
     the shape the singular `commitment` field could not represent. */
  assert.equal(surfaces.commitmentWeekState, "current");
  assert.equal(surfaces.commitments.length, 2);
  assert.equal(
    new Set(surfaces.commitments.map((row) => row.supplyId)).size,
    2,
  );
  assert.equal(
    new Set(surfaces.commitments.map((row) => row.locationId)).size,
    2,
  );
  assert.equal(new Set(surfaces.commitments.map((row) => row.address)).size, 2);
  for (const commitment of surfaces.commitments) {
    assert.ok(commitment.exactItem.length > 0, "a commitment names its item");
    assert.ok(
      commitment.committedQuantity > 0,
      `${commitment.supplyId} commits a quantity`,
    );
    assert.ok(
      commitment.substituteItem,
      `${commitment.supplyId} shows its fallback`,
    );
    assert.ok(
      (commitment.fallbackAvailable ?? 0) > 0,
      `${commitment.supplyId} has substitutes still reserved`,
    );
  }

  /* Member Places. The sample member is admitted and inside coverage, and sees
     both counters backing their week — with a drive time and a state, and no
     unit count anywhere in the copy. A member is promised a benefit on their
     pass, never by a shelf number on a map. */
  assert.equal(surfaces.admitted, true);
  assert.equal(surfaces.inCoverage, true);
  assert.equal(surfaces.weekState, "current");
  assert.equal(surfaces.places.length, 2);
  assert.equal(new Set(surfaces.places.map((place) => place.supplyId)).size, 2);
  for (const place of surfaces.places) {
    assert.ok(place.name.length > 0, "a place names its store");
    assert.ok(place.address.length > 0, "a place names where it is");
    assert.equal(typeof place.driveMinutes, "number");
    assert.equal(place.state, "ready");
    assert.ok(
      !/\d/.test(place.why),
      `member copy carries no counts: ${place.why}`,
    );
  }

  /* Operator four-week backing. All four weeks are planned, so the panel
     compares real supply against the owed cohort for each of them rather than
     showing one week and three blanks. */
  assert.equal(surfaces.weeks.length, 4);
  assert.equal(surfaces.weeks[0].counters, 2);
  for (const week of surfaces.weeks)
    assert.ok(week.counters >= 1, `${week.week_key} is backed`);
});

test("the demo's workspace buttons land on the repaired surfaces", () => {
  /* `/merchant/results` is the growth-programme reporting section: it renders
     no commitment, no counter, no terms and no fallback. The merchant half of
     this demo is the overview at `/merchant`, and the operator half is the
     pilot command centre. Changing either is a decision, not a typo. */
  assert.deepEqual(DEMO_WORKSPACE_PATHS, {
    merchant: "/merchant",
    operator: "/operator/pilot",
  });
});
