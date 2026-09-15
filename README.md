# Uptick Local

Uptick is a free adult local membership: one useful, backed weekly benefit, a staff-presented QR and a recorded redemption. Uptick Growth is a managed four-week merchant program. V1 destinations are gas stations with convenience-store operations. Promotional SMS is optional; membership is not a merchant phone list.

## Run the safe founder demo

On this laptop, open Terminal and run these commands in order:

```sh
cd /Users/braydenwhite/Desktop/uptick-platform-v0
npm run demo:reset
npm run demo
```

Wait for **Ready**, leave Terminal running, and open [Demo Studio](http://127.0.0.1:3210/demo). Follow its buttons in order. Use the prefilled fictional number and ZIP. Press Control-C in Terminal to stop.

The launcher creates its own `.demo-studio` sample database, refuses hosted database/provider settings, forces simulated messaging and keeps demo credentials separate. No SQL, hidden IDs, environment changes, real phone or agent browser operation is needed. Node 22.13+ and installed dependencies are prerequisites; a new checkout needs `npm ci` once.

- [Complete demo instructions and troubleshooting](docs/DEMO_RUNBOOK.md)
- [Offline demo PDF](output/pdf/uptick-founder-demo.pdf)
- [Desktop and phone screenshots](docs/demo/screenshots/final/)

## Current release and real enrollment

**Use [REAL_ENROLLMENT_RELEASE_TRUTH.md](docs/REAL_ENROLLMENT_RELEASE_TRUTH.md) for current verdicts, source revisions, migrations, tests and external gates.** Older audit and release documents describe their dated baselines. A live deployment does not establish enrollment readiness.

The candidate preserves the existing architecture and adds four-week capacity checks, prospective supply repair, effective commercial version resolution, useful member assignment, explicit member dispositions, multi-step recovery, privacy administration, hosted account commissioning, separated SMS classes and scoped release evidence.

Real enrollment stays closed until the exact hosted release/schema, business identity and policies, provider setup, authenticated journeys, support coverage and real Market Cell commitments are verified.

## Operating guides

| Need                                                | Guide                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Controlled upgrade and enrollment sequence          | [Real enrollment runbook](docs/REAL_ENROLLMENT_RUNBOOK.md)                                           |
| Source, migration, provider and market gates        | [Release checklist](docs/REAL_ENROLLMENT_RELEASE_CHECKLIST.md)                                       |
| Routine setup through named product controls        | [Operator playbook](docs/PILOT_OPERATOR_PLAYBOOK.md)                                                 |
| Store failures, recovery and restore reconciliation | [Incident/recovery runbook](docs/PILOT_RECOVERY_RUNBOOK.md)                                          |
| Exact Twilio registration copy and external actions | [Twilio registration package](docs/TWILIO_REAL_ENROLLMENT_PACKAGE.md)                                |
| MFA, recovery, backup operator and hosted sessions  | [Hosted account commissioning](docs/HOSTED_ACCOUNT_COMMISSIONING.md)                                 |
| Current local validation and limitations            | [Candidate validation](docs/verification/real-enrollment/2026-09-15-candidate/release-validation.md) |

Routine pilot setup uses the operator UI without SQL, database IDs or terminal work. The deployment owner still performs the one-time database/secret configuration and verified first-operator bootstrap. Additional account access uses verified email and named business selectors. Keep that initial trust-root step separate from ordinary operation.

## Development basics

1. Read `AGENTS.md`, then the relevant installed Next.js guide under `node_modules/next/dist/docs/` before changing framework behavior.
2. Install locked dependencies with `npm ci` when needed. Preserve existing environment files and user changes.
3. Use Demo Studio for rehearsals. General development on `.data/uptick` is a different workspace: its seed and `.env.local` are not the founder demo process.
4. Keep one process per local PGlite database. Hosted PostgreSQL uses server-only credentials; browser roles remain denied direct private-table access.
5. Leave a safe disk margin. Startup requires at least 256 MiB free and build requires 768 MiB; a fresh dependency install needs more.
6. Verify a change with the relevant tests, then the required release checks:

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

The HTTP suite uses a running local app. Real database concurrency and restore are separate local PostgreSQL checks:

```sh
APP_URL=http://127.0.0.1:3210 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
node --import tsx scripts/verify-real-enrollment-postgres.ts
bash scripts/verify-postgres.sh
bash scripts/rehearse-restore.sh
```

Do not point sample seeds or test harnesses at hosted data. Controlled hosted migration uses the release runbook and preserves migration checksums, immutable history and STOP evidence.

## Evidence language

A claim is a saved benefit. A QR redemption is recorded credential use, not proof of purchase, guaranteed physical handoff or incremental sales. Provider acceptance is not handset delivery. Synthetic counts are not traction. Four-week cohort history remains fixed even when a member withdraws or stops promotional texts.
