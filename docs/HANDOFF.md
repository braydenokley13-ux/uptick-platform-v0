# Uptick refoundation — resumable checkpoint

## Start here

1. Read this file and `docs/REFOUNDATION_BRIEF.md`.
2. Run `git status --short` and read the latest commits. Keep existing uncommitted work; other agents may be editing independent files.
3. Continue on `codex/uptick-operating-platform`. Never merge main automatically.
4. Read the relevant installed Next.js guides in `node_modules/next/dist/docs/` before changing routes/components.
5. Test each coherent change, commit its exact files, push when green, and update this note.

## Current checkpoint

The pre-refoundation application is clean and pushed at `11d62ae`. Its 57 domain/database tests, four HTTP tests, real PostgreSQL concurrency harness, lint, TypeScript, build and browser flows passed. These are the baseline, not evidence that the refoundation is done.

Refoundation is **in final integration and verification**, not externally launched. The committed foundation through `0c1d4fc` includes migrations 009–011, membership/market allocation, permanent QR and secure NFC verification, membership messaging, protected staging personas and network operations. Current integration work adds consumer pages, referral attribution and fair weekly preparation (013), merchant Growth commitments (012), member support, navigation, messaging controls and sample pilot seeding. Run `git status --short` to see which checkpoints have landed.

The local sample now has one Market Cell, two convenience stores, three acquisition sources and four weeks of approved supply. `/join/river-house` is the sample acquisition entry. No member activity was seeded: any records shown came from actual local test interactions. A browser check has completed signup → explicit private-link confirmation → featured claim → permanent location QR → recorded redemption. Full final browser and regression checks are still in progress.

## Resume carefully

1. Inspect running processes before starting the app. The current development command is `npm run dev -- --webpack`; use `UPTICK_LOW_DISK=true` to disable the optional webpack disk cache.
2. Never run a separate seed/migration process while the app has `.data/uptick` open. Unit tests use their own in-memory databases.
3. The full unit suite now runs one test file at a time to limit memory pressure. Run `npm test`, then lint/TypeScript, then the production build and HTTP checks.
4. Disk space on this machine has fluctuated below 500 MiB. New preflight guards refuse to start development below 256 MiB or a build/isolated PostgreSQL cluster below 768 MiB. A guard refusal is not a failed product test. Do not remove unrelated user files or bypass the margin.
5. Keep commits focused, update this note with actual results, push the feature branch and verify the remote SHA. Never merge main automatically.

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
