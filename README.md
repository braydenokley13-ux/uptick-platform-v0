# Uptick Local

Uptick Local is a free local consumer membership. Uptick Growth is the merchant demand product, and an Uptick Drop is the recurring member benefit.

The primary product loop is **acquisition partner or direct join → explicit Uptick membership → useful local weekly choices → one claimed Drop → destination verification → recorded redemption → next week**. A convenience store supplies the perk. It does not receive an unrestricted member phone list or independent marketing permission.

This repository is the operating application. The separate `upticklocal` repository remains the canonical marketing/brand reference. The application keeps Uptick’s marine, warm canvas, mint and amber visual system while separating simple member and merchant experiences from more powerful operator controls.

**Current verification:** the refoundation runs in a successful local production build. The member, referral, two-store redemption, merchant commitment and operator approval journeys have been exercised in the browser. The real PostgreSQL race harness passed with migrations 001–013. Final test counts and the distinction between software verification and hosted/physical launch are recorded in [QA](docs/QA.md), [the release report](docs/REFOUNDATION_RELEASE.md) and [the resumable checkpoint](docs/HANDOFF.md). No public deployment or real SMS delivery is claimed.

## Start locally, one step at a time

1. Open a terminal in this repository. Use Node 22.13 or newer; the existing development environment used Node 26.3.1.
2. Check free storage with `df -h .`. Dependency installation needs substantial space. Leave at least 2 GiB before a fresh install and avoid running another build at the same time. The app checks for 256 MiB before development startup and 768 MiB before a production build; these are minimum guards, not a guarantee that unrelated applications will stop consuming storage.
3. If dependencies are missing, run `npm ci`. If `node_modules` is already present and matches the lockfile, there is no need to reinstall for every session.
4. If `.env.local` does not exist, copy `.env.example` to `.env.local`. Preserve an existing file. For the local sample, set `UPTICK_ENV=development`, `UPTICK_LOCAL_MODE=true`, `SMS_TRANSPORT=development`, `APP_URL=http://localhost:3000` and `UPTICK_LOW_DISK=true`.
5. Stop any existing Uptick server before seeding. Run `npm run db:seed`. This applies forward migrations and creates the illustrative River Neighborhood Market Cell, two gas/convenience-store destinations, acquisition partners, four weeks of sample free Drop supply and sample Tap points. It creates no members, claims, redemptions or delivered messages.
6. Run `npm run dev -- --webpack`. Wait for the server to report that it is ready, then open [localhost:3000](http://localhost:3000).
7. Open [the local workspace login](http://localhost:3000/login) when you want the merchant or operator view. Local identity buttons require the explicit development environment, a loopback origin and no Vercel hosting context.
8. Keep only one process connected to `.data/uptick`. Stop the server before rerunning the seed or migration command. The local PGlite database is a single-process development transport, not a hosted production database.

The seed is repeatable without resetting existing activity. Once the sample market exists, rerunning it does not erase or extend its saved offer windows. Use Offer Studio and operator supply review to add later weeks. Sample addresses, coordinates and partnerships are illustrative; no real installation or agreement is asserted.

`UPTICK_LOW_DISK=true` disables webpack disk caching and reduces generated development storage. It trades rebuild speed for less disk use. It does not eliminate the need for storage. If the startup/build guard stops a command, recover a safe margin before retrying; do not repeatedly launch it into a full disk.

## Try the member loop locally

1. Open [the River House acquisition page](http://localhost:3000/join/river-house). The sample market serves ZIPs `10583`, `10530` and `10606`.
2. Enter a fictional US phone number such as `(201) 555-0123`, your sample home ZIP and the displayed membership choice. Development transport sends no SMS.
3. Open the clearly labeled local access link returned by the form. Review the exact disclosure and deliberately confirm your phone and membership choice. Merely loading the private link confirms neither.
4. On **Your Uptick**, inspect the featured free perk and available alternatives. Claim one. Allocation, claim and inventory reservation are separate records; the saved inventory policy controls whether claiming reserves an item.
5. Open the private pass and choose its Tap preparation action. In the operator workspace, open **Uptick Tap** and the matching sample destination’s redemption QR/link. Use the same browser profile so its private pairing cookie is present. This is a software rehearsal, not a physical-store visit.
6. Confirm redemption explicitly. Check the green result, saved reward and timestamp. Return to **Your Uptick** to inspect the durable redeemed record. Another weekly choice must not create a second entitlement for the same member/week.
7. Inspect **Operator → Market network → Members & cohorts** and **Member messaging**. The ledger distinguishes simulation, provider acceptance and delivery. Protected support can find the exact normalized phone even before a first claim, and returns masked results without private credentials.

A static location QR proves use of a store credential, not physical presence or purchase. Secure NFC adds authenticated tag/counter evidence when real hardware is provisioned. Staff-controlled configuration does not digitally prove that a cashier checked a receipt. See [Uptick Tap setup and evidence](docs/UPTICK_TAP.md).

## Product surfaces

| Audience          | Main surfaces                                                                                             | Purpose                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Members           | `/`, `/join/{source}`, `/your-uptick`, `/u/{privateAccess}`, `/p/{privatePass}`, `/r/{referral}`          | Join, confirm membership, view weekly choices, claim, redeem, manage preferences and share allowed invitations.                     |
| Merchants         | `/merchant`, Growth Plan, Your Drop, Local Demand, Your Network, Results and Offer Studio                 | Set a demand objective, propose a free reward, commit inventory/economics and inspect attributable outcomes.                        |
| Operators         | `/operator/network`                                                                                       | Market Cells, destination links, acquisition partners/sources, supply review, capacity-aware allocation and source/member evidence. |
| Operators         | `/operator/network/messaging`, `/operator/network/members`, `/operator/tap`                               | Configure the membership sender, prepare/review/dispatch, inspect a protected member journey, and manage redemption points.         |
| Retained programs | Existing customer claim/pass routes, operator business/placement/review tools and isolated internal tests | Honor existing issued promises and independent merchant consent without enrolling those customers automatically in membership.      |

All metrics are based on saved records. Source loads may include previews and repeats; they are not impressions or unique people. Weekly coverage counts a member already served, reserved or matched to remaining supply once. It is not a count of new claims available now. Future coverage uses today’s members and saved supply without reserving inventory across weeks. Directions handoff is not an arrival; a redemption is not a verified purchase; a provider delivery callback is not a read.

## Configure a real Market Cell

1. Provision the managed database, authentication, independent secrets and HTTPS described below. Keep staging separate from production.
2. Create the actual operator and merchant businesses/locations. Start with one tight gas-station/convenience-store market, not arbitrary broad geography. Replace sample locations with verified addresses and record manual travel estimates as estimates.
3. In **Market network → Markets**, define the operating boundary, timezone and explicit home/work ZIP coverage. Connect the participating merchant locations.
4. In **Acquisition**, create actual partners and a source for each channel/campaign. Each public membership link/QR preserves its original source attribution. A partner receives aggregate adoption, not a resident/member list.
5. In the merchant workspace, set the Growth objective and create the free Drop in Offer Studio. Save its exact dates, qualification, reward, economics and staff instructions. Submit the inventory and verification commitment for review.
6. Configure the location’s real Uptick Tap points. Staff policy requires an active staff point; public policy also needs a staff fallback. Saving a point does not certify physical installation or staff training.
7. Review and approve the current saved offer version and supply commitment. Superseded versions must be resubmitted. Approved promises remain fixed; later inventory changes use an audited adjustment. Check this week and future supply coverage before promising a recurring benefit.
8. Configure the dedicated Uptick membership sender, reviewed disclosures and internal staging recipients. Rehearse the actual join/consent/claim/Tap/redemption flow, then inspect the next-week queue and provider outcomes before public distribution.

Do not use the illustrative seed in production. No screen playback platform, POS transaction verification, forecasted incremental visits or automated campaign registration is implied by these controls.

## Managed PostgreSQL and Supabase authentication

1. Create the intended Supabase project and database. Set the server-side `DATABASE_URL`; the postgres driver disables prepared statements for transaction pooling. Browser clients must not receive this credential.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` for server-side password sign-in. Create the actual first operator Auth user in that project.
3. Generate separate random values for `PASS_ENCRYPTION_KEY`, `SESSION_SECRET` and `CRON_SECRET`, for example using `openssl rand -hex 32` separately for each. Store them in a secret manager, never Git. Preserve the encryption key needed for existing saved credentials.
4. Set `UPTICK_ENV=staging` or `production`, `UPTICK_LOCAL_MODE=false` and the canonical HTTPS `APP_URL`. Run `npm run db:migrate` with that intended environment loaded. The repository uses forward SQL migrations in filename order, tracked in `schema_migrations`; local-mode scripts must never be pointed at a production database.
5. For the one-time operator bootstrap, set `OPERATOR_AUTH_USER_ID` to the existing user’s actual UUID and `OPERATOR_ORGANIZATION_NAME` to the real operating organization. Use an administrator database connection for `npm run bootstrap:operator`. The script verifies `auth.users`, creates the organization/membership atomically and audits the action. It creates no password or runtime bypass.
6. Replace the administrator connection with the intended server database role. Sign in at `/login`. Every operation rechecks live membership; merchant scope is enforced server-side. Browser database roles have no policies granting direct private-table access.

For protected staging personas, `STAGING_TEST_USER_IDS` allows only listed, authenticated users who still have a live operator membership. It is not a public demo login. Verify the real Supabase JWT/session/RLS integration in staging; local identities do not prove it.

## Messaging and external delivery gates

The primary recurring sender is **Uptick Local → Uptick member**. Its sender, exact consent history, suppression and outbox are independent of retained merchant programs. See [Twilio setup](docs/TWILIO.md) and [membership messaging architecture](docs/MEMBERSHIP_MESSAGING.md).

- `development` never sends real SMS. Simulated records are labeled `development`, never delivered.
- Staging with Twilio requires the actual credentials, approved sender/platform/legal setup and exact allowed internal recipient numbers in `INTERNAL_TEST_NUMBERS`. An empty or malformed list disables real staging sends.
- Production also requires `PRODUCTION_DELIVERY_ENABLED=true`. A Vercel preview cannot select the production environment.
- `/api/cron` requires the configured bearer secret. It prepares membership weeks and processes bounded legacy/member queues. A one-minute schedule is declared in `vercel.json`; provision a hosting plan or authenticated scheduler that actually supports it.
- Operator **Member messaging** exposes sender configuration, readiness, exact sanitized copy, current-week preparation, explicit reviewed dispatch and the outcome ledger. Unknown provider outcomes are not retried automatically.
- STOP pauses the affected membership program; START clears suppression without silently renewing consent. Separate merchant programs retain their own consent and sender behavior.

The isolated older merchant test ledger at `/operator/testing` remains available and does not change production metrics. It is not a substitute for testing the actual new membership loop in a separate staging database. Real Twilio registration, legal review, sender approval, carrier callbacks, DNS, physical Tap/NFC installation, monitoring, backups and staff training remain external work.

## Verify and release

Use [docs/QA.md](docs/QA.md) for the current evidence, targeted test map and outstanding checks. The older [verification record](docs/VERIFICATION.md) documents the pre-refoundation baseline; its successful build must not be mistaken for a final build of the current integration.

With a safe disk margin, run the checks in sequence:

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

`npm test` runs test files serially to reduce memory and temporary-storage pressure. For HTTP boundary checks, run `npm run test:e2e` against a controlled local/test server. To exercise the production build, start it with `npm start` and set `PLAYWRIGHT_BASE_URL=http://localhost:3000` for that HTTP run. The request tests do not replace browser interaction checks.

The isolated real-PostgreSQL harness is `bash scripts/verify-postgres.sh`. It requires local PostgreSQL executables and at least 768 MiB free in `/tmp`, creates only its own disposable local cluster, and ignores any existing `DATABASE_URL`. See [the harness record](docs/POSTGRES_VERIFICATION.md). Stop the app before any independent script opens its local PGlite data directory.

Before public traffic, configure the managed services and real records, apply all migrations, complete the fresh production/HTTP/browser/PostgreSQL checks, verify signed callbacks and staging recipient limits, and establish operating recovery procedures. Redact private `/u/*`, `/p/*`, `/t/*` and Tap credential/query paths in hosting/proxy logs; application logging settings cannot control upstream logs. Keep third-party analytics away from private member pages.

Continue committing coherent green checkpoints on the working branch. Do not merge `main` automatically. A local sample journey, protected test mode or saved approval checkbox is not a live customer launch.
