> **Historical record.** This document describes an earlier implementation or review checkpoint. Use [current release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md) for this candidate’s fixes, evidence, verdicts and remaining gates. Earlier test counts, demo instructions and unresolved-gap statements are not current unless carried forward there.

# Uptick Local — pilot implementation report

Decision brief dated September 13, 2026. Verification completed September 13–14, 2026. Operating branch: `codex/pilot-ready-service`, based on latest main `8acc4a64ff0e2427398c366be72b0968fb7a98bf`.

**Verdict: READY FOR INTERNAL REHEARSAL — operating release deployed. Not ready for a controlled real pilot.** The operating release is on GitHub main and live at `https://pilot.upticklocal.com`. Migrations 014–021 are applied with existing rows preserved. Hosted anonymous/session-boundary checks pass. Authenticated operator/member rehearsal, legal identity, account protections, carrier readiness and physical-counter verification remain open. See [HOSTED_COMMISSIONING.md](HOSTED_COMMISSIONING.md) for the current release evidence.

## 1. Executive implementation summary

Uptick now has a coherent pilot service model: verified adult membership, optional promotional consent, a fixed four-week admitted cohort, finite no-purchase supply, reviewed weekly releases, durable grants, staff-counter redemption, incidents and backed recovery. A failure before redemption can be repaired without pretending the original item was redeemed. A failure after digital redemption preserves the original evidence.

Operators have Today, pilot run/admission controls, four-week supply commitments, partner execution records, readiness, incident/recovery controls, member support, job health, a fixed-cohort scorecard and separate economics/labor. Merchants see Program, Fulfillment and Results. Paid Programs have versioned terms, negotiated fees recorded once, bounded weekly attention and narrowly scoped protection; organic supply remains independent.

One-time access links exchange into revocable browser sessions. Recovery codes provide a non-SMS return path. STOP suppresses promotional delivery across sender changes while preserving membership and grants; START does not create consent. HELP and ordinary inbound messages reach protected support records. The scheduler separates bounded preparation from dispatch and records interruption/failure/success.

The public copy alignment is merged through public-site PR #13 and preserved as a patch and verified Git bundle. The user subsequently approved public production publication; the branch was switched to main and the exact merged source deployed. The operating platform is merged through PR #2, with commissioning follow-ups on main. Real enrollment and promotional launch remain closed. No A2P campaign was submitted or real promotion sent.

## 2. Architecture decisions

See [PILOT_ARCHITECTURE.md](PILOT_ARCHITECTURE.md) for the shared synthesis gate, ownership and final refinements.

Key choices:

- Keep the existing member-week allocation as the uniqueness anchor; attach an immutable fulfillment grant rather than build a competing allocation system.
- Reserve the entire admitted cohort in one transaction. Claiming transfers that reservation and cannot consume a second stock unit.
- Use the original pass for recovery, with an independent remedy and redemption ledger. Pre-claim recovery binds when the member claims. A used remedy prevents later use of the original benefit.
- Freeze the cohort permanently on first live transition. A paused run cannot reopen enrollment.
- Preserve issued Program obligations by conservatively refusing amendments after any Program grant has issued. A more flexible prospective amendment engine is deferred.
- Reuse supplies only across unissued versions of the same Program/week. Cross-Program and cross-week reuse is guarded.
- Use backed audience/target before freeze and actual admissions after freeze for paid capacity. The 200-member cap is never a promised audience.
- Treat record classification as explicit evidence. Existing uncertain records default to internal; no historical records were promoted to real automatically.
- Retain server-mediated access with RLS enabled and no permissive browser policies. Preview deployments cannot connect to the shared pilot database.
- Use Sol implementation/review agents following the user's model preference. Root handled synthesis, integration, commissioning decisions and final checks. Reviewers inspected systems they did not originally build. One delegated security review was blocked by automated screening; no independent security sign-off is claimed.

## 3. Commit ledger

