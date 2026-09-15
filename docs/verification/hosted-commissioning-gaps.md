> **Historical record.** This document describes an earlier implementation or review checkpoint. Use [current release truth](../REAL_ENROLLMENT_RELEASE_TRUTH.md) for this candidate’s fixes, evidence, verdicts and remaining gates. Earlier test counts, demo instructions and unresolved-gap statements are not current unless carried forward there.

# Hosted commissioning gaps: operator access, support, callbacks, and release truth

Snapshot: September 14, 2026. This is a read-only code and evidence review. It did not change Supabase, Vercel, Twilio, GitHub, DNS, email, or any hosted data.

## Scope and evidence boundary

The root commissioning session performed fresh read-only provider checks and established this hosted baseline:

- GitHub `main` is `81ad63e0922e4a1fb3bf2c4d51bbf001d458f51b`;
- GitHub Actions run `34908507326` succeeded for that source;
- Vercel deployment `dpl_9rz2JazvtfpLr35ARyK9G5XwJwpz` is READY, serves `https://pilot.upticklocal.com`, and identifies exact source `81ad63e0922e4a1fb3bf2c4d51bbf001d458f51b`;
- Supabase project `dmirmwzubafuzoxcporr` is `ACTIVE_HEALTHY` on PostgreSQL 17;
- both migration history and the public schema are at migrations 001–021;
- `market_cells`, `pilot_runs`, `uptick_members`, `member_senders`, and `member_messages` each contain zero rows;
- the security advisor returned 97 INFO findings for RLS-enabled tables without browser policies and no other finding class;
- no hosted resource was changed.

`[UNKNOWN: exact provider-side clock for those reads; the facts were verified during the September 14, 2026 root session]`

The older repository evidence naming deployment `dpl_X82XhAVUwV1Pgj3BDX3nLyi6LYLM` at source `33dc343` is historical. It must not be used as the current hosted source after the fresh provider read above.

The current source/database mismatch and work in progress are:

- deployed source `81ad63e` packages migration `022_suppression_reconciliation.sql`, but the verified hosted database ledger and public schema stop at 021;
- the shared worktree also contains uncommitted migrations `023_future_week_supply_amendments.sql`, `024_member_service_dispositions.sql`, `025_assignment_suitability.sql`, and `026_recovery_supersession.sql` plus related code;
- the worktree contains an uncommitted repair that suppresses Uptick's second TwiML reply when Twilio Advanced Opt-Out already replied.

The exact hosted release is now known. It is not schema-aligned with its packaged migration set, and the newer 023–026 work is not part of either the deployed source or hosted database.

## Verdicts for this bounded review

| Area                           | Verdict | Reason                                                                                                                                                                                                                                                |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted operator authentication | **RED** | Password login and live session revocation checks exist, but MFA enrollment, factor management, password recovery, tested recovery access, and an authenticated hosted journey do not. Enforcement is recorded as off.                                |
| Support operations             | **RED** | HELP and web requests enter an operator queue, but there is no working/assignment action, aging or SLA view, escalation, notification, or proof that the displayed mailbox is monitored.                                                              |
| Callback commissioning         | **RED** | Signatures and message-state ordering are implemented, but successful signed callbacks have not been rehearsed on the host, callback health/errors are not operator-visible, and the verified deployed source can duplicate Advanced Opt-Out replies. |
| Release integrity              | **RED** | Vercel serves exact source 81ad63e and CI passed, but that source packages migration 022 while the verified hosted database stops at 021; work in progress adds 023-026. The pilot launch gate does not enforce this comparison.                      |
| Real enrollment                | **RED** | The current environment evidence keeps enrollment, delivery, legal approval, messaging approval, and MFA enforcement false. This is the correct fail-closed state until the items below are completed.                                                |

These verdicts are intentionally separate. A READY Vercel deployment or a green anonymous smoke test is not evidence that authenticated hosted commissioning passed.

## 1. Operator authentication and recovery

### What the software already does

