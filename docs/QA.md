> **Historical record.** This document describes an earlier implementation or review checkpoint. Use [current release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md) for this candidate’s fixes, evidence, verdicts and remaining gates. Earlier test counts, demo instructions and unresolved-gap statements are not current unless carried forward there.

# Refoundation QA record — September 10, 2026

This record covers the current Uptick membership refoundation. [VERIFICATION.md](VERIFICATION.md) describes the older merchant-first baseline and its successful production build; it is historical evidence, not verification of the latest integration.

## Verified locally

- The final Next.js 16.3.4 production build passed with TypeScript and one generation worker. The built app runs through `npm start` at localhost:3000.
- The final full unit/database suite passed **146/146 tests** with serial execution. This includes a later-week return fixture that checks merchant return counts, distinct source-member counts and exact mature retention windows. A duplicate receipt request does not create a return.
- **12/12** HTTP request integration tests passed against the production server. These check protected actions, origin/body/credential validation and unsigned callbacks.
- Full lint, TypeScript and formatting checks passed against the final files. The supplied source brief is preserved verbatim and excluded from automatic formatting.
- The real PostgreSQL 16 harness passed with migrations 001–013 and four independent sessions. It covered legacy and network claim/redemption races, immutable weekly choices, NFC replay/wrong-location checks, overlapping weekly preparation, referral limits/first-verification races, 200-member coverage and dedicated-sender separation. Its disposable cluster was cleaned up.
- Browser journey one: source join → explicit private-link confirmation → featured coffee claim → matching store QR redemption → durable receipt after reload → saved Your Uptick history.
- Browser journey two: public referral → new member confirmation → second-store alternative → wrong-store QR rejection → correct-store redemption → durable receipt after reload. The final operator referral report showed one verified referred member, one allocated, one claimed and one redeemed. Protected support correctly labeled the acquisition as a member invitation and masked the phone.
- Browser merchant/operator journey: saved Growth objective survived reload; a new breakfast Drop was revised to V2, submitted with 30 rewards, $0.75 per-item cost, a $22.50 guardrail and staff-Tap instructions, then explicitly approved in Network control. The approved saved terms and quantity remained visible.
- Operator messaging displayed simulated access records and zero delivered SMS. Current-week preparation produced zero new messages because both sample members had already claimed. Scheduler, future preparation and delivery-gate behavior are also covered by isolated automated tests.
- The operator NFC reference-vector button returned “simulated success,” explicitly stating no production redemption or hardware test. Automated tests exercise the verifier and isolated test ledger.
- Phone inspection at 390 pixels covered join fields/consent, Your Uptick and durable saved redemption. Desktop inspection covered merchant and operator workspaces. Exact test viewports are recorded observations, not a claim of testing every device.

## External qualification remains

Hosted staging still needs managed PostgreSQL/Supabase credentials, actual Auth users, separate secrets, a canonical HTTPS origin, scheduler configuration and legal/support identity. Real SMS additionally needs the approved dedicated membership sender and platform registration, Twilio credentials and allowlisted internal recipients. Physical NFC needs programmed tags, installation, phone/counter validation and cashier training. None of these external outcomes is established by local tests.

The disk-space incident was resolved by removing approximately 2.2 GiB of abandoned runtime installer staging caches and 230 MiB of disposable package cache. Installed runtimes, user documents and application data were preserved. Available disk space still fluctuates with other applications. `predev` requires 256 MiB, `prebuild` requires 768 MiB, and the PostgreSQL harness checks its own temporary-volume margin. Serial tests and the low-disk build mode reduce pressure; these checks do not reserve disk space.

## Test map