| Commit    | Purpose                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `25b3b6c` | Shared architecture and identity/event extraction                                   |
| `737a14b` | Versioned Growth Programs and merchant workspace                                    |
| `8603589` | Membership/consent separation, sessions, recovery codes, support                    |
| `7f01db4` | Fixed pilot cohorts, partner/economics/Today and operator screens                   |
| `fafd952` | Bounded scheduler, seed guards, preview DB guard and operator session/MFA controls  |
| `40866bb` | Commercial protection, actual audience, amendment and credit corrections            |
| `fda4baf` | Atomic grants, destination readiness, truthful recovery and PostgreSQL verification |
| `e2ff109` | Current readiness and correctly scoped pilot/partner evidence                       |
| `d667d68` | Exact-pass incident context, old recovery visibility and truthful member/Tap copy   |
| `7fa7dda` | Operating policy alignment and public-site change archive                           |
| `26369e9` | Complete verification evidence, isolated restore and operator rehearsal package     |
| `605f147` | Format verified fulfillment implementation; no intended behavior changes            |

Additional commits: `30254cd` finalized the original release package; `13f0e36` merged operating PR #2; `6bf7cd9` added migration 021; `33dc343` recorded the hosted backup verifier and commissioning evidence. `git log --oneline 8acc4a64ff0e2427398c366be72b0968fb7a98bf..HEAD` is the complete operating release ledger. The verified application source is `605f147504d74325b7baf8439281debbbcc0a5f8`; subsequent release documentation does not change application behavior. Public repository commit: `e6174b72a598c5949b3680ada23ac313574e8530`, based on `7b453a5f765bbb022f2e916dce0f4f0ea63e9717`; archived in [public-site/README.md](public-site/README.md).

## 4. Migration ledger

All eight new migrations are forward migrations. Applied history 001–013 was preserved. Fresh PGlite and real PostgreSQL replay through 020 passed, followed by the real PostgreSQL harness through 021. **Migrations 014–021 are applied to Supabase.** A protected snapshot of all 65 pre-release public tables and 31 rows restored with identical fingerprints locally; after migration, all 64 legacy application-table counts/fingerprints still matched (the migration ledger intentionally grew).

| Migration                   | Adds or protects                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 014 membership service      | Member classification/adult evidence, consent purpose, sessions, one-use recovery codes, global suppression, contextual support       |
| 015 pilot promises          | Exact free terms, readiness, independent fallback, atomic releases/grants, incidents, pre/post-redemption recovery and history guards |
| 016 Growth Programs         | Versioned commercial commitments, roles, weekly plans, protections, approvals, links, credits and organic proposals                   |
| 017 pilot operations        | Runs, admissions/waitlist, four-week commitments, partner execution, economic/labor ledger, event classification                      |
| 018 runtime safety          | Job leases/history and explicit search paths on ten existing functions                                                                |
| 019 Growth review fixes     | Category on every version, serial supply reuse validation and idempotent credit references                                            |
| 020 frozen cohorts          | Irreversible cohort freeze and validated admission writes                                                                             |
| 021 membership search paths | Explicit search paths for the two new membership trigger helpers; hosted advisor rechecked                                            |

The reviewed local schema has 97 public tables. No new permissive browser RLS policy was introduced. Hosted `schema_migrations` records repository filenames through 021, matching the established convention even where older provider migration history is split.

## 5. P0 readiness matrix

“Complete” here describes the candidate's implementation and stated local verification; it does not substitute for deployment or physical commissioning.

