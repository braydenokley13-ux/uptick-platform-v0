# Uptick refoundation — verified local checkpoint

## Start here, one step at a time

1. Open `/Users/braydenwhite/Desktop/uptick-platform-v0`.
2. Read this file, [the release report](REFOUNDATION_RELEASE.md), [QA](QA.md) and the source [refoundation brief](REFOUNDATION_BRIEF.md).
3. Run `git status --short` and `git log -5 --oneline`. Preserve any later uncommitted work. Continue on `codex/uptick-operating-platform`; do not merge main automatically.
4. Check free space with `df -h .` and the existing server with `lsof -nP -iTCP:3000 -sTCP:LISTEN`. Do not launch a second server into an occupied port or a second process against `.data/uptick`.
5. The latest application checkpoint is `83ec668`. Application and documentation checkpoints are pushed together at completion; documentation follows in a separate commit. Use `git rev-parse HEAD` and `git ls-remote origin refs/heads/codex/uptick-operating-platform` for the actual latest local/remote SHA.
6. The final production build succeeded, and `npm start` was left running on localhost:3000. If it has stopped, run `npm start` while the built `.next` exists. After source changes, stop it, build once with a safe margin, then restart. For development use `npm run dev -- --webpack`.

## What is complete locally

Uptick membership is the primary consumer relationship. Member join/consent/private-link confirmation, featured and alternative weekly choices, inventory-safe claim/reservation, directions, QR/Tap redemption, durable receipts/history, preferences and referrals are implemented. Merchant Growth supplies objectives, inventory/economics and staff commitments; the operator approves the exact saved version. Operators manage Market Cells, partners/sources, supply, allocation, coverage, messaging, protected support, evidence and cohorts.

Migrations 001–013 are forward migrations. Existing claims, legacy merchant programs, consent and approved history remain preserved; old campaign actions cannot take over a network Drop. See [the release report](REFOUNDATION_RELEASE.md) for the detailed scope and Git history.

The sample has one Market Cell, two convenience stores, three acquisition sources and four weeks of approved supply. `/join/river-house` is the source entry. Sample geography and partnerships are illustrative. The seed creates no member activity. Local browser QA subsequently created two fictional members, one referral and two redemptions, plus a merchant breakfast commitment approved for September 17. Do not export or document their private links.

## Verification at completion

- **146/146** unit/database tests passed.
- The final Next.js production build passed, with one worker and TypeScript.
- **12/12** request-level HTTP integration tests passed against the built server.
- Full lint, TypeScript and formatting checks passed after final integration.
- Real PostgreSQL 16 concurrency harness passed with migrations 001–013 and four separate sessions; its disposable cluster was cleaned up.
- Actual browser checks covered source join, explicit confirmation, featured claim, referral join, alternative claim, wrong-store rejection, correct-store redemption and receipt reload, mobile layouts, merchant saved objectives/commitment and operator approval, referral reporting/support, simulated messaging and isolated NFC reference rehearsal.

Automated later-week fixtures verify return and mature retention reporting. Two real calendar weeks were not spent in a live pilot; no such outcome is claimed.

## Disk and local database

The earlier failure was disk space, not a model limit. Approximately 2.2 GiB of abandoned runtime installer staging caches and 230 MiB of disposable package cache were removed. Installed runtimes, user documents and app data were preserved. Available space remains affected by other applications; do not assume the recovered amount stays free.

- `predev` requires 256 MiB; `prebuild` requires 768 MiB.
- `UPTICK_LOW_DISK=true` disables webpack disk cache and limits generation workers.
- `npm test` runs test files serially.
- The PostgreSQL harness requires 768 MiB before initialization and 512 MiB afterward and cleans its own cluster.
- PGlite `.data/uptick` supports one process. Stop the app before a separate seed/migration operation. Unit tests use separate memory databases.
- Preserve `.env.local`, encryption keys and local data. Do not delete unrelated user files, runtime installations, or old media directories to make space.

## External work required for a real pilot

No hosted deployment or real SMS was performed. No managed database/auth credentials, approved dedicated Uptick sender or physical NFC hardware were available.

1. Provision separate hosted staging with PostgreSQL/Supabase, actual Auth users, independent secrets, HTTPS origin, scheduler and legal/support identity. Apply all migrations and bootstrap the operator using the documented script.
2. Configure the dedicated membership Messaging Service, real sender and reviewed provider approvals. Set exact internal recipients. Verify real authentication/tenant isolation, signed callbacks, STOP/START and consent re-entry on that staging environment.
3. Program real NFC tags and validate multiple phones, counters/replay, QR fallback, placement and staff instructions. The tested cryptographic adapter does not prove physical installation or purchase verification.
4. Replace illustrative places, partners, costs and supply with agreed pilot records; verify four weeks of stock, fallback capacity and support ownership.
5. Run the small live pilot and observe actual later-week returns before drawing retention or economics conclusions.

External setup: [membership messaging](MEMBERSHIP_MESSAGING.md), [Twilio](TWILIO.md), [Uptick Tap](UPTICK_TAP.md), [location intelligence](LOCATION_INTELLIGENCE.md), [PostgreSQL verification](POSTGRES_VERIFICATION.md).

## Rules to preserve

Read the relevant installed Next.js guide in `node_modules/next/dist/docs/` before route/component changes. Keep changes in coherent, tested commits and push regularly. Preserve immutable promise/consent/evidence history, geography and tenant boundaries, and all environment delivery gates. Allocation is not reservation; QR/NFC is not a digitally verified purchase; provider delivery is not a read. Never log or commit private access/pass credentials or tag keys.
