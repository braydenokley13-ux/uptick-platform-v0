import assert from "node:assert/strict";
import test from "node:test";
import { marketWeekWindow } from "../src/lib/network";

// These cases are fixed instants, so they assert the same thing on every
// weekday the suite happens to run. Pilot weeks are Monday-keyed in the
// Market Cell's own timezone, which is what the weekly release checks.
const ZONE = "America/New_York";

function localParts(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

test("a Monday instant opens its own pilot week", () => {
  // 2026-09-14 is a Monday. 00:05 local is just after the boundary.
  const window = marketWeekWindow(new Date("2026-09-14T04:05:00Z"), ZONE);
  assert.equal(window.weekKey, "2026-09-14");
  assert.match(localParts(window.start), /^2026-09-14, 00:00$/);
  assert.match(localParts(window.end), /^2026-09-21, 00:00$/);
});

test("late Sunday still belongs to the week that began the previous Monday", () => {
  // 2026-09-20 is a Sunday; 23:59 local is the last minute of that week.
  const window = marketWeekWindow(new Date("2026-09-21T03:59:00Z"), ZONE);
  assert.equal(window.weekKey, "2026-09-14");
  assert.match(localParts(window.end), /^2026-09-21, 00:00$/);
});

test("the very first minute of Monday opens the next week, not the previous one", () => {
  const lastMinute = marketWeekWindow(new Date("2026-09-21T03:59:00Z"), ZONE);
  const firstMinute = marketWeekWindow(new Date("2026-09-21T04:01:00Z"), ZONE);
  assert.equal(lastMinute.weekKey, "2026-09-14");
  assert.equal(firstMinute.weekKey, "2026-09-21");
  assert.equal(
    lastMinute.end.toISOString(),
    firstMinute.start.toISOString(),
    "weeks must abut exactly, leaving no unowned gap between them",
  );
});

test("a spring-forward week is 167 hours and still starts at local midnight", () => {
  // US DST begins Sunday 2026-03-08, inside the week keyed 2026-03-02.
  const window = marketWeekWindow(new Date("2026-03-04T12:00:00Z"), ZONE);
  assert.equal(window.weekKey, "2026-03-02");
  assert.match(localParts(window.start), /^2026-03-02, 00:00$/);
  assert.match(localParts(window.end), /^2026-03-09, 00:00$/);
  assert.equal(
    (window.end.getTime() - window.start.getTime()) / 3600000,
    167,
    "the lost hour must shorten the week rather than shift its boundaries",
  );
});

test("a fall-back week is 169 hours and still starts at local midnight", () => {
  // US DST ends Sunday 2026-11-01, inside the week keyed 2026-10-26.
  const window = marketWeekWindow(new Date("2026-10-28T12:00:00Z"), ZONE);
  assert.equal(window.weekKey, "2026-10-26");
  assert.match(localParts(window.start), /^2026-10-26, 00:00$/);
  assert.match(localParts(window.end), /^2026-11-02, 00:00$/);
  assert.equal(
    (window.end.getTime() - window.start.getTime()) / 3600000,
    169,
    "the repeated hour must lengthen the week rather than shift its boundaries",
  );
});

test("every weekday in a week resolves to the same Monday key", () => {
  const keys = new Set<string>();
  for (let day = 0; day < 7; day++) {
    // 12:00 local on each day of the week beginning Monday 2026-09-14.
    keys.add(
      marketWeekWindow(
        new Date(Date.parse("2026-09-14T16:00:00Z") + day * 86400000),
        ZONE,
      ).weekKey,
    );
  }
  assert.deepEqual([...keys], ["2026-09-14"]);
});
