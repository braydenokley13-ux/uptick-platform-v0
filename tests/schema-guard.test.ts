import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  schemaDrift,
  driftMessage,
  isMissingRelation,
  forgetSchemaDrift,
  UNDEFINED_TABLE,
} from "../src/lib/schema-guard";
import type { DB } from "../src/lib/db";

function ledger(applied: string[]): DB {
  return {
    query: async <T>(sql: string) => {
      if (sql.includes("schema_migrations"))
        return applied.map((name) => ({ name })) as T[];
      return [] as T[];
    },
    transaction: async () => {
      throw Error("not used");
    },
  };
}

const allMigrations = async () =>
  (await readdir(resolve("db/migrations")))
    .filter((n) => n.endsWith(".sql"))
    .sort();

test("a database carrying every migration reports no drift", async () => {
  forgetSchemaDrift();
  assert.equal(await schemaDrift(ledger(await allMigrations())), null);
});

test("a database behind the release names every missing migration", async () => {
  forgetSchemaDrift();
  const all = await allMigrations();
  // The exact production condition: hosted stopped at 021, source expects 034.
  const behind = all.filter((n) => Number(n.slice(0, 3)) <= 21);
  const drift = await schemaDrift(ledger(behind));
  assert.ok(drift, "expected drift to be reported");
  assert.equal(drift.applied, behind.length);
  assert.equal(drift.expected, all.length);
  assert.deepEqual(
    drift.missing,
    all.filter((n) => Number(n.slice(0, 3)) > 21),
  );
  // 027 creates location_outages: the table whose absence produced the original
  // unexplained runtime error.
  assert.ok(drift.missing.includes("027_location_outages.sql"));
});

test("the drift message names the gap, the command and that nothing is worked around", async () => {
  forgetSchemaDrift();
  const all = await allMigrations();
  const drift = (await schemaDrift(
    ledger(all.filter((n) => Number(n.slice(0, 3)) <= 21)),
  ))!;
  const message = driftMessage(drift);
  assert.match(message, /022_suppression_reconciliation\.sql through /);
  assert.match(message, /npm run db:migrate/);
  assert.match(message, /No data is changed/);
  assert.match(message, /nothing here works around the missing tables/);
});

test("an entirely unmigrated database is the most extreme drift, not a crash", async () => {
  forgetSchemaDrift();
  const missingLedger: DB = {
    query: async () => {
      throw Object.assign(
        new Error('relation "schema_migrations" does not exist'),
        {
          code: UNDEFINED_TABLE,
        },
      );
    },
    transaction: async () => {
      throw Error("not used");
    },
  };
  const drift = await schemaDrift(missingLedger);
  assert.ok(drift);
  assert.equal(drift.applied, 0);
  assert.equal(drift.missing.length, (await allMigrations()).length);
});

test("only undefined_table is treated as a missing relation", () => {
  assert.equal(isMissingRelation({ code: UNDEFINED_TABLE }), true);
  assert.equal(isMissingRelation({ code: "23505" }), false);
  assert.equal(isMissingRelation(new Error("nope")), false);
  assert.equal(isMissingRelation(null), false);
});

test("a non-relation error from the ledger read is never swallowed", async () => {
  forgetSchemaDrift();
  const broken: DB = {
    query: async () => {
      throw Object.assign(new Error("connection terminated"), {
        code: "57P01",
      });
    },
    transaction: async () => {
      throw Error("not used");
    },
  };
  await assert.rejects(() => schemaDrift(broken), /connection terminated/);
});
