# Uptick — current demo and enrollment release truth

**Decision date: September 15, 2026. Accountable integrator: GPT-6.**

This is the single current readiness record for the candidate below. The attached master brief governs implementation; the supplied mockup images were visual references, not new product requirements. Earlier audit, founder and release documents remain historical unless this record explicitly carries their evidence forward.

## 1. Executive decision

The isolated founder demo and the independent software work are complete for the requested controlled four-week pilot. The live host is still the older release. Provider approval, positive hosted commissioning and actual market commitments remain required. **Do not open real enrollment now.**

| Readiness state                        | Verdict    | Exact basis                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DEMO READINESS**                     | **GREEN**  | Reset and launch succeeded on this laptop; the real UI completed member entry → backed coffee → claim → staff QR → recorded redemption → merchant results → stockout → bottled-water recovery → recovery redemption. Final original/recovery ledger was `1/1/1/1/1`; reset returned it to `0/0/0/0/0`. Isolated database, fictional number, development SMS and no hosted writes. Full desktop/phone captures and offline PDF accompany the runbook. |
| **SOFTWARE REAL-ENROLLMENT READINESS** | **GREEN**  | Candidate implements the software blockers in the brief. Final local suite: 292/292, typecheck, lint, format and production build pass; HTTP checks 13/13; real PostgreSQL upgrade, admission races, separate-session concurrency and restore pass. Scope is controlled enrollment after the explicit external/hosted gates below, not proof of an already commissioned live system.                                                                 |
| **TWILIO / MESSAGING READINESS**       | **YELLOW** | Requested access and optional promotions are separated; confirmation, suppression, keywords, support and signed callback handling are implemented and tested. Current registration package and matching public-repository copy are prepared locally. Hosted membership senders and messages are both zero. No Campaign submission/approval, sender association or handset delivery has been demonstrated.                                            |
| **HOSTED COMMISSIONING**               | **RED**    | Current Vercel production is `81ad63e`; hosted application migrations remain 001–021. Candidate migrations 022–034 are not applied there. Positive hosted operator/member/merchant login, MFA, recovery, scoped callbacks and restore have not been proved on this candidate.                                                                                                                                                                        |
| **MARKET-CELL READINESS**              | **RED**    | Connected hosted database has zero Market Cells, pilot runs and members. No real four-week supply/fallback, staff rehearsal, distribution or support commitments were created by this work.                                                                                                                                                                                                                                                          |
| **REAL ENROLLMENT**                    | **RED**    | Keep enrollment closed. Software completeness does not substitute for the provider, legal, hosted identity, support and market evidence above.                                                                                                                                                                                                                                                                                                       |

GREEN is a bounded engineering decision for this candidate and tested pilot scope. It is not a guarantee that future defects cannot exist. One unreproduced intermediate test failure is retained in the validation record rather than hidden.

## 2. Exact source and current hosted truth

### Operating repository

