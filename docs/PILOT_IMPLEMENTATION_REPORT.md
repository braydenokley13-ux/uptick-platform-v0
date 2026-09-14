# Uptick Local — pilot implementation report

Decision brief dated September 13, 2026. Verification completed September 13–14, 2026. Operating branch: `codex/pilot-ready-service`, based on latest main `8acc4a64ff0e2427398c366be72b0968fb7a98bf`.

**Verdict: READY FOR INTERNAL REHEARSAL on the verified local candidate. Not commissioned for a controlled real pilot.** The complete software path is implemented and exercised locally. The canonical hosted deployment still runs the prior release; hosted commissioning, legal identity, account protections, carrier readiness and the real-counter rehearsal remain open.

## 1. Executive implementation summary

Uptick now has a coherent pilot service model: verified adult membership, optional promotional consent, a fixed four-week admitted cohort, finite no-purchase supply, reviewed weekly releases, durable grants, staff-counter redemption, incidents and backed recovery. A failure before redemption can be repaired without pretending the original item was redeemed. A failure after digital redemption preserves the original evidence.

Operators have Today, pilot run/admission controls, four-week supply commitments, partner execution records, readiness, incident/recovery controls, member support, job health, a fixed-cohort scorecard and separate economics/labor. Merchants see Program, Fulfillment and Results. Paid Programs have versioned terms, negotiated fees recorded once, bounded weekly attention and narrowly scoped protection; organic supply remains independent.

One-time access links exchange into revocable browser sessions. Recovery codes provide a non-SMS return path. STOP suppresses promotional delivery across sender changes while preserving membership and grants; START does not create consent. HELP and ordinary inbound messages reach protected support records. The scheduler separates bounded preparation from dispatch and records interruption/failure/success.

The public copy alignment is preserved as a separately committed patch and verified Git bundle. Real enrollment and promotional launch remain closed. No A2P campaign was submitted, no real promotion was sent, and no hosted pilot migration or deployment was performed in this run.

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

The release evidence/playbooks commit follows this ledger. `git log --oneline origin/main..HEAD` is the authoritative complete branch ledger. Public repository commit: `e6174b72a598c5949b3680ada23ac313574e8530`, based on `7b453a5f765bbb022f2e916dce0f4f0ea63e9717`; archived in [public-site/README.md](public-site/README.md).

## 4. Migration ledger

All seven new migrations are forward migrations. Applied history 001–013 was preserved. Fresh PGlite and real PostgreSQL replay through 020 passed. The restore test replayed migrations without changing restored evidence. These files have **not yet been applied to Supabase**.

| Migration               | Adds or protects                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 014 membership service  | Member classification/adult evidence, consent purpose, sessions, one-use recovery codes, global suppression, contextual support       |
| 015 pilot promises      | Exact free terms, readiness, independent fallback, atomic releases/grants, incidents, pre/post-redemption recovery and history guards |
| 016 Growth Programs     | Versioned commercial commitments, roles, weekly plans, protections, approvals, links, credits and organic proposals                   |
| 017 pilot operations    | Runs, admissions/waitlist, four-week commitments, partner execution, economic/labor ledger, event classification                      |
| 018 runtime safety      | Job leases/history and explicit search paths on ten existing functions                                                                |
| 019 Growth review fixes | Category on every version, serial supply reuse validation and idempotent credit references                                            |
| 020 frozen cohorts      | Irreversible cohort freeze and validated admission writes                                                                             |

The reviewed local schema has 97 public tables. No new permissive browser RLS policy was introduced. Hosted application must record repository filenames in `schema_migrations`, matching the established convention even where provider migration history is split.

## 5. P0 readiness matrix

“Complete” here describes the candidate's implementation and stated local verification; it does not substitute for deployment or physical commissioning.