| Area                           | File / command                                 | What it checks                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Membership domain              | `tests/network.test.ts`                        | Explicit access/consent, market eligibility, immutable weekly allocation, one chosen claim, inventory and coverage.                                              |
| Member experience              | `tests/member-experience.test.ts`              | Private weekly access, saved history, preferences/referrals and bounded message preparation.                                                                     |
| Membership messaging           | `tests/member-messaging.test.ts`               | Dedicated sender, queue ownership, consent, environment/allowlist gates, callbacks, STOP/START and protected staging identities.                                 |
| Operator network               | `tests/network-operations.test.ts`             | Market/source integrity, saved supply approval, budgets, Tap readiness, masked messaging/support and operator access.                                            |
| Merchant Growth                | `tests/merchant-growth.test.ts`                | Tenant-scoped Growth plans, inventory commitments, draft revisions and metric boundaries.                                                                        |
| Old/new program boundary       | `tests/legacy-network-boundary.test.ts`        | New membership supply cannot accidentally enter the retained merchant broadcast or direct-redemption flow.                                                       |
| Uptick Tap                     | `tests/tap.test.ts`                            | Store/policy checks, QR/NFC evidence, cryptographic vectors, replay/counters, quantity/expiry, duplicate outcomes and isolation.                                 |
| Navigation                     | `tests/location-intelligence.test.ts`          | Valid recorded destinations, fixed provider URLs, encoding, missing data and honest manual-estimate labels.                                                      |
| Existing core                  | `tests/core.test.ts`, `tests/operator.test.ts` | Durable legacy offers/passes, original tenant controls, reviewed messaging and consent boundaries.                                                               |
| Readiness / requests           | `tests/launch.test.ts`, `tests/http.test.ts`   | Platform gates, request limits and rejection behavior.                                                                                                           |
| Isolated old-program rehearsal | `tests/internal-testing.test.ts`               | Requested internal recipients, separate test records and no production metric writes.                                                                            |
| HTTP boundary integration      | `npm run test:e2e`                             | Running Next server: rejected origins, oversized/invalid inputs, protected actions and unsigned callbacks. This is request testing, not full browser automation. |
| Production compilation         | `npm run build`                                | Current Next.js/React route compilation and production output.                                                                                                   |
| Real PostgreSQL                | `bash scripts/verify-postgres.sh`              | Production driver and cross-session races in its own disposable cluster, including the imported membership harness. No existing database is used.                |

The normal `npm test` command runs files serially. To inspect one area without a large parallel workload, use `node --import tsx --test tests/AREA.test.ts`. A passing targeted test does not replace the consolidated run recorded for this release.

## Browser acceptance path

Use explicit development transport and fictional phone numbers locally, or approved internal recipients in a separate configured staging database.

1. Open `/join/river-house` after seeding locally. Verify source identity, clear membership value, home ZIP input and explicit membership consent copy.
2. Submit the requested access link, open it and confirm the displayed choice. Reloading a GET must not confirm phone possession or membership by itself.
3. Review featured/alternative Drops and saved qualification, location, hours, inventory and directions. Claim one; repeat requests must return the saved entitlement rather than a second claim.
4. Prepare the pass for Tap, open the correct store point in the same browser profile and explicitly redeem. Wrong-store/revoked/expired paths must remain blocked. Reload the successful Tap screen and return to Your Uptick; both must preserve the recorded outcome.
5. Change membership preferences and inspect exact consent evidence in protected member support. A merchant workspace must not expose the network’s raw member phone list.
6. Create a new merchant Drop draft and Growth commitment; review it as an operator. Revise the draft and confirm stale submission approval is rejected until the current version is resubmitted. Confirm active Tap readiness and inventory guardrails.
7. Prepare the weekly membership queue, inspect sanitized copy and masked records, then process the simulated queue. Development must never appear as delivered. With real staging setup, verify allowlist, provider callbacks, STOP and fresh consent after START.
8. Check member, merchant and operator layouts at 390 pixels and desktop width. Wide data tables may scroll internally; the page itself must not overflow.

## Evidence boundaries

A static QR is copyable. Authenticated NFC proves accepted tag data/counter use, not a receipt or purchase. Staff-controlled configuration is an operating policy. Directions clicks establish only a map handoff request. Acquisition loads may include previews and repeated loads. Matching/coverage is derived from records, not a traffic forecast. Carrier delivery is not a read. Local sample business names, addresses, agreements and coordinates remain illustrative.

No hosted deployment, real Supabase connection, actual SMS delivery, live registration approval or physical NFC programming is established by this checkpoint. Keep private member/pass/tag credentials out of screenshots, documentation, logs and Git. External setup details are in [TWILIO.md](TWILIO.md), [UPTICK_TAP.md](UPTICK_TAP.md) and [LOCATION_INTELLIGENCE.md](LOCATION_INTELLIGENCE.md).