| P0 area                                                  | Status                       | Evidence or remaining condition                                                                           |
| -------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Adult membership independent of promotional SMS          | Complete                     | Domain and HTTP join/confirmation checks; optional box unchecked                                          |
| STOP/START/sender rotation semantics                     | Complete                     | Suppression/consent and callback regressions pass                                                         |
| Private web session, revocation and recovery codes       | Complete locally             | Hosted provider revocation/MFA rehearsal remains open                                                     |
| One backed featured benefit/member/week                  | Complete                     | 150-grant PostgreSQL release race; exact cohort transaction                                               |
| Finite inventory and protected reservations              | Complete                     | Final-unit/concurrent claim/adjustment checks                                                             |
| Current destination readiness and independent fallback   | Complete in software         | Actual manager/staff/stock evidence still required                                                        |
| Incident before/after redemption and one backed recovery | Complete                     | Domain plus real HTTP before/after recovery, duplicate checks                                             |
| Correct old-pass help and old-week recovery visibility   | Complete                     | Member experience regressions and reviewed UI                                                             |
| Versioned negotiated Growth Program                      | Complete                     | 10 focused tests; fees/credits/ceilings/protection guards                                                 |
| Organic suppliers independent of paid Program            | Complete                     | Proposal path and reporting distinction                                                                   |
| Fixed four-week admissions and data separation           | Complete                     | Eight operations tests, freeze and contaminated-numerator regressions                                     |
| Partner distribution accountability                      | Complete in software         | Real partner must execute and supply evidence                                                             |
| Separate economics and labor                             | Complete                     | Append-only entries, idempotency/reversal, separate Program fee/credits                                   |
| Actionable Today and support                             | Complete locally             | Browser operator release and HTTP post-recovery Today rendering                                           |
| Bounded observable scheduler                             | Complete and observed hosted | Both registered Vercel jobs succeeded; zero messages processed                                            |
| Deny-by-default RLS/search paths/session controls        | Partially complete           | Hosted RLS/search paths verified; MFA, leaked-password protection and independent review remain           |
| Isolated backup/restore                                  | Complete locally             | Durable local dump/restore, 150 grants, 15 table fingerprints                                             |
| Hosted backup/PITR recovery                              | Externally blocked           | Entitlement, actual restore points and provider recovery time not verified                                |
| Public company/story consistency                         | Copy published               | Public PR #13 merged and live; seven public checks passed with enrollment closed                          |
| Legal entity/address/contact and policy approval         | Externally blocked           | Founder/legal facts missing; exact email spelling still awaiting confirmation                             |
| Canonical hosted release and authenticated smoke tests   | Partially complete           | Canonical deployment READY; 17 hosted boundary checks pass; positive authenticated journey remains        |
| Carrier/campaign/live promotional delivery               | Externally blocked           | No campaign submission or real promotional send performed                                                 |
| Mobile device and physical counter rehearsal             | Partially complete           | Browser journey passes; in-app viewport override ignored, real phone/camera/counter sign-off still needed |
| Portals, POS, Stripe, native app, ML, broad verticals    | Intentionally deferred       | Outside the locked P0 scope                                                                               |

## 6. Test ledger

Final captured results are in [verification](verification/domain-tests.txt).