1. `src/app/api/action/route.ts` signs in through Supabase password authentication and refuses accounts without an application `memberships` record.
2. `src/lib/auth.ts` stores the Supabase access token encrypted inside an HttpOnly, Secure, SameSite=Lax application cookie with a 55-minute application lifetime.
3. Every hosted authenticated request calls `supabase.auth.getUser(accessToken)` and checks that the JWT `session_id` still exists in `auth.sessions`. This gives provider-session revocation effect on the next application request.
4. When `OPERATOR_MFA_REQUIRED=true`, operator access requires an `aal2` token.
5. Login can challenge the first verified TOTP factor and store the AAL2 access token.
6. The operator workspace can assign another existing authentication UUID an operator membership. The one-time bootstrap command also verifies the first operator UUID against `auth.users`.

### Missing software paths

1. **No MFA enrollment or management UI.** There is no call to `mfa.enroll`, no QR/secret presentation, no enrollment verification route, no factor list, no factor choice, and no factor unenrollment flow. Turning enforcement on for the recorded factorless operator would lock the operator out.
2. **The AAL1-to-AAL2 path is treated like failed authentication.** `getActor()` returns `null` when an otherwise valid operator session lacks AAL2, so protected pages redirect to `/login`. Supabase recommends redirecting an elevatable AAL1 session to an MFA challenge page.
3. **Only the first verified TOTP factor is used.** A user with multiple verified factors cannot choose a backup factor.
4. **No password-recovery flow.** There is no public reset-request page, recovery callback, authenticated change-password page, `resetPasswordForEmail`, or `updateUser({ password })` call.
5. **Logout does not revoke the provider session.** `clearSession()` deletes only the application cookie. A second copy of that cookie remains usable until its short lifetime ends unless the Supabase session is revoked elsewhere.
6. **Additional access assignment does not verify the UUID against `auth.users`.** `memberships.user_id` has no foreign key to `auth.users`, and the normal operator action accepts any syntactically valid UUID. It can create an orphaned or mistyped backup-operator membership.
7. **No access-revocation UI.** The workspace can add or update memberships, but it cannot remove an operator/merchant membership or revoke that user's provider sessions.
8. **No operator-auth regression coverage.** Repository tests do not exercise MFA enrollment, AAL challenge/resume, multiple factors, password recovery, logout revocation, expired sessions, or a revoked hosted session.

### Small implementation map

| Change                           | Narrow location                                                                                    | Required behavior                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-request Supabase auth helper | New `src/lib/supabase-auth.ts`, then use from `src/lib/auth.ts` and auth routes                    | Construct a fresh client per request; validate tokens; expose current/next AAL and verified factors without sharing clients between requests.                                                                                                                                                                     |
| Staged operator sign-in          | Split auth handling out of `src/app/api/action/route.ts`; add a small MFA challenge page/component | Password sign-in reaches AAL1, `getAuthenticatorAssuranceLevel()` decides whether elevation is available, the operator chooses a verified factor, and only AAL2 receives general operator access.                                                                                                                 |
| Operator security page           | New protected account/security page and route                                                      | Enroll TOTP, show QR plus one-time secret, challenge and verify it, list verified factors, add a separately stored backup factor, and unenroll only after AAL2 reauthentication. Keep this route reachable for an authenticated AAL1 operator who must finish setup, without exposing any operator business data. |
| Password recovery                | New public request page, callback/exchange route, and authenticated update-password page           | Use enumeration-safe responses, PKCE-capable recovery, one canonical allowlisted redirect, no-store responses, strong-password feedback, and session revocation after completion according to the chosen policy.                                                                                                  |
| Provider-aware logout/revocation | `src/lib/auth.ts` plus the logout action                                                           | Revoke the current Supabase session before deleting the application cookie. Provide an operator-only remove-access action that also revokes the affected provider sessions through a server-only admin path. Never expose a service-role key to the browser.                                                      |
| Backup-operator integrity        | Existing membership action and account-access UI                                                   | Verify the UUID exists in the same project's `auth.users`, display factor readiness without factor secrets, support explicit access removal, and audit assignment/removal.                                                                                                                                        |
| Tests                            | Focused auth route/helper tests plus one authorized hosted rehearsal                               | Cover AAL1, AAL2, no factor, multiple factors, wrong/expired challenge, reset-link replay, logout, removed membership, revoked Supabase session, and tenant/role boundaries.                                                                                                                                      |

