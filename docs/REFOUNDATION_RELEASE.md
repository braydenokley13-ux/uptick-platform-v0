# Uptick Local refoundation release record

September 10, 2026 · local production build · feature branch only

## Product refoundation

The operating platform is now organized around a free Uptick Local member, a useful local market and an approved supply of recurring free perks. Uptick Growth is the merchant workspace. Your Uptick presents one featured benefit and at most two alternatives; a member chooses one each market-local week.

The interface follows the canonical Uptick brand: marine, warm canvas, mint actions, amber reward cues, Geist typography and Newsreader emphasis. Consumer and merchant views use a smaller set of decisions than the operator workspace.

## Built and exercised

| Area              | Implemented behavior                                                                                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consumer          | Partner/direct/referral join, phone/home ZIP/optional work ZIP, exact membership consent, private-link possession confirmation, Your Uptick, curated choices, claim, saved pass/history, preferences and allowed sharing.                                                                          |
| Merchant Growth   | Saved demand objectives, Drop drafts/versioning, reward costs, inventory and budget guardrails, dates/times, verification preference, staff/fallback instructions, operator submission, own results and deterministic next steps.                                                                  |
| Market operations | Market boundaries/ZIPs/timezones/states, merchant destinations, partners/agreements/sources, source QRs, supply review/approval/adjustments, eligibility/allocation reasons, current plus four future coverage weeks, issues, messaging, support and audit.                                        |
| Learning          | Source loads, joins and first confirmation, immutable presented choices, engagement, claims, navigation handoffs, verification evidence, referrals, distinct member cohorts, mature return windows, and recorded merchant returns. Unknown purchase, incrementality and profit remain unavailable. |
| Sample pilot      | One illustrative market, two stores, three acquisition sources and four weeks of approved supply. The repeatable seed does not fabricate member activity or partnerships.                                                                                                                          |

Actual local browser interactions created two fictional members and two store-specific redemptions. The second member joined through a referral and selected the alternative store; the first store's QR rejected that pass. Receipts survived reloads. A merchant created and submitted a 30-item breakfast commitment with a $22.50 reward guardrail, and the operator approved its saved V2 terms.

## Existing work reused and old assumptions replaced

Durable encrypted passes, transaction-safe claim/redemption, immutable offer versions, consent history, tenant checks, provider lifecycle, scheduling, placement/creative tools, operator controls and the SQL migration history remain in use. Existing issued passes and independent merchant programs are preserved.

New membership does not silently inherit merchant subscriptions. Merchant campaign approvals and broadcasts cannot take over network-owned Drop supply. A customer GET never confirms possession or membership by itself. Merchant Growth no longer revolves around selecting recipients or owning the network's phone list.

## Uptick Tap and NFC

Permanent public and staff-controlled location points have QR credentials, rotation/revocation, protected provisioning controls, explicit redemption, persistent receipts and exact evidence. The NFC adapter supports the NTAG424-compatible encrypted PICC/MAC flow and counter replay protection. NXP/NIST vectors, malformed proofs, wrong location, replay and transaction races pass in software. The operator reference rehearsal also returned simulated success in the browser and keeps its records separate.

Physical tag programming, hardware/phone interoperability, installation, tamper response and staff training are still unverified. A copied static QR cannot establish physical presence. Authenticated NFC proves accepted credential data/counter use; neither method digitally verifies a purchase.

## Twilio and environments

A dedicated Uptick membership sender, immutable consent, separate suppressions, requested access messages, fair bounded weekly preparation, current-eligibility checks and a masked outbox/outcome ledger are implemented. Development sends no SMS. Staging requires a protected real operator identity plus approved configuration and exact internal recipient allowlists. Production has an additional explicit delivery gate. STOP/START and signed callbacks have automated tests; unknown provider outcomes are not retried automatically.

No real carrier delivery occurred. Approved business/campaign registration, dedicated sender/service, actual credentials, legal/support identity and hosted callback validation remain external work.

## Maps and geography

Operator and merchant views show recorded local destinations, partner/distribution context and market supply. Apple Maps, Google Maps and Waze handoffs use recorded coordinates or a labeled address search; private member/pass credentials never enter the map URL. Manually recorded travel estimates are labeled as estimates. There is no continuous tracking, routing matrix or invented live ETA.

## Data and market truth

Migrations 009–013 add network membership/access/consent, Market Cells, partners/sources, approved supply and adjustments, immutable weekly allocation options, member claim mappings, demand events, permanent Tap credentials/evidence, separate membership messaging, Growth preferences, weekly preparation and referral first-verification attribution. Composite keys and server authorization protect tenant and geography boundaries; private tables have deny-by-default browser RLS.

