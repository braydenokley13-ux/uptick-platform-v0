import { test } from "node:test";
import assert from "node:assert/strict";
import {
  navigationOptions,
  recordedCoordinates,
  recordedLocationUrl,
  operatorDriveEstimate,
} from "../src/lib/location-intelligence";

test("recorded coordinates accept zero but never turn blank, partial or invalid data into a location", () => {
  assert.deepEqual(recordedCoordinates({ latitude: "0", longitude: 0 }), {
    latitude: 0,
    longitude: 0,
  });
  assert.equal(recordedCoordinates({ latitude: "", longitude: -73 }), null);
  assert.equal(recordedCoordinates({ latitude: " ", longitude: " " }), null);
  assert.equal(recordedCoordinates({ latitude: null, longitude: null }), null);
  assert.equal(
    recordedCoordinates({ latitude: 40, longitude: undefined }),
    null,
  );
  assert.equal(recordedCoordinates({ latitude: 91, longitude: -73 }), null);
  assert.equal(recordedCoordinates({ latitude: 40, longitude: -181 }), null);
  assert.equal(
    recordedCoordinates({ latitude: Infinity, longitude: NaN }),
    null,
  );
});

test("each provider receives documented driving parameters and only the saved destination", () => {
  const options = navigationOptions({
    latitude: "40.99123",
    longitude: "-73.799",
  });
  assert.equal(options.length, 3);
  const apple = new URL(options[0].url),
    google = new URL(options[1].url),
    waze = new URL(options[2].url);
  assert.equal(apple.origin, "https://maps.apple.com");
  assert.equal(apple.searchParams.get("daddr"), "40.99123,-73.799");
  assert.equal(apple.searchParams.get("dirflg"), "d");
  assert.equal(google.origin, "https://www.google.com");
  assert.equal(google.pathname, "/maps/dir/");
  assert.equal(google.searchParams.get("api"), "1");
  assert.equal(google.searchParams.get("destination"), "40.99123,-73.799");
  assert.equal(google.searchParams.get("travelmode"), "driving");
  assert.equal(google.searchParams.get("dir_action"), "navigate");
  assert.equal(waze.origin, "https://waze.com");
  assert.equal(waze.searchParams.get("ll"), "40.99123,-73.799");
  assert.equal(waze.searchParams.get("navigate"), "yes");
  for (const option of options) {
    assert.equal(option.destinationEvidence, "recorded_coordinates");
    assert.equal(option.action, "directions");
    const url = new URL(option.url);
    assert.equal(url.searchParams.has("origin"), false);
    assert.equal(url.searchParams.has("saddr"), false);
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(url.searchParams.has("memberId"), false);
  }
});

test("address-only Waze is an explicit search, and unavailable destinations produce no misleading links", () => {
  const options = navigationOptions({
    address: "118 Main Street, Scarsdale, NY 10583",
    latitude: "",
    longitude: "",
  });
  assert.equal(options.length, 3);
  assert.equal(options[2].action, "search");
  assert.equal(options[2].destinationEvidence, "recorded_address");
  const waze = new URL(options[2].url);
  assert.equal(
    waze.searchParams.get("q"),
    "118 Main Street, Scarsdale, NY 10583",
  );
  assert.equal(waze.searchParams.has("ll"), false);
  assert.equal(waze.searchParams.has("navigate"), false);
  assert.deepEqual(navigationOptions({ address: " " }), []);
  assert.deepEqual(navigationOptions({ latitude: NaN, longitude: -73 }), []);
  assert.equal(recordedLocationUrl({}), null);
});

test("destination punctuation cannot become query instructions or an external host", () => {
  const address =
    "Joe’s Fuel & Go / #2?origin=private&redirect=https://example.invalid";
  const options = navigationOptions({ address });
  assert.equal(new URL(options[0].url).searchParams.get("daddr"), address);
  assert.equal(
    new URL(options[1].url).searchParams.get("destination"),
    address,
  );
  assert.equal(new URL(options[2].url).searchParams.get("q"), address);
  for (const option of options)
    assert.equal(new URL(option.url).searchParams.has("redirect"), false);
  const map = new URL(recordedLocationUrl({ address })!);
  assert.equal(map.origin, "https://www.google.com");
  assert.equal(map.searchParams.get("query"), address);
  assert.equal(map.searchParams.get("api"), "1");
});

test("travel time is an explicitly labeled manual estimate, never invented from absent data", () => {
  assert.deepEqual(operatorDriveEstimate("5"), {
    minutes: 5,
    evidenceClass: "estimated",
    source: "operator",
    label: "5 min · operator estimate",
  });
  for (const value of [
    null,
    undefined,
    "",
    " ",
    0,
    -1,
    181,
    2.5,
    NaN,
    Infinity,
  ]) {
    const estimate = operatorDriveEstimate(value);
    assert.equal(estimate.minutes, null);
    assert.equal(estimate.evidenceClass, "unavailable");
    assert.equal(estimate.label, "Travel time unavailable");
  }
});