Use stable, verified TOTP factors for launch. The current Supabase JavaScript reference presents recovery-code APIs as experimental while another overview still recommends multiple factors; do not make experimental recovery codes the only recovery route. A separately controlled backup TOTP factor and a second recovery-capable operator are the conservative launch path unless Supabase support is verified in the actual project.

## 2. Support operations

### What the software already does

1. Member web help and inbound HELP/ordinary SMS create encrypted `member_support_requests`.
2. Valid inbound requests preserve member, latest message, grant, incident, and recovery context.
3. The operator support page masks phone numbers and private credentials and allows a resolution note.
4. Resolution records the operator and an audit event.
5. The schema allows `queued`, `working`, `resolved`, and `closed` states.

### Missing software paths

1. Nothing changes a request from `queued` to `working`; the UI jumps directly to `resolved`.
2. The request has no assignee, priority, due time, first-response time, last-touch time, or escalation state.
3. The operator cannot see aging buckets or an overdue warning. The queue is simply the oldest 100 open records.
4. No monitored notification tells primary or backup support that a request arrived or aged. SMS must not be used as a shortcut for this commissioning task.
5. `SUPPORT_EMAIL` is only checked for syntactic shape and printed in HELP copy. The application does not prove mailbox delivery, ownership, coverage, or response.
6. Pilot `support_owner` and `backup_support_owner` are free-text names. The launch checkbox does not bind them to active operator accounts or a dated coverage schedule.

### Small implementation map

1. Add an append-only support lifecycle with assignment, start-work, escalation, resolution, and reopen events. Keep the original encrypted member message immutable.
2. Add `assigned_to`, `due_at`, `first_responded_at`, and `last_touched_at` projections, or derive equivalent values from the event ledger.
3. Add aging and overdue counts to `/operator/pilot/support` and `/operator/pilot/settings`, with direct links to the affected request.
4. Require primary and backup operator IDs plus a dated coverage record before the support launch check can pass. Names alone are display metadata.
5. Use existing hosting/logging or an approved email/incident channel for notification. Record only delivery metadata; do not copy private support bodies into alerts.

## 3. Twilio callbacks and message commissioning

### What the software already does

1. `verifyMemberWebhook()` restricts callback kinds and content type, checks `AccountSid`, and validates the Twilio signature against the canonical application callback URL including its query string.
2. Status callbacks are idempotent by provider SID/state and use monotonic state ranking. Provider acceptance remains distinct from delivery.
3. Interrupted or uncertain submissions become `unknown` and are not automatically retried.
4. STOP, START, HELP, and ordinary inbound messages reconcile application records; START clears carrier suppression without restoring promotional consent.
5. The operator can inspect queued, delivered, unknown, and suppressed counts plus recent provider outcomes.

### Missing software and hosted proof

1. **The verified deployed source duplicates Advanced Opt-Out replies.** At `81ad63e`, the callback route emits a TwiML `<Message>` for every inbound result. Twilio Advanced Opt-Out can already emit the keyword response. The shared worktree contains the intended `inbound?.shouldReply` repair, but it is uncommitted and not part of deployment `dpl_9rz2JazvtfpLr35ARyK9G5XwJwpz`.
2. **No callback-health view.** Successful inbound/status callback time, last processing failure, signature/account mismatch counts, and callback staleness are absent from operator settings.
3. **No explicit reconciliation action for unknown sends.** The ledger displays the provider SID and correctly refuses automatic retry, but it has no operator workflow to record a provider lookup and final reconciliation decision.
4. **No successful hosted callback rehearsal.** The repository proves only that an unsigned callback was rejected. It does not prove a correctly signed callback reached the canonical host and advanced the intended message.
5. **Requested access and promotional delivery share one production transport switch.** `PRODUCTION_DELIVERY_ENABLED` gates both message classes. Per-message promotional consent is correctly checked only for `drop`, but the operator cannot commission requested secure-access delivery while keeping the promotional transport path administratively disabled with its own switch.

### Small implementation map