| P0 area                                                  | Status                             | Evidence or remaining condition                                                                           |
| -------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Adult membership independent of promotional SMS          | Complete                           | Domain and HTTP join/confirmation checks; optional box unchecked                                          |
| STOP/START/sender rotation semantics                     | Complete                           | Suppression/consent and callback regressions pass                                                         |
| Private web session, revocation and recovery codes       | Complete locally                   | Hosted provider revocation/MFA rehearsal remains open                                                     |
| One backed featured benefit/member/week                  | Complete                           | 150-grant PostgreSQL release race; exact cohort transaction                                               |
| Finite inventory and protected reservations              | Complete                           | Final-unit/concurrent claim/adjustment checks                                                             |
| Current destination readiness and independent fallback   | Complete in software               | Actual manager/staff/stock evidence still required                                                        |
| Incident before/after redemption and one backed recovery | Complete                           | Domain plus real HTTP before/after recovery, duplicate checks                                             |
| Correct old-pass help and old-week recovery visibility   | Complete                           | Member experience regressions and reviewed UI                                                             |
| Versioned negotiated Growth Program                      | Complete                           | 10 focused tests; fees/credits/ceilings/protection guards                                                 |
| Organic suppliers independent of paid Program            | Complete                           | Proposal path and reporting distinction                                                                   |
| Fixed four-week admissions and data separation           | Complete                           | Eight operations tests, freeze and contaminated-numerator regressions                                     |
| Partner distribution accountability                      | Complete in software               | Real partner must execute and supply evidence                                                             |
| Separate economics and labor                             | Complete                           | Append-only entries, idempotency/reversal, separate Program fee/credits                                   |
| Actionable Today and support                             | Complete locally                   | Browser operator release and HTTP post-recovery Today rendering                                           |
| Bounded observable scheduler                             | Complete in code                   | Hosted cron deployment and observed execution still pending                                               |
| Deny-by-default RLS/search paths/session controls        | Partially complete                 | Local implementation verified; hosted remediation/configuration and independent security review remain    |
| Isolated backup/restore                                  | Complete locally                   | Durable local dump/restore, 150 grants, 15 table fingerprints                                             |
| Hosted backup/PITR recovery                              | Externally blocked                 | Entitlement, actual restore points and provider recovery time not verified                                |
| Public company/story consistency                         | Complete copy; publication pending | Separate patch/bundle; public build status recorded separately                                            |
| Legal entity/address/contact and policy approval         | Externally blocked                 | Founder/legal facts missing; exact email spelling still awaiting confirmation                             |
| Canonical hosted release and authenticated smoke tests   | Externally blocked                 | Deployment approval review rejected the earlier unspecified/unvalidated action                            |
| Carrier/campaign/live promotional delivery               | Externally blocked                 | No campaign submission or real promotional send performed                                                 |
| Mobile device and physical counter rehearsal             | Partially complete                 | Browser journey passes; in-app viewport override ignored, real phone/camera/counter sign-off still needed |
| Portals, POS, Stripe, native app, ML, broad verticals    | Intentionally deferred             | Outside the locked P0 scope                                                                               |

## 6. Test ledger

Final captured results are in [verification](verification/domain-tests.txt).

| Check actually run                             | Result                                                                                                                                                       | Evidence                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Baseline `npm test`                            | 146 passed                                                                                                                                                   | Baseline before edits                                         |
| Final `npm test`                               | **176 passed, 0 failed**                                                                                                                                     | [domain-tests.txt](verification/domain-tests.txt)             |
| `npm run lint`                                 | Passed, no reported errors/warnings                                                                                                                          | [lint.txt](verification/lint.txt)                             |
| `npm run typecheck`                            | Passed                                                                                                                                                       | [typecheck.txt](verification/typecheck.txt)                   |
| `npm run build`                                | Passed optimized Next.js build                                                                                                                               | [build.txt](verification/build.txt)                           |
| Playwright HTTP suite against production build | **12 passed**                                                                                                                                                | [http-tests.txt](verification/http-tests.txt)                 |
| Isolated PostgreSQL shell harness              | Passed 001–020 and all separate-session checks                                                                                                               | [postgres.txt](verification/postgres.txt)                     |
| Durable local restore                          | Passed; **150 grants**, **15 tables**, **973 ms** measured dump/restore/replay interval                                                                      | [restore.txt](verification/restore.txt)                       |
| New production-build HTTP journey              | Passed whole-cohort duplicate release, optional-consent access, exact-pass incident, before/after redemption recovery, duplicate redemption and Today render | [pilot-http-journey.txt](verification/pilot-http-journey.txt) |
| Browser walkthrough                            | Join, one-time access, grant, claim, staff QR and green receipt observed; no console errors on checked member views                                          | Local synthetic records only                                  |
| Focused Growth/operations/member/promise tests | 10 / 8 / 16 / 5 passed respectively; included in final suite                                                                                                 | Agent ledgers plus full test file                             |
| CI workflow                                    | Added, not run on GitHub                                                                                                                                     | `.github/workflows/pilot-checks.yml`                          |

