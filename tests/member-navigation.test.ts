/* No tab in the member bar may lead nowhere.

   `Places` was in the bottom bar for as long as the bar existed, and
   `?view=places` rendered Home with Home still lit. The bar was declared in the
   component and the views were decided in the page, so nothing connected the
   two and nothing failed. This test is that connection. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  activeMemberTab,
  memberTabs,
  memberView,
  memberViews,
} from "../src/lib/member-views";

test("every tab that stays on the member page names a view the page renders", () => {
  for (const tab of memberTabs) {
    const query = tab.href.startsWith("/your-uptick")
      ? new URL(tab.href, "http://local").searchParams.get("view")
      : null;
    assert.equal(
      tab.view ?? null,
      query,
      `${tab.label} links to ${tab.href}, which does not match its declared view`,
    );
    if (query)
      assert.ok(
        (memberViews as readonly string[]).includes(query),
        `${tab.label} points at ?view=${query}, which the page does not render`,
      );
  }
});

test("every view lights its own tab, and only its own", () => {
  const lit = new Set<string>();
  for (const view of memberViews) {
    const tab = activeMemberTab(view);
    assert.notEqual(
      tab,
      "Home",
      `?view=${view} leaves Home lit, which is what made Places look broken`,
    );
    assert.ok(!lit.has(tab), `${tab} is lit by more than one view`);
    lit.add(tab);
  }
  assert.equal(
    lit.size,
    memberViews.length,
    "each view owns exactly one tab in the bar",
  );
});

test("an unknown or missing view is Home, not a degraded page", () => {
  for (const raw of [undefined, "", "places ", "PLACES", "nonsense"]) {
    assert.equal(memberView(raw), undefined);
    assert.equal(activeMemberTab(raw), "Home");
  }
});