1. Finish and test the `shouldReply` contract for Advanced Opt-Out, including duplicate inbound events and provider-supplied `OptOutType` values.
2. Add a minimal callback health ledger containing callback kind, accepted/rejected class, processing outcome, provider SID hash/reference, and timestamp. Never store auth tokens or raw private links there.
3. Show callback health and stale/error warnings on the existing pilot settings page. Link valid processing failures to the related message/support record.
4. Add an operator reconciliation action for `unknown` messages that records the provider evidence and final state. Keep retries a separate, explicit decision.
5. Separate configuration for transactional requested access from optional promotional dispatch. Both may require the approved Uptick sender, but only promotional dispatch should require the promotional delivery enablement and member promotional consent.
6. In authorized staging, rehearse requested access, accepted/sent/delivered status changes, STOP, START, HELP, ordinary text, duplicate callback, out-of-order callback, invalid signature, and sender-rotation suppression. Actual handset receipt remains separate evidence from provider delivery state.

## 4. Commissioning and release-readiness enforcement

### Current behavior

The operator settings page shows several useful values: application origin, latest migration name, Vercel SHA, selected environment flags, scheduled-job health, and membership-message readiness. The pilot state transition also requires four-week capacity, seven manually checked launch items, a partner commitment, and `PILOT_ENROLLMENT_ENABLED=true` for a real run.

### Missing software enforcement

1. `releaseVerified` is a manual checkbox. `releaseSha` is optional free-form text up to 80 characters.
2. A real run does not compare its release SHA with `VERCEL_GIT_COMMIT_SHA`.
3. The settings page shows only the lexicographically latest migration. It does not compare the complete hosted ledger with the migration files packaged in the deployed commit or their checksums.
4. Pilot enrollment does not require application-verified MFA enforcement, a verified backup operator, password recovery, support coverage, callback rehearsal, or a current commissioning evidence record.
5. The operator-visible matrix omits CI/build status, packaged-versus-applied migrations, schema match, Brand/Campaign status, callback verification, support aging, legal notice/retention decision, and Market Cell readiness in one place.
6. `npm run db:migrate` immediately applies every pending migration. There is no read-only plan command that prints the expected/present/pending ledgers and checksum drift before mutation.
7. Release documents are stale historical records. They name deployment `dpl_X82Xh...` / source `33dc343` as current even though the fresh provider read identifies `dpl_9rz2...` / source `81ad63e`. `PILOT_RELEASE_CANDIDATE.md` also mixes an executed 001–021 release with migration 022 candidate evidence. A generated release manifest should supersede this ambiguity.

### Small implementation map

1. Add a read-only release manifest/check command that records the exact commit, dependency lock hash, ordered migration names and hashes, build/test result references, and expected hosted schema version.
2. Add a migration `plan` mode. It must fail on checksum drift, print pending migrations, and make no database changes. Keep `apply` a separate authorized command.
3. Build one `hostedCommissioningReadiness()` service used by pilot settings and real-run state transitions. Separate its sections exactly as software, messaging, identity/legal, market, enrollment, and support.
4. For a real run, require a strict 40-hex SHA equal to `VERCEL_GIT_COMMIT_SHA`, an exact expected migration ledger, and unexpired evidence records for the external checks. Do not let a boolean checkbox stand in for these facts.
5. Keep enrollment readiness separate from promotional readiness. A person who declines promotional SMS must still be able to join, use saved web access, and redeem an already issued benefit.
6. Keep each external fact bracketed until supplied. The application may require a dated attestation and evidence reference, but it cannot infer legal/provider/physical approval from configuration syntax.

## 5. External facts that code cannot supply

No software change can truthfully fill these fields:

### Supabase and operator ownership

