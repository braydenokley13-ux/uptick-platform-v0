/** Pure destination handoff helpers. No location permission, tracking or provider request. */
export type CoordinateValue = number | string | null | undefined;
export type Destination = {
  address?: string | null;
  latitude?: CoordinateValue;
  longitude?: CoordinateValue;
};
export type Coordinates = { latitude: number; longitude: number };
export type MapProvider = "apple" | "google" | "waze";
export type NavigationOption = {
  provider: MapProvider;
  name: string;
  url: string;
  action: "directions" | "search";
  destinationEvidence: "recorded_coordinates" | "recorded_address";
};
function coordinate(value: CoordinateValue, min: number, max: number) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim())
  )
    return null;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}
export function recordedCoordinates(
  destination: Destination,
): Coordinates | null {
  const latitude = coordinate(destination.latitude, -90, 90);
  const longitude = coordinate(destination.longitude, -180, 180);
  return latitude === null || longitude === null
    ? null
    : { latitude, longitude };
}
function recordedDestination(destination: Destination) {
  const coordinates = recordedCoordinates(destination);
  if (coordinates)
    return {
      value: `${coordinates.latitude},${coordinates.longitude}`,
      coordinates,
      evidence: "recorded_coordinates" as const,
    };
  const address = destination.address?.trim();
  if (!address) return null;
  // Keep the destination as data inside URLSearchParams, never as a URL or host.
  return {
    value: address,
    coordinates: null,
    evidence: "recorded_address" as const,
  };
}
function providerUrl(base: string, values: Record<string, string>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(values))
    url.searchParams.set(key, value);
  return url.toString();
}
export function navigationOptions(
  destination: Destination,
): NavigationOption[] {
  const target = recordedDestination(destination);
  if (!target) return [];
  return [
    {
      provider: "apple",
      name: "Apple Maps",
      url: providerUrl("https://maps.apple.com/", {
        daddr: target.value,
        dirflg: "d",
      }),
      action: "directions",
      destinationEvidence: target.evidence,
    },
    {
      provider: "google",
      name: "Google Maps",
      url: providerUrl("https://www.google.com/maps/dir/", {
        api: "1",
        destination: target.value,
        travelmode: "driving",
        dir_action: "navigate",
      }),
      action: "directions",
      destinationEvidence: target.evidence,
    },
    {
      provider: "waze",
      name: "Waze",
      url: providerUrl(
        "https://waze.com/ul",
        target.coordinates
          ? { ll: target.value, navigate: "yes", utm_source: "uptick_local" }
          : { q: target.value, utm_source: "uptick_local" },
      ),
      // Waze documents address lookup separately from coordinate navigation. An
      // address-only handoff asks the member to choose the correct search result.
      action: target.coordinates ? "directions" : "search",
      destinationEvidence: target.evidence,
    },
  ];
}
export function recordedLocationUrl(destination: Destination): string | null {
  const target = recordedDestination(destination);
  return target
    ? providerUrl("https://www.google.com/maps/search/", {
        api: "1",
        query: target.value,
      })
    : null;
}
export function operatorDriveEstimate(value: CoordinateValue) {
  const minutes = coordinate(value, 1, 180);
  if (minutes === null || !Number.isInteger(minutes))
    return {
      minutes: null,
      evidenceClass: "unavailable" as const,
      source: null,
      label: "Travel time unavailable",
    };
  return {
    minutes,
    evidenceClass: "estimated" as const,
    source: "operator" as const,
    label: `${minutes} min · operator estimate`,
  };
}