| Check actually run                             | Result                                                                                                                                                       | Evidence                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Baseline `npm test`                            | 146 passed                                                                                                                                                   | Baseline before edits                                                                                          |
| Final `npm test`                               | **176 passed, 0 failed**                                                                                                                                     | [domain-tests.txt](verification/domain-tests.txt)                                                              |
| `npm run lint`                                 | Passed, no reported errors/warnings                                                                                                                          | [lint.txt](verification/lint.txt)                                                                              |
| `npm run typecheck`                            | Passed                                                                                                                                                       | [typecheck.txt](verification/typecheck.txt)                                                                    |
| `npm run format:check`                         | Passed                                                                                                                                                       | [format.txt](verification/format.txt)                                                                          |
| `npm run build`                                | Passed optimized Next.js build                                                                                                                               | [build.txt](verification/build.txt)                                                                            |
| Public site: clean install and full TypeScript | Passed on exact archived public commit                                                                                                                       | [public-npm-ci.txt](verification/public-npm-ci.txt), [public-typecheck.txt](verification/public-typecheck.txt) |
| Public site: `npm run build`                   | Passed optimized Next.js build; all 15 static pages generated                                                                                                | [public-build-network.txt](verification/public-build-network.txt)                                              |
| Playwright HTTP suite against production build | **12 passed**                                                                                                                                                | [http-tests.txt](verification/http-tests.txt)                                                                  |
| Isolated PostgreSQL shell harness              | Passed through 021 and all separate-session checks                                                                                                           | [postgres-021.txt](verification/postgres-021.txt)                                                              |
| Durable local restore                          | Passed; **150 grants**, **15 tables**, **973 ms** measured dump/restore/replay interval                                                                      | [restore.txt](verification/restore.txt)                                                                        |
| New production-build HTTP journey              | Passed whole-cohort duplicate release, optional-consent access, exact-pass incident, before/after redemption recovery, duplicate redemption and Today render | [pilot-http-journey.txt](verification/pilot-http-journey.txt)                                                  |
| Browser walkthrough                            | Join, one-time access, grant, claim, staff QR and green receipt observed; no console errors on checked member views                                          | Local synthetic records only                                                                                   |
| Focused Growth/operations/member/promise tests | 10 / 8 / 16 / 5 passed respectively; included in final suite                                                                                                 | Agent ledgers plus full test file                                                                              |
| CI workflow                                    | Passed on release branch, PR and main; main source `33dc343` passed                                                                                          | [GitHub run 34803344290](https://github.com/braydenokley13-ux/uptick-platform-v0/actions/runs/34803344290)     |
| Hosted public-data backup restored locally     | All 65 tables and 31 rows restored with identical counts/fingerprints; excludes Auth, Storage and provider PITR                                              | [hosted-public-backup-restore.txt](verification/hosted-public-backup-restore.txt)                              |
| Hosted anonymous GET checks                    | 12 passed: public routes, protected redirects/APIs and unauthenticated cron rejection                                                                        | [hosted-get-smoke.json](verification/hosted-get-smoke.json)                                                    |
| Hosted POST boundary checks                    | 5 passed: closed enrollment, missing sessions, foreign origin and unsigned callback rejection                                                                | [hosted-post-smoke.json](verification/hosted-post-smoke.json)                                                  |
| Actual hosted scheduler executions             | Preparation and dispatch both succeeded with zero processed; no members, messages, releases or grants created                                                | [hosted-jobs.json](verification/hosted-jobs.json)                                                              |

The HTTP suite's old confirmation expectation was updated for the new one-time access exchange; unrelated anonymous account actions remain session-protected. Sandbox socket restrictions were resolved by running the isolated local servers/tests with approved permissions. An initial fixture-only session lacked confirmation evidence; the HTTP journey now uses actual join and POST exchange instead of that shortcut. Low-disk guards first refused PostgreSQL/restore safely; both subsequently passed after the user-authorized cache cleanup.

The in-app browser accepted a requested 390×844 viewport setting but measured 1199 CSS pixels after reload. Therefore the browser result is **not** a verified 390-pixel responsive test. No real phone-camera scan, NFC hardware test, physical item handoff, carrier delivery or hosted authenticated session was simulated as a completed check.

The public site was reconstructed at its exact archived commit and checked with its own clean dependencies. The first install lacked registry access, and the first build could not fetch its configured Google fonts under network restrictions. Both succeeded with approved network access; failure and success logs are preserved. The archive checksums matched, and the bundle verified in the public repository containing its required base commit. No public source changes were needed for these checks.

## 7. Hosted environment status

Commissioning after explicit user approval on September 14, 2026:

- Canonical alias: `https://pilot.upticklocal.com`.
- Vercel project: `prj_U1rgTJlWYnxdLOOu6wPppoa39W2c`, team `team_FVNcvbojx1qlGIHJGRhwOihR`; production branch is now `main`.
- Verified READY application deployment: `dpl_X82XhAVUwV1Pgj3BDX3nLyi6LYLM`, exact source `33dc34325307174137a4b2ea9f6399c0fb43b161`. Later documentation commits do not alter this application source.
- Existing Supabase project `dmirmwzubafuzoxcporr` (`uptick-staging`) was reused. Repository migrations 001–021 are recorded.
- All 97 public tables have RLS enabled, with no permissive browser policies. The search-path warnings are resolved. Leaked-password protection remains disabled; the one Auth user has no verified MFA factor.
- All 64 non-ledger legacy application tables retained their pre-migration counts and fingerprints. No pilot member, release, grant or member message was created by commissioning.
- A protected public-data snapshot was restored into an isolated local PostgreSQL database. Auth, Storage and provider PITR/backup entitlement are outside that snapshot and remain unverified.
- Both scheduler routes are registered on the canonical deployment. Actual job outcomes and hosted HTTP evidence are recorded in [HOSTED_COMMISSIONING.md](HOSTED_COMMISSIONING.md).
- Public-site PR #13 is merged at `6e6f135a44c0ab63b89abecfd6f1d82272bfa253`. The user specifically approved its production branch/publication change; main is selected and the merged source deployed.

The exact source, migration checksums, destinations and gates are recorded in [PILOT_RELEASE_CANDIDATE.md](PILOT_RELEASE_CANDIDATE.md). Settings remain `UPTICK_ENV=staging`, simulated SMS, closed enrollment and closed production delivery. Existing protected environment-variable types were preserved.

## 8. Genuine remaining real-pilot blockers

1. **Complete authenticated hosted commissioning.** The operating deployment, migrations and anonymous checks are complete. Existing operator credentials and a real internal member session are still needed for the positive hosted journey. Public production publication has received its specific approval.
2. **Supply legal identity and contact facts.** Legal entity and business notice address remain missing. The founder replied `iwhite@upticklocla.com`; a clarification about that spelling is pending. Existing `iwhite@upticklocal.com` copy was preserved pending confirmation, and no working mailbox test is claimed.
3. **Commission operator access and recovery.** Enroll/test MFA, verify provider-session revocation, confirm an accountable backup operator, resolve leaked-password protection and record separately managed secrets/recovery ownership.
4. **Verify hosted recovery.** Record the real backup/PITR plan, restore points and restore procedure; reconcile post-backup commitments and STOP events as described in the recovery runbook.
5. **Record real business commitments and rehearse the counter.** Managers, staffed hours, exact stock, independent fallback, funders, partner execution and physical handoff cannot be invented by software. Test on actual phones and staff QR signs.
6. **Complete carrier readiness before promotional delivery.** Campaign/number approvals and the real monitored support path remain external. Membership entitlement is already independent of marketing consent.
7. **Complete an independent hosted security review.** Existing defensive regression checks passed; the blocked delegated review is not a security sign-off.

The user explicitly approved the operating deployment and database work after reviewing the committed candidate. During commissioning, automatic review rejected changing protected settings to plain text; their original protections were preserved instead. It also rejected a combined production-branch change. The operating branch update subsequently passed after main contained the verified release and the database was ready. The user subsequently supplied the specific public approval, and the branch/publication actions passed review.

## 9. Rehearsal result

The local software chain completed: optional-consent join → explicit access exchange → fixed admitted member → reviewed release → reserved grant → exact free terms/weekly expiry → claim → paired staff QR → digital redemption. The operator published a complete three-member release through the UI. Competing HTTP requests returned the same release. A separate PostgreSQL rehearsal issued 150 grants with competing sessions.

The failure chain completed through HTTP both before and after original redemption: exact grant incident → readiness restored with evidence → funded independent fallback → recovery → one remedy redemption → idempotent retry. PostgreSQL assertions preserve one allocation/claim and original evidence. Tests additionally cover recovery issued before the original claim.

The real physical rehearsal has **not** occurred. Follow the dated sign-off table in [PILOT_OPERATOR_PLAYBOOK.md](PILOT_OPERATOR_PLAYBOOK.md). The local synthetic run intentionally exercises a single live week; four-week capacity/admission and partner controls are covered separately by domain tests. It is not presented as four weeks of observed pilot operation.

## 10. Operator playbook

The complete step-by-step guide is [PILOT_OPERATOR_PLAYBOOK.md](PILOT_OPERATOR_PLAYBOOK.md). It covers before launch, every morning, merchant failures, member access/help, weekly release and the four-week decision. [PILOT_RECOVERY_RUNBOOK.md](PILOT_RECOVERY_RUNBOOK.md) covers backups, keys outside the DB, rollback hazards, callback/STOP reconciliation and release order.

## 11. Deferred work

- Prospective-only amendments after a Program starts: current pilot rule refuses amendments after issued grants to protect sold attention.
- Automated four-week recommendations and richer preference routing: operator reviews bounded destination counts; each release still enforces locality and backing.
- Fully automated manual identity recovery when both session and saved codes are lost: monitored support remains necessary.
- Partner/employer/CPG portals, Stripe/invoicing, POS, ML, native app, points/gamification, broad referrals and cross-market entitlements: outside P0; existing seams retained.
- Incrementality/organic loyalty measurement: no unsupported claims are inferred from free-item digital use.

## 12. Final decision

**READY FOR INTERNAL REHEARSAL — operating release deployed.** The primary promise, commercial, recovery and operating paths are implemented, independently challenged, corrected and verified. **Not ready to admit a controlled real cohort** until the blockers above are resolved and recorded. Publishing a green build alone is not a launch decision.

## Workspace maintenance requested during this build

The user asked to clear unnecessary files when free disk space fell below 1 GB. Cleared approximately 2,524 MiB of inspected regenerable npm/pnpm/compiler/pip/Homebrew/updater caches, used Spotify's built-in temporary-cache cleanup (its confirmation stated downloads would not be affected), and removed the task's temporary public clone after preserving its exact commit. Free disk space subsequently measured about 12 GiB; the final measurement after all checks and temporary-file cleanup was 11.6 GB (10.8 GiB). User projects, documents, media, stored credentials, application profiles and databases were preserved. The task's temporary server was stopped, its two synthetic rehearsal databases were removed, and the reconstructed public checkout and dedicated dependency cache were removed after verification.