- **Verified:** Vercel serves `81ad63e0922e4a1fb3bf2c4d51bbf001d458f51b` through READY deployment `dpl_9rz2JazvtfpLr35ARyK9G5XwJwpz`.
- **Verified:** Supabase is healthy on PostgreSQL 17, and migration history/public schema stop at 021 even though deployed source packages 022.
- `[UNKNOWN: reviewed authorization and controlled plan to apply migration 022, including pre-change backup and post-change checksum evidence]`
- `[UNKNOWN: primary operator account identifier and successful hosted login time]`
- `[UNKNOWN: primary operator verified MFA factors]`
- `[UNKNOWN: separately controlled backup factor and storage owner]`
- `[UNKNOWN: second recovery-capable operator account and verified MFA state]`
- `[UNKNOWN: tested password-reset mailbox, redirect, and completion time]`
- `[UNKNOWN: custom SMTP provider, sender identity, delivery result, and rate limits]`
- `[UNKNOWN: Auth Site URL and exact redirect allowlist]`
- **Verified:** the current security-advisor read returned only the expected INFO class for RLS-enabled public tables without browser policies; the older leaked-password warning statement is historical.
- `[UNKNOWN: direct password-policy and leaked-password setting review; absence from the current advisor result is not a substitute for recording the setting]`
- `[UNKNOWN: Supabase Auth audit-log storage/retention decision]`
- `[UNKNOWN: provider backup/PITR entitlement, retention, restore point, restore operator, and isolated restore result]`
- `[UNKNOWN: separately held Vercel/Supabase/Twilio/cryptographic recovery ownership]`

### Twilio and support

- `[UNKNOWN: Twilio Brand status]`
- `[UNKNOWN: Twilio Campaign status]`
- `[UNKNOWN: Messaging Service and sender approval status]`
- `[UNKNOWN: canonical inbound and status callback configuration]`
- `[UNKNOWN: successful signed callback rehearsal time and evidence]`
- `[UNKNOWN: allowlisted internal staging phone owner and authorization]`
- `[UNKNOWN: actual handset receipt evidence]`
- `[UNKNOWN: support mailbox spelling, ownership, delivery test, and monitoring schedule]`
- `[UNKNOWN: primary and backup support coverage with escalation contact]`

### Legal, release, and market

- `[UNKNOWN: exact legal business name]`
- `[UNKNOWN: notice/business address]`
- `[UNKNOWN: approved policy version and approver]`
- `[UNKNOWN: retention/deletion decision and approver]`
- `[UNKNOWN: CI run attached to the exact deployment commit]`
- `[UNKNOWN: real Market Cell, stores, staffed hours, backed stock, independent fallback, and partner commitment]`
- `[UNKNOWN: completed real-phone and physical-counter rehearsal]`

## 6. Official Supabase implementation guidance

The Supabase skill and current official documentation/changelog were reviewed for this scout. The relevant primary guidance is:

