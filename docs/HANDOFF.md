# Uptick refoundation — resumable checkpoint

## Start here

1. Read this file and `docs/REFOUNDATION_BRIEF.md`.
2. Run `git status --short` and read the latest commits. Keep existing uncommitted work; other agents may be editing independent files.
3. Continue on `codex/uptick-operating-platform`. Never merge main automatically.
4. Read the relevant installed Next.js guides in `node_modules/next/dist/docs/` before changing routes/components.
5. Test each coherent change, commit its exact files, push when green, and update this note.

## Current checkpoint

The pre-refoundation application is clean and pushed at `11d62ae`. Its 57 domain/database tests, four HTTP tests, real PostgreSQL concurrency harness, lint, TypeScript, build and browser flows passed. These are the baseline, not evidence that the refoundation is done.

Refoundation is **in progress**. Migration 009 and `src/lib/network.ts` now implement membership/access/consent, ZIP-to-market relevance, acquisition attribution, immutable weekly allocation, one chosen claim, configurable reservation policies, and capacity-constrained market coverage. Eleven focused network tests pass. New domain claims cannot use the old direct redemption action. No old subscriber is enrolled automatically.

The parallel messaging/Tap foundations have focused tests passing and are being committed separately. Consumer and operator UI integration remains in progress; do not treat the presence of these modules as product completion. Before browser testing, seed a deliberate network pilot fixture and restart the app to apply forward migrations.

## Work ownership during this session

- Root: migration 009, member/access/consent domain, eligibility/allocation/coverage, consumer portal, referral, integration, checkpoint commits.
- `tap_refoundation`: migration 010, permanent redemption points, QR/NFC credential verification and replay protection, Tap UI/tests/provisioning documentation.
- `membership_messaging`: migration 011, membership outbox/sender, development/staging/production send gates, signed callbacks and protected pilot personas.
- `network_operations`: operator Market/Acquisition/Supply/Allocation controls and aggregate reporting; subsequent merchant Growth integration.

## Required safeguards

- Reuse customers, immutable offer versions and durable claims. Preserve old issued passes and records.
- New recurring membership consent needs a new explicit choice and phone-possession confirmation. Merely loading a private link never confirms either.
- Public acquisition links never disclose an existing private member credential in staging/production.
- Eligibility, allocation, claim/reservation and redemption are separate saved facts. Allocation is not an inventory reservation.
- Supply quantity and timed reservations must hold under concurrent claims/redemptions. All redemption paths must enforce the new verification policy for network claims.
- QR proves possession of a location credential; NFC proves authenticated credential use. Neither proves a purchase. Staff-gated configuration is operational context, not digital receipt confirmation.
- Staging real SMS is restricted to server allowlisted internal recipients across **all** old and new send paths.
- No secret tag keys or private links in logs, audit detail, commits or analytics.
- Local PGlite data directory supports only one process. Stop the app before separately seeding/migrating that directory. Tests use separate in-memory databases.

## Completion sequence

1. Domain/schema tests and first green refoundation commit.
2. Consumer membership/Your Uptick mobile journey.
3. Tap and messaging integration with independently tested modules.
4. Operator market operations and merchant Growth refactor.
5. Supply/cohort/evidence reporting, maps/navigation and referrals.
6. Production build, HTTP and browser QA, real PostgreSQL races, final security audit.
7. Hosted staging only if real managed DB/auth/hosting credentials are available. Otherwise record exact external setup; never claim a local demo is a hosted pilot.

## External facts

No production credentials, Supabase project, approved membership sender, physical NFC hardware or tag provisioning were available at the prior checkpoint. No real SMS was sent. No public deployment was created. The prior build runs at localhost:3000 when its server is active. Check the current process before starting another.