The HTTP suite's old confirmation expectation was updated for the new one-time access exchange; unrelated anonymous account actions remain session-protected. Sandbox socket restrictions were resolved by running the isolated local servers/tests with approved permissions. An initial fixture-only session lacked confirmation evidence; the HTTP journey now uses actual join and POST exchange instead of that shortcut. Low-disk guards first refused PostgreSQL/restore safely; both subsequently passed after the user-authorized cache cleanup.

The in-app browser accepted a requested 390×844 viewport setting but measured 1199 CSS pixels after reload. Therefore the browser result is **not** a verified 390-pixel responsive test. No real phone-camera scan, NFC hardware test, physical item handoff, carrier delivery or hosted authenticated session was simulated as a completed check.

## 7. Hosted environment status

Read-only reconnaissance found:

- Canonical alias: `https://pilot.upticklocal.com`.
- Vercel project: `prj_U1rgTJlWYnxdLOOu6wPppoa39W2c`, team `team_FVNcvbojx1qlGIHJGRhwOihR`.
- Existing READY deployment: `dpl_3GJwBQG4vWUYvukc2vmKiAdCQ843`, source `a16fd6edd742edc0bcf2ede6a30f438a39c3944f`; this is the prior release, not this candidate.
- Supabase: `dmirmwzubafuzoxcporr`, `uptick-staging`, healthy PostgreSQL 17. Existing repository migrations 001–013 recorded.
- All 65 existing public tables had RLS enabled and no permissive browser policies. Ten function search-path findings are addressed by candidate migration 018, not yet applied remotely.
- Network members, markets, supplies, allocations, demand events and membership messages were empty. Legacy two organizations, one location and one offer were preserved. The legacy Joe's non-demo flag requires explicit operational classification; it was not silently treated as a real pilot.
- One Auth user had zero MFA factors; leaked-password protection was disabled at inspection. No account factor or credential was changed.
- Actual hosted backup/PITR entitlement and restore points remain unverified.
- New scheduler routes are not deployed. Real enrollment and promotional delivery have not been enabled by this work. No A2P submission occurred.
- Public-site alignment is committed in a separate artifact but not pushed or published.

## 8. Genuine remaining real-pilot blockers

1. **Approve and commission the exact hosted release.** Apply migrations 014–020 to the reused project and deploy the reviewed branch to the canonical alias with real enrollment and promotional delivery disabled. Then complete hosted authenticated, callback and cron checks.
2. **Supply legal identity and contact facts.** Legal entity and business notice address remain missing. The founder replied `iwhite@upticklocla.com`; a clarification about that spelling is pending. Existing `iwhite@upticklocal.com` copy was preserved pending confirmation, and no working mailbox test is claimed.
3. **Commission operator access and recovery.** Enroll/test MFA, verify provider-session revocation, confirm an accountable backup operator, resolve leaked-password protection and record separately managed secrets/recovery ownership.
4. **Verify hosted recovery.** Record the real backup/PITR plan, restore points and restore procedure; reconcile post-backup commitments and STOP events as described in the recovery runbook.
5. **Record real business commitments and rehearse the counter.** Managers, staffed hours, exact stock, independent fallback, funders, partner execution and physical handoff cannot be invented by software. Test on actual phones and staff QR signs.
6. **Complete carrier readiness before promotional delivery.** Campaign/number approvals and the real monitored support path remain external. Membership entitlement is already independent of marketing consent.
7. **Complete an independent hosted security review.** Existing defensive regression checks passed; the blocked delegated review is not a security sign-off.

Automatic approval review rejected the earlier Vercel action because the work was uncommitted/incompletely validated and its target was unspecified. The action was not bypassed. The final candidate and target are now concrete for approval; no shared deployment state was changed.

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

**READY FOR INTERNAL REHEARSAL — local candidate.** The primary promise, commercial, recovery and operating paths are implemented, independently challenged, corrected and verified. **Not ready to admit a controlled real cohort** until the blockers above are resolved and recorded. Publishing a green build alone is not a launch decision.

## Workspace maintenance requested during this build

The user asked to clear unnecessary files when free disk space fell below 1 GB. Cleared approximately 2,524 MiB of inspected regenerable npm/pnpm/compiler/pip/Homebrew/updater caches, used Spotify's built-in temporary-cache cleanup (its confirmation stated downloads would not be affected), and removed the task's temporary public clone after preserving its exact commit. Free disk space subsequently measured about 12 GiB. User projects, documents, media, stored credentials, application profiles and databases were preserved.