- [Multi-Factor Authentication](https://supabase.com/docs/guides/auth/auth-mfa): implement enrollment, unenrollment/management, challenge, and enforcement; on the server, redirect an elevatable AAL1 session to an MFA flow rather than treating it as a generic authorization failure.
- [TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp): enroll, display the QR/secret, challenge and verify, and use current/next AAL to decide the next step.
- [`getAuthenticatorAssuranceLevel`](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel): a JWT may be supplied in server contexts to validate and retrieve AAL information.
- [JavaScript Auth MFA overview](https://supabase.com/docs/reference/javascript/auth-mfa): stable recovery should use more than one verified factor; do not assume recovery codes are generally available.
- [Experimental recovery-code generation](https://supabase.com/docs/reference/javascript/auth-mfa-recovery-codes-generate): the installed client exposes recovery codes only behind an experimental flag. Treat that as optional until the actual hosted Auth version and product decision are verified.
- [Password-based Auth](https://supabase.com/docs/guides/auth/passwords): use enumeration-safe `resetPasswordForEmail`, an authenticated change-password page with `updateUser`, and production custom SMTP. Supabase's default sender is best effort and tightly rate-limited.
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls): set the production Site URL and allowlist the exact recovery redirect.
- [Auth audit logs](https://supabase.com/docs/guides/auth/audit-logs): sign-in, password recovery/change, factor, token-refresh, sign-out, and revocation events can be reviewed; database storage is a separate project setting.
- [Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod): review custom SMTP, rate limits/CAPTCHA, redirects, and email-link behavior as provider configuration rather than assuming application code proves them.

The current Supabase changelog also records production-impacting SMTP changes for new projects and the end of Node.js 20 support. Because this is a reused Supabase project and `package.json` does not pin a Node engine, verify `[UNKNOWN: hosted Node runtime]` and the project's actual SMTP configuration instead of inferring either from repository dependencies.

## 7. Minimum commissioning sequence after implementation

1. Freeze one reviewed commit and generate its release manifest.
2. Run the read-only migration plan against the hosted project and compare the full ledger/checksums.
3. With authorization, back up and apply only the reviewed pending migrations in order; then verify schema protections and ledger equality.
4. Deploy that exact commit with real enrollment and both delivery classes still closed.
5. Create/verify primary and backup operator access, TOTP factors, factor choice, password recovery, logout, access removal, and revoked-session behavior.
6. Verify merchant role and tenant boundaries with authorized internal accounts.
7. Verify support assignment, aging, escalation, mailbox delivery, and backup coverage.
8. In authorized staging only, verify signed callbacks and internal requested-access/support messaging. Do not send a promotion as a deployment smoke test.
9. Record Brand/Campaign/sender facts and the exact callback configuration from Twilio.
10. Complete Market Cell, stock, fallback, partner, real-phone, and counter evidence.
11. Review the single readiness matrix. Open requested access and real enrollment only after their gates pass.
12. Enable optional promotional dispatch separately, only after its provider/legal/callback/support gates pass. Individual promotional consent remains required for every weekly message.

## 8. Operator/member TSX test-gap review

This is a static review of the new or changed operator/member TSX in the shared worktree. It made no TSX edits. Targeted TypeScript and ESLint checks passed. Prettier currently fails on eight changed TSX files: `weekly-release-form.tsx`, the pilot fulfillment/page/support pages, `member-controls.tsx`, `your-uptick/page.tsx`, `demo/page.tsx`, and `demo-controls.tsx`.

### Actionable product issues

#### P1 — prevent accidental high-impact operator choices

1. `src/app/operator/pilot/support/page.tsx` preselects the first member and defaults the status to `withdrawn`. An operator can apply a withdrawal to the wrong person without deliberately choosing either value. Add disabled placeholder options, require both choices, show the masked member reference plus current status in a confirmation summary, and require a final checkbox for suspension, deletion pending, or withdrawal.
2. `src/app/operator/pilot/fulfillment/page.tsx` likewise preselects the first member, first destination, and affirmative `Suitable` result. A member-specific suitability record affects future assignment. Require deliberate placeholder selections and make neither suitable nor unsuitable the default. Echo member, destination, result, and drive estimate immediately above Save.
3. The support page loads up to 500 members into one native select. This is difficult to use on a phone and makes similarly masked member references easy to confuse. Reuse the existing member lookup or add a server-filtered combobox, then show only the selected member's current service state and recent evidence.

#### P1 — freeze the reviewed release plan during async work

1. `src/components/weekly-release-form.tsx` leaves the week selector enabled while a recommendation request is running. The operator can request week A, switch to week B, and receive an A plan under a B selector. The backend should reject the mismatched fingerprint at publication, but the screen presents contradictory state. Disable week changes while busy and discard responses whose run/week request identity is no longer current.
2. Member assignment selects remain enabled while publication is in flight. The request payload is captured before the await, so the operator can change the visible choices while the server publishes the older payload. Disable the full review fieldset while publishing and keep a read-only submitted summary until the result returns.
3. When a recommendation appears, no live region announces that the plan is ready and focus remains on the Generate button. Add a concise `role="status"` message and move focus to a programmatically focusable plan heading. Preserve the operator's keyboard position when an error occurs.

#### P1 — make member withdrawal idempotent and clearly recoverable from failure

1. `src/components/member-controls.tsx` creates `crypto.randomUUID()` inside every withdrawal submit. If the database commits but the response is lost, retrying creates a new request key and a duplicate service event. Hold one key in a `useRef` for the logical attempt; rotate it only after a confirmed success or a deliberate form reset.
2. Withdrawal success and failure share one `message` string rendered as `role="status"`. A failure is not marked as an alert or styled as an error. Use separate success/error state, `role="alert"` for failure, and clear stale messages at submission start.
3. `MemberAccountControls` receives no current service status, so a withdrawn member still sees the active withdrawal form and can submit it again. Pass the service status from `your-uptick/page.tsx`; replace the form with the recorded state, date, and support/resume path when future releases are already paused.

#### P2 — present only valid supply-amendment choices

1. `src/app/operator/pilot/page.tsx` offers all four pilot weeks, including the current/past week and any released week, although the backend accepts only an unreleased future week.
2. The current-commitment select lists plans for every week and does not update when the chosen week changes. A mismatched choice reaches the server and returns an avoidable validation error.
3. Filter to eligible future weeks first, then filter current commitments by the selected week. If none exist, show a specific empty state and link to the supply preparation step. After selection, show old versus replacement destination, quantity, payer, and commercial implications before the append-only amendment is submitted.

#### P2 — normalize network and server-error handling

1. `src/components/weekly-release-form.tsx`, `src/components/pilot-form.tsx`, and `src/components/demo-controls.tsx` call `response.json()` without a fallback. An HTML error page, empty gateway response, or interrupted response can surface `Unexpected end of JSON input` instead of a useful action. Use the guarded parsing already present in `member-controls.tsx` and preserve the HTTP status for support diagnostics without exposing response bodies.
2. `DemoButton` does not mark the action container `aria-busy` or announce success before navigation. Add busy state semantics and retain an actionable retry message when the demo step is attempted out of order.
3. Session expiry during a long operator form currently appears as an inline 401/403 error. Preserve the user's non-secret form values, give a clear reauthentication action, and return to the same operator page after sign-in.

#### P2 — improve small-screen and keyboard review of release tables

1. The five-column recommendation table relies on horizontal overflow but its scroll container is not keyboard-focusable and has no accessible region name. Give the wrapper `tabIndex={0}`, `role="region"`, and an `aria-label`; add a caption that names the selected week.
2. On narrow screens, add a compact member/destination review layout instead of requiring repeated horizontal scrolling between the table and per-member controls. Keep capacity, fallback, paid/organic status, and unknown suitability visible together.
3. Mark the generated demo QR as decorative because the adjacent link already supplies the action; otherwise verify its generated SVG has an accessible name. The visible URL action must remain available without scanning.

### Missing browser and accessibility coverage

The existing Playwright files test anonymous API boundaries. They do not exercise the new rendered workflows, and `playwright.config.ts` defines no mobile projects or accessibility tooling.

Add the following bounded coverage:

| Test                              | Minimum assertion                                                                                                                                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member withdrawal UI              | Confirmation is required; one stable request key survives a lost response/retry; failure is announced as an alert; success replaces the form; issued benefits remain visible.                                                           |
| Operator service status           | No member or status is preselected; destructive states require confirmation; search/select works with zero, one, duplicate-looking, and more than 500 members.                                                                          |
| Suitability review                | No affirmative default; empty member/destination states are explained; saved review is reflected in the next recommendation.                                                                                                            |
| Weekly recommendation and publish | Week cannot drift during fetch; choices freeze during publish; stale fingerprint gives a useful recovery action; unassigned members block publication; successful publication is announced and cannot be mistaken for physical handoff. |
| Future supply amendment           | Only unreleased future weeks and their own commitments appear; zero valid replacements has a guided empty state; server validation is rendered without losing entered evidence.                                                         |
| Demo journey                      | Keyboard-only completion of member → claim → QR → result → incident → recovery; out-of-order errors are announced; no real-data or real-SMS signal appears.                                                                             |
| Mobile viewport                   | Run the above at approximately 390×844 and 320 CSS-pixel width; no clipped controls, unreachable table content, or horizontal page overflow outside named table regions.                                                                |
| Screen reader semantics           | Native details/summary names, labels, required state, error association, live recommendation/success messages, current account status, and decorative QR treatment are present.                                                         |
| Network/error states              | Non-JSON 500/502, empty response, offline interruption, slow response, double activation, expired session, and committed-but-response-lost retry all produce stable, actionable UI.                                                     |

Automated checks should include at least one axe-style scan of `/join`, `/your-uptick`, `/operator/pilot`, `/operator/pilot/fulfillment`, `/operator/pilot/support`, and `/demo`, followed by a short manual keyboard and VoiceOver/NVDA pass. Automated scans do not replace testing the dynamic focus and live-region behavior described above.