Coverage counts each eligible member once using actual saved choices, reservations, redemptions and remaining capacity. It is not inventory multiplied by the number of alternatives. Future weeks project today's membership against saved future supply. Source/referral reports preserve overlap explicitly, and young cohorts do not report a misleading zero retention rate. Structured experiment and funding fields preserve an expansion path without adding an ML engine or enterprise marketplace.

## Verification

- **146/146** unit/database tests passed with serial execution.
- **12/12** request-level integration tests passed against the production server.
- Next.js production build, TypeScript, lint and formatting passed.
- Real PostgreSQL 16 harness passed with migrations 001–013, four independent sessions, network/legacy inventory races, NFC replay, referral races, overlapping weekly workers, sender separation and 200-member coverage. The temporary cluster was cleaned up.
- Browser checks covered mobile and desktop member, referral, two-store redemption, durable reload/history, merchant objective/commitment, operator approval, referral cohort/support, simulated messaging and isolated NFC rehearsal.
- Later-week return and exact mature retention windows use controlled in-memory historical fixtures. A weeks-long live pilot has not occurred.

Details and reproducible commands are in [QA](QA.md) and [PostgreSQL verification](POSTGRES_VERIFICATION.md). Managed Supabase JWT/RLS, real callbacks/carrier outcomes, physical hardware and production recovery still require the actual staging environment.

## Git checkpoints

Branch: `codex/uptick-operating-platform`. Final application checkpoint: `83ec668`. Application and documentation checkpoints are pushed together at completion; the documentation commit follows this application SHA. `git rev-parse HEAD` and `git ls-remote origin refs/heads/codex/uptick-operating-platform` identify the final matching SHA. Main was not merged.

- `370fd80` docs: checkpoint product refoundation mandate and resumption guide
- `def5bdb` refactor(domain): make Uptick membership and market supply network-primary
- `efdd3ec` feat(membership): add Uptick messaging and protected staging workspaces
- `f643316` test(network): verify inventory and Tap races on real PostgreSQL
- `87433ef` feat(tap): add location QR and authenticated NFC verification
- `0c1d4fc` feat(operator): operate market supply, acquisition, allocation and coverage
- `b037313` chore(dev): guard disk margins and run database tests serially
- `0edc869` feat(maps): add honest destination links and travel estimates
- `0a8a0cf` feat(membership): harden referrals, weekly preparation and saved passes
- `225d07a` feat(operator): add membership messaging and protected member support
- `18a8c34` feat(growth): add merchant commitments and isolate network approvals
- `e5c091b` feat(consumer): ship membership, Your Uptick and private mobile passes
- `cff2e77` fix(tap): restore durable receipts and verify network HTTP boundaries
- `9632c81` feat(pilot): seed an illustrative market with four weeks of supply
- `ce13fa3` fix(reporting): preserve referral attribution and verify recorded returns
- `83ec668` fix(consumer): label invalidated passes accurately in history

## Deployment and external blockers

The app is available locally at [localhost:3000](http://localhost:3000), with [member acquisition](http://localhost:3000/join/river-house), [workspace login](http://localhost:3000/login) and [network control](http://localhost:3000/operator/network). There is no new hosted staging URL.

Hosted launch needs a provisioned PostgreSQL/Supabase project, actual Auth users, independent secrets, HTTPS hosting, scheduler and legal/support identity. Real messaging and physical NFC have the additional requirements described above. Sample addresses, partnerships, costs and installation states must be replaced by actual agreed pilot records.

## Next five product steps

1. Provision the protected hosted staging environment and verify real authentication and tenant boundaries.
2. Complete the dedicated membership sender setup and rehearse real SMS only with approved internal recipients.
3. Program and install one real QR/NFC counter setup, test several phones and train the cashier.
4. Agree four weeks of useful supply and fallback stock with the first participating convenience stores and acquisition partners.
5. Run the small live market and measure actual later-week member use, reward cost and merchant outcomes before expanding.

## Disk-space recovery

The interruption was caused by disk space. Roughly 2.2 GiB of abandoned runtime installer staging caches and 230 MiB of disposable package cache were removed; installed runtimes, app data and user documents were preserved. The app now checks disk margins before large operations, runs tests serially and supports a build mode with disk caching disabled and one generation worker. These precautions reduce pressure but cannot reserve free space against other applications.
