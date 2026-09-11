# Location and navigation, without continuous tracking

Uptick uses recorded merchant and acquisition-partner locations. The V0 relevance rule is explicit home or work ZIP membership in a Market Cell. An operator can also record a local drive-time estimate. None of these inputs establishes a measured route from a member's current position.

## What works

1. An operator saves a real address and, optionally, a latitude/longitude pair for a destination or acquisition partner.
2. The operator's Local map plots only valid, complete coordinates. Select a marker to inspect its supply or aggregate acquisition context, then open that recorded location in Google Maps.
3. A member can choose Apple Maps, Google Maps or Waze from a Drop or pass. These are ordinary HTTPS links. The chosen provider handles its own route preview or navigation.
4. If coordinates are absent or invalid, links use the saved address. Address-only Waze opens a destination search so the member can select the correct result. If neither an address nor coordinates exists, Uptick displays that directions are unavailable.
5. Uptick can record that the member selected a directions provider. This is an observed handoff request; it does not establish travel, arrival, redemption or purchase.

The shared implementation is `src/lib/location-intelligence.ts`. It is a pure URL and evidence-label layer: it does not contact a provider, access location APIs, or add an origin, member ID, phone number or private pass token to a provider URL. Destination text is encoded as a parameter inside a fixed provider URL. A location supplied in the database is **recorded**, not independently geographically verified.

## Provider contracts

- Apple uses `daddr` for the recorded destination and `dirflg=d` for driving. Omitting `saddr` leaves the starting point to the provider. See [Apple Map Links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html).
- Google uses its universal directions URL, `api=1`, `destination`, `travelmode=driving` and `dir_action=navigate`. Availability of an origin determines whether the provider opens navigation or a route preview. See [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).
- Waze uses `ll` with `navigate=yes` for coordinates, or `q` for an address search. The HTTPS URL can open the installed application or its web experience. See [Waze Deep Links](https://developers.google.com/waze/deeplinks?hl=en).

These official contracts were checked on September 10, 2026. URL tests validate the generated parameters, encoding, missing-data behavior and absence of member credentials. They do not prove a destination is correct or that a particular installed maps application completed a route.

## Evidence and limits

| Input or event                            | Class           | What it establishes                                                                 |
| ----------------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| Stored merchant / partner coordinates     | Observed record | An operator supplied coordinates; independent place verification remains necessary. |
| Home / work ZIP match                     | Derived         | The member's explicit ZIP matches the current Market Cell rule.                     |
| `drive_minutes`                           | Estimated       | An operator's estimate of typical local travel, labeled as such.                    |
| Blank, invalid or missing `drive_minutes` | Unavailable     | No travel time is displayed or invented.                                            |
| Directions link selected                  | Observed        | A member requested a handoff to that provider.                                      |
| Arrival, actual travel time, purchase     | Unavailable     | The link click alone does not establish any of these.                               |

The operator map is an interactive coordinate plot, not a road map or a measured trade-area polygon. It has no roads, traffic, geocoding, travel-time matrix or GPS trail. The external map link supplies the provider's geographic view. Sample coordinates remain labeled as illustrative and must be replaced or confirmed before real operation.

A five-minute operator estimate means **“5 min · operator estimate”**, not “5 minutes from you.” Zero, blank and malformed values remain unavailable. The app does not request browser geolocation or collect continuous location history.

## Next integration boundary

A later provider can supply a route estimate through a separate interface with its evidence source, calculation time, origin policy and expiry. Keep that result distinct from the current manual estimate. Any member route or location input requires an explicit, separate opt-in and retention policy. Provider credentials, route matrices, member tracking and turn-by-turn navigation inside Uptick are outside this build.