- Repository: `braydenokley13-ux/uptick-platform-v0`.
- Latest remote main, rechecked read-only: **`81ad63e0922e4a1fb3bf2c4d51bbf001d458f51b`**.
- Candidate branch: **`codex/real-enrollment-ready`**.
- Verified software commit: **`32706bb4b9c0d2e9c6fcf52dd45ba09894e5e7d4`**.
- The subsequent documentation/artifact commit contains this record and the fallback; it does not change runtime code. `git log -2 --oneline` identifies both local commits.
- Main CI: [Pilot service checks, run 34908507326](https://github.com/braydenokley13-ux/uptick-platform-v0/actions/runs/34908507326), successful for `81ad63e`. This is main CI, not candidate CI. The candidate's final local validation is recorded separately.
- Vercel production: `dpl_9rz2JazvtfpLr35ARyK9G5XwJwpz`, platform state READY, exact main SHA above, canonical [pilot.upticklocal.com](https://pilot.upticklocal.com). No newer production deployment appeared in the read-only refresh.
- Existing Supabase project: `uptick-staging`, reference `dmirmwzubafuzoxcporr`. No replacement project was created.
- Hosted application ledger: **001–021**, including `021_membership_function_search_paths.sql`. Migration 022 is still absent there.
- Hosted counts, refreshed September 15: Market Cells **0**, pilot runs **0**, Uptick members **0**, membership senders **0**, member messages **0**.
- Supabase security advisor refresh: **97 INFO notices for RLS enabled without browser policies**; this is the deliberate default-deny browser boundary, not a reason to open policies. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

### Public/policy repository

- Repository: `braydenokley13-ux/upticklocal`.
- Checkout: `/private/tmp/upticklocal-policy-work`.
- Branch: **`codex/real-enrollment-policy`**.
- Base: `6e6f135a44c0ab63b89abecfd6f1d82272bfa253`.
- Local policy alignment: `788293e558b24a7d500278755c56323933c69ef0`.
- Exact SMS/phone-correction follow-up: **`d8098df7cd163ae02c7dd16574643aafe63f0585`**.
- Typecheck and Next 16.3.1 production build passed, 15/15 static pages. Rendered `/sms` contains all four current templates and the 15-minute/24-hour phone-correction explanation.
- These commits are **not pushed or published**. Both are preserved in the verified incremental bundle `output/source/upticklocal-policy.bundle`. It requires the base commit above; [bundle instructions](../output/source/README.md) explain how to apply it in the public repository.

## 3. What changed and how it is proved

| Brief area          | Final behavior                                                                                                                                                                                                                                                                                                        | Verification                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safe demo           | Dedicated loopback launcher, owned PGlite storage, stripped hosted environment, simulated SMS, sample-only identities and current-week seed; reset rotates keys and leaves non-demo storage alone.                                                                                                                    | `demo-isolation.test.ts` plus actual reset/launch and complete browser journey.                                                                                                                         |
| Four-week admission | Minimum usable week controls cohort size. Physical stock, other obligations, full local-week validity, recent readiness, staff QR, fallback, shared commercial ceilings and outages all constrain capacity. Frozen resumption checks unreleased future obligations without requiring consumed historical stock again. | `real-enrollment-capacity`, `pilot-operations`, `pilot-assignment`, `frozen-pilot-resume`; real PostgreSQL 150 simultaneous attempts → 149 admitted / 1 waitlisted after week-three stock falls to 149. |
| Prospective repair  | Append-only unreleased-week supply amendments preserve original links/reasons and explicit payer, funder, Program, protection and credit implications; issued history cannot be rewritten.                                                                                                                            | `future-week-amendments.test.ts`; release/admission/inventory/commercial work uses the shared coordination lock order.                                                                                  |
| Growth versions     | Resolve the effective approved version for the actual run/week. Pending, terminated or invalid commercial context cannot silently become organic. Historical version results remain visible.                                                                                                                          | `effective-program-version.test.ts`, `growth-programs.test.ts`.                                                                                                                                         |
| Useful allocation   | Whole-cohort recommendation uses auditable destination relevance, ZIP/travel evidence, repeat exposure and hard stock/Program constraints. Named selectors and explicit overrides replace raw list-order allocation.                                                                                                  | `pilot-assignment.test.ts`, strict readiness and shared paid-capacity cases.                                                                                                                            |
| Member state        | Append-only withdrawal, suspension, deletion-pending, inaccessible and geography dispositions preserve the original analytical denominator and issued evidence. STOP remains separate. Existing verified members can sign in when new enrollment is closed.                                                           | `member-service.test.ts`, `frozen-pilot-resume.test.ts`, member experience/consent tests.                                                                                                               |
| Recovery            | One active remedy; failed remedies can be superseded with evidence. Original/redemption history, unknown physical handoff, cross-week obligations and truthful costs remain. Whole-location outages stop routing and queue affected obligations.                                                                      | `recovery-supersession.test.ts`, `location-outages.test.ts`, promise tests and real UI recovery.                                                                                                        |
| Privacy/admin       | Verified requests, session-bound member status/export, correction, revocation, configurable approved retention, de-identification and narrow erasure exceptions preserve required operational/consent evidence.                                                                                                       | `privacy-admin`, `privacy-retention`, `member-privacy-access` tests.                                                                                                                                    |
| Phone correction    | Verified operator request → one-use 15-minute proposed-number challenge → support applies within 24 hours. Preserve member ID/history; reject collisions; revoke old access/session/recovery credentials and old queued recipient context; promotions reset off.                                                      | `member-phone-correction.test.ts`; actual new-number SMS remains a controlled commissioning test.                                                                                                       |
| Messaging           | Separate access and optional promotional flags; idempotent opt-in confirmation outside the weekly placement slot; STOP/START/HELP, ordinary inbound support, quiet hours, sender rotation and uncertain outcomes retain explicit behavior.                                                                            | `promotional-confirmation`, `messaging-readiness`, `member-messaging`, membership consent and HTTP tests.                                                                                               |
| Hosted identity     | TOTP enrollment/challenge, PKCE recovery, provider/app session revocation, live Auth session checks and recovery-only sessions; verified email account administration.                                                                                                                                                | `account-security.test.ts` and hosted commissioning runbook. Positive provider journeys remain external.                                                                                                |
| Release/monitoring  | Checksummed migrations; reviewed legacy baseline; separate operator readiness sections; release/schema/sender-scoped evidence; signed inbound/status freshness; job age; support/incident/stock/fallback visibility.                                                                                                  | `release-readiness`, `member-twilio-route` tests; build traces include migration 034 on relevant server routes.                                                                                         |
| Operator setup      | Named UI surfaces follow Market → locations → draft pilot → supply/terms/readiness/fallback → four weeks → Growth if applicable → distribution → gated enrollment → freeze/release/support/reconcile.                                                                                                                 | Source review, UI inspection and updated operator playbook. No SQL or terminal for routine market work. First trust-root bootstrap and deployment secrets remain deployment-owner tasks.                |
| Member/mobile       | Explicit entry, access, membership/closed/waitlist, benefit, redemption, withdrawal/conclusion and recovery states. Optional promotions never determine entitlement.                                                                                                                                                  | Member suites; actual demo screens and 320/360/390/430 CSS-width overflow checks in `docs/demo/mobile-checks.json`.                                                                                     |
| Both repositories   | Uptick-to-member wording, optional SMS/screen hosting, free benefit, truthful cohort/redemption claims, four current SMS templates and phone correction align.                                                                                                                                                        | Public typecheck/build/rendered page checks; publication is still pending.                                                                                                                              |

No points, wallets, paid consumer tier, restaurant expansion, native app, partner portal, ML, POS, CPG dashboard, auction or settlement system was added.

## 4. Migration inventory

Existing 001–021 remain unchanged. Existing main migration **022_suppression_reconciliation.sql** must travel with this controlled hosted upgrade. New candidate migrations are:

| Migration                             | Purpose                                               |
| ------------------------------------- | ----------------------------------------------------- |
| 023_future_week_supply_amendments.sql | Append-only future supply replacement                 |
| 024_member_service_dispositions.sql   | Auditable operational member state                    |
| 025_assignment_suitability.sql        | Explicit member/destination relevance                 |
| 026_recovery_supersession.sql         | Failed-remedy history and one current remedy          |
| 027_location_outages.sql              | Whole-location failure and affected queue             |
| 028_privacy_administration.sql        | Verified data-admin requests and policy settings      |
| 029_account_session_revocation.sql    | Account session revocation evidence                   |
| 030_privacy_retention_reviews.sql     | Retention decisions and narrow redaction controls     |
| 031_promotional_confirmation.sql      | Idempotent optional promotional confirmation          |
| 032_release_commissioning.sql         | Checksums, evidence and monitored commissioning       |
| 033_member_phone_correction.sql       | Verified phone correction and credential invalidation |
| 034_callback_commissioning_scope.sql  | Callback/evidence configuration scope                 |

Do not edit applied migration files. The migration command checks hashes and applies forward files in order. Hosted legacy checksums require an actual reviewed baseline, not an automatic assertion of correctness.

## 5. Verification and its limits

See [the dated candidate validation report](verification/real-enrollment/2026-09-15-candidate/release-validation.md) for commands, counts, raw-vs-recorded evidence and intermediate failures.

- Unit/domain: **292/292**, zero skip/fail in the final full run.
- Typecheck, lint, format: **pass**.
- Next 16.3.4 production build: **pass**, 25/25 static pages. Relevant server traces package migration 034.
- Running local HTTP/API security checks: **13/13**, including wrong origins, unauthenticated privacy/readiness, unsigned callbacks, body limits, forged credentials and tenant/role boundaries.
- Real PostgreSQL **16.11**, disposable Unix-socket-only clusters, TCP off and fsync on: 021→034 upgrade preserves selected identity/sender/suppression fingerprints; STOP reconciliation and exact checksum ledger pass.
- Four-week stock proof: `[150,150,150,150]` → `[150,150,149,150]`; **150 simultaneous requests → 149 admitted and 1 waitlisted**.
- Independent-session harness: all named claim, redemption, inventory, scheduler, referral, NFC, release and lock-order cases pass.
- Logical backup/restore: **150 grants**, exact fingerprints across **15 tables**, final restore **420 ms**. This is local application-data restoration, not hosted Auth/PITR/secrets/Twilio restoration.
- Browser: complete founder happy path and post-redemption fulfillment failure/recovery; separate merchant/operator records; reset and launch; **60 phone-width checks with zero horizontal overflow**, 36 actual screenshots and a visually inspected 21-page offline PDF. See [demo verification](verification/real-enrollment/2026-09-15-candidate/demo-verification.md).
- Security: no demo-to-real bypass; same-origin controls, private routes, log credential redaction, role and tenant checks, session revocation, callback signatures, suppression and finite recovery capacity are covered by the named suites. Hosted security advisors were read without weakening RLS.

An intermediate full test run observed a missing grant in one frozen-resume assertion. Two focused reruns and the final 292-test run passed; no cause was reproduced and no test was weakened to conceal it. The record retains that uncertainty. Browser capture tooling also encountered stale tabs/navigation timeouts and incorrectly sized captures; affected captures were replaced, and the final files were inspected. Those tool interruptions are not presented as uninterrupted browser execution.

## 6. Demo handoff

Follow [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md). The only recurring commands are `npm run demo:reset` then `npm run demo`. The browser opens `http://127.0.0.1:3210/demo`; it uses no hosted origin. The PDF is `output/pdf/uptick-founder-demo.pdf`, with all desktop and phone captures under `docs/demo/screenshots/final/`.

The PDF covers all demonstration scenes and remains usable without the app or internet. Demo dates reflect the capture date; a new reset generates the current week's dates. All private links and the QR are local sample credentials that are invalidated on reset.

## 7. Exact next external actions

| Owner                                                    | Next action and prepared artifact                                                                                                                                                                         | Required evidence before opening                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Founder / legal-policy reviewer                          | Supply actual business identity/contact/address facts and approve policy/retention decisions; use the fields in [Twilio package](TWILIO_REAL_ENROLLMENT_PACKAGE.md).                                      | Approved facts and policy review, not placeholders or invented legal sign-off.                                                                     |
| Deployment owner                                         | Review candidate commits, preserve/publish both branches, pass candidate CI, approve a backup + migrations 022–034 + closed deployment. Follow [release checklist](REAL_ENROLLMENT_RELEASE_CHECKLIST.md). | Correct hosted release/schema, reviewed legacy hashes, row preservation, backup/restore reference.                                                 |
| Supabase/Auth owner and primary/backup operators         | Complete [hosted account commissioning](HOSTED_ACCOUNT_COMMISSIONING.md).                                                                                                                                 | Actual login, TOTP, lost-factor route, revocation, tenant separation and member recovery on the candidate.                                         |
| Founder / Twilio account owner                           | Authorize Brand/Campaign submission using the ready-to-copy package, configure the dedicated membership service/number, Advanced Opt-Out and signed URLs.                                                 | Separate registration, approval and sender association records.                                                                                    |
| Founder / authorized internal recipients / support owner | Authorize exact test numbers and sending window. Run access, confirmation/weekly if enabled, STOP, START, HELP, ordinary reply, phone correction and uncertain-outcome tests.                             | Provider acceptance, signed callback and actual handset receipt recorded separately; monitored support.                                            |
| Accountable operator / stores / acquisition partners     | Configure one real Market Cell using [operator playbook](PILOT_OPERATOR_PLAYBOOK.md), including all four weeks, independent fallback, staff, funding and distribution.                                    | Real signed/reviewed commitments, current stock/readiness, usable assignment and support/continuation plan.                                        |
| Founder and accountable operator                         | Review every current-scoped gate; open enrollment last using [real-enrollment runbook](REAL_ENROLLMENT_RUNBOOK.md).                                                                                       | Current release/schema evidence, callback success under seven days, preparation under 15 minutes, dispatch under 5 minutes and a backed real cell. |

## 8. Actions not performed

No push, pull-request publication, merge, deployment, hosted migration, hosted member creation, real SMS, provider account purchase/configuration, Brand/Campaign submission, carrier test, real merchant inventory reservation, contractual commitment or legal approval was performed. No user secret was put into Git or the offline packet. Read-only hosted inspection is distinct from the isolated demo's operation.

## 9. Recommendation and founder's first action

- **Safe founder demo now:** yes, use the isolated launcher and the PDF.
- **Controlled internal real-SMS test now:** not yet; authorize recipients and finish the provider/closed-host prerequisites in the package first.
- **Real enrollment now:** no; the red hosted and market gates must be completed and messaging evidence must be current.

**Single first action: open [the demo runbook](DEMO_RUNBOOK.md) and run one rehearsal yourself.** Use the verified candidate and the ordered commissioning runbook for the next release; no new platform reconstruction is planned for the remaining external gates.
