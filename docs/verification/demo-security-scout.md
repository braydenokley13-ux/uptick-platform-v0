> **Historical record.** This document describes an earlier implementation or review checkpoint. Use [current release truth](../REAL_ENROLLMENT_RELEASE_TRUTH.md) for this candidate’s fixes, evidence, verdicts and remaining gates. Earlier test counts, demo instructions and unresolved-gap statements are not current unless carried forward there.

# Demo Studio security and architecture scout

Reviewed against operating commit `81ad63e` and the real-enrollment master brief. This is a read-only architecture note. It does not certify hosted state and it does not propose a migration.

## Finding

The application already contains the real domain operations needed for a safe local demonstration. The smallest implementation is a loopback-only Demo Studio that creates a fresh PGlite directory, seeds a complete synthetic four-week pilot, and drives the existing HTTP/UI flows. It should not add a production authentication bypass or reuse the protected `/pilot` staging-persona route.

The current pieces are close, but they are not yet a complete demo:

- `scripts/seed-browser-rehearsal.ts` requires a `/private/tmp/uptick-browser-rehearsal-*` database and rejects `DATABASE_URL`, which is a strong start.
- That script currently creates three synthetic members but explicitly creates no issued grants. It also writes a fixture file containing the staff QR token and actor identifiers.
- `seedSyntheticPilot()` creates a four-week run date range, but it commits supply only for the current week. It is a verification fixture rather than a complete four-week demo dataset.
- `/api/studio` is the offer editor. It is not a Demo Studio controller.
- `/pilot` is a protected hosted staging-persona chooser and requires a real provider access token. It should remain unchanged.
- Local merchant/operator identity buttons already exist on `/login`, but there is no landing page that joins the member, merchant, operator, staff QR, incident, and recovery scenes.
- Existing screenshot evidence is historical and partial. No all-scenes screenshot set or all-scenes offline PDF generator exists.

## Reusable safety gates

Use these functions as the single source of truth rather than duplicating their checks:

| Existing function                                                                   | Reuse                                                            | Boundary it already enforces                                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `localMode()` in `src/lib/config.ts`                                                | Every demo page, route handler, reset action, and local identity | Development environment, `UPTICK_LOCAL_MODE=true`, no `VERCEL`, and `APP_URL` hostname limited to `localhost` or `127.0.0.1`.           |
| `assertLocalSeedEnvironment()` in `src/lib/seed-safety.ts`                          | Launcher and fixture seed before opening or mutating demo data   | Rejects non-local mode, any `DATABASE_URL`, any Vercel environment, and enabled real enrollment.                                        |
| `assertNoRealPilotData()` in `src/lib/seed-safety.ts`                               | Before seed and before reset                                     | Refuses a database containing real members or real pilot runs.                                                                          |
| `getDb()` in `src/lib/db.ts`                                                        | Normal app runtime                                               | Uses PGlite only when local mode is explicit; otherwise requires `DATABASE_URL`. Preview deployments are denied shared database access. |
| `simulatedTransport()` and `smsEnvironmentBlock()` in `src/lib/environment.ts`      | Join and every dispatch path                                     | Development transport is simulated; development with Twilio selected is blocked.                                                        |
| `assertSameOrigin()` in `src/lib/http.ts`                                           | Demo mutations                                                   | Existing CSRF-style origin boundary; all new mutations should retain it.                                                                |
| `setSession()` / `getActor()` in `src/lib/auth.ts`                                  | Known local merchant/operator buttons                            | Existing signed, HTTP-only local session and real hosted Supabase validation.                                                           |
| `memberSessionCookie()` and member-session functions in `src/lib/member-session.ts` | Real member browser flow                                         | HTTP-only, same-site member session, revocation, and one-use recovery codes.                                                            |

Add one narrowly named aggregate guard, for example `assertDemoRuntime()`, and call it at the top of the launcher, seed/reset implementation, Demo Studio page, and every demo-only mutation. It should require all of the following at once:

1. `localMode()` is true.
2. `UPTICK_ENV === "development"`.
3. `SMS_TRANSPORT === "development"`.
4. `PILOT_ENROLLMENT_ENABLED !== "true"`.
5. `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TWILIO_ACCOUNT_SID`, and `TWILIO_AUTH_TOKEN` are absent from the child process.
6. `VERCEL` and `VERCEL_ENV` are absent. CI may run the isolated screenshot suite, so a generic `CI` flag should not disable Demo Studio by itself.
7. `APP_URL` has `http:` and an exact loopback hostname.
8. `LOCAL_DATABASE_PATH` resolves inside the launcher-created demo root and contains a marker file created by the launcher.

The explicit absence of Supabase and Twilio credentials is defense in depth. Existing messaging code already blocks real SMS in development, but the demo process should be incapable of constructing a provider client with useful credentials.

## Minimal Demo Studio shape

### 1. Separate reusable fixture code from verification scripts

Move the reusable fixture builder from `scripts/verify-postgres-pilot.ts` into a library such as `src/lib/demo-fixture.ts`, keeping `verify-postgres-pilot.ts` as a caller. Do not import production demo behavior from a verification script.

Extend the returned manifest rather than exposing raw database rows. A useful manifest is:

```ts
type DemoManifest = {
  version: 1;
  databaseId: string;
  memberPhone: string;
  sourceToken: string;
  merchantOrganizationId: string;
  operatorUserId: string;
  runId: string;
  weekKeys: [string, string, string, string];
  supplyIds: [string, string, string, string];
  currentSupplyId: string;
  staffPointToken: string;
};
```

Use conspicuous `.test` contacts and reserved fictional North American numbers. Mark the organization `is_demo=true` and classify the market, source, run, members, supply, grants, incidents, recoveries, and demand events as `demo` or `synthetic` consistently. The current `seedSyntheticPilot()` does not set `organizations.is_demo`, so the Tap page can miss its sample banner even though the grant snapshot is synthetic.

Create four week keys and a valid supply commitment for each week. The current week should have a published `weekly_release` and one issued `fulfillment_grant` ready for the member to claim. Future weeks should remain backed and visible without fabricating future redemption outcomes.

### 2. Launch with a clean child-process environment

Add two package scripts:

```text
npm run demo:reset
npm run demo
```

`demo:reset` should create a fresh uniquely named directory under a dedicated root such as `.data/demo-studio/`, write a marker with a random database ID, migrate PGlite, seed the manifest, and atomically make that run current. It should only remove an older directory after all these checks pass:

- the resolved target is a direct child of the dedicated demo root;
- the marker exists and says `kind: "uptick-demo-studio"`;
- `assertDemoRuntime()` passes;
- `assertNoRealPilotData()` passes against the target;
- the path is not the ordinary `.data/uptick` database and is not the repository root.

`demo` should spawn Next with a constructed allowlist of environment values rather than inheriting `.env.local`. Force `UPTICK_ENV=development`, `UPTICK_LOCAL_MODE=true`, `SMS_TRANSPORT=development`, `PILOT_ENROLLMENT_ENABLED=false`, `PRODUCTION_DELIVERY_ENABLED=false`, `MESSAGING_APPROVED=false`, `LEGAL_APPROVED=false`, a loopback `APP_URL`, and the marked demo PGlite path. Delete all hosted/provider keys from the child environment.

This design keeps reset recoverable during development: create the new run first, point the launcher at it, then remove only old marked demo runs. Never reset a database through SQL table truncation selected by an environment URL.

### 3. Add a loopback-only `/demo` landing page

The page should call `assertDemoRuntime()` on every request and show a fixed, prominent `DEMO · SAMPLE DATA · NO REAL SMS` banner. Its buttons should be ordinary links to real routes:

- **Open Member Journey** → a source-specific `/join/<sourceToken>` URL.
- **Open Merchant View** → a demo-only login action that calls the existing signed local-session path, then `/merchant/results`.
- **Open Operator View** → the same local operator session path, then `/operator/pilot` or `/operator/pilot/fulfillment?run=<runId>`.
- **Open Staff QR** → `/tap/<staffPointToken>`.
- **Trigger Demo Stockout** → a demo-only POST action that calls `reportMemberFulfillmentIncident()` for the manifest member’s grant using a stable idempotency key.
- **Issue Recovery** → a demo-only POST action that calls `issueIncidentRecovery()` with the seeded fallback.
- **Reset Demo** → a request to the local launcher process, or a server action that rotates only a validated marked demo directory.

Do not put an actor, member, claim, or pass ID in editable form fields. Resolve every target from the server-side manifest. The demo controller must reject a manifest/database ID mismatch to prevent stale browser tabs from mutating a newly reset run.

### 4. Use the real member and QR flow

Keep these existing paths unchanged and drive them through the browser:

1. `POST /api/member` with `action: "join"` calls `requestMemberAccess()`, `queueMemberAccess()`, and `dispatchRequestedMemberAccess()`. Development returns the private `/u/<credential>` URL and records the message state as development.
2. The `/u/<credential>` page and `action: "confirm"` call `exchangeMemberAccess()` and set the real member session cookie.
3. `/your-uptick` uses `memberHome()` and displays the exact issued weekly grant.
4. `action: "claim"` calls `claimMemberDrop()` and creates the real private pass.
5. `action: "pair"` stores the encrypted active-pass credential.
6. `/tap/<staffPointToken>` and `POST /api/tap` call `tapPassView()` and `redeemAtPoint()` using the real staff-QR checks.
7. Member incident submission calls `memberIncidentGrant()` and `reportMemberFulfillmentIncident()`.
8. Operator recovery calls `issueIncidentRecovery()`.
9. The second scan calls `redeemAtPoint()` again, records `recovery_redemptions`, resolves the incident, and preserves the original redemption evidence.

The fixture phone must match the number the founder enters. A pre-created synthetic member under another number would cause the join path to create an unrelated `internal` member, because local enrollment currently classifies browser joins as `internal`. Prefer starting with no member and allowing the real join to create one, then attach that member to the prepared demo run through a narrowly scoped demo orchestrator. If the fixture pre-creates the member, use the exact same fictional phone and ensure all downstream records consistently use the member’s actual data kind.

### 5. Put the banner at the shared frames

The current labels are uneven: `MemberFrame` shows local development, `Shell` shows local sample, and offer/Tap pages depend on record-level `is_demo`. Add the full warning at shared layout/frame level when `assertDemoRuntime()` is true, then retain record-level labels. Cover member, merchant, operator, access-link, pass, Tap, policy, and Demo Studio scenes.

Do not key the banner only from `localMode()`: ordinary local development and a deliberately isolated Demo Studio are different evidence states.

## All-scenes screenshot and PDF fallback

Add a dedicated Playwright project that launches through the demo launcher and uses the manifest. It should use real UI clicks for state changes and take both desktop and phone-width screenshots.

Recommended deterministic scene list:

1. Demo Studio landing.
2. Member join form with optional promotional checkbox visibly unchecked.
3. Simulated access result showing no SMS sent.
4. Member confirmation page.
5. Member current benefit with exact item, store, hours, and no-purchase terms.
6. Claimed private pass with secrets visually redacted for the artifact.
7. Staff QR/Tap ready state.
8. Redemption receipt.
9. Merchant results showing the recorded redemption.
10. Member incident report.
11. Operator incident view with original evidence.
12. Operator recovery issuance.
13. Member recovery pass.
14. Recovery redemption receipt.
15. Operator and merchant views showing incident resolved and recovery recorded.

Use Playwright contexts at a desktop viewport and `390 × 844`. Keep the live browser context unredacted so real actions work, but mask bearer paths and 43-character credentials before screenshots. A practical pattern is a screenshot-only CSS overlay plus artifact copies with neutral URL captions; never write raw access, pass, member-session, recovery, referral, or QR credentials into committed HTML, JSON, screenshots, PDF metadata, logs, or filenames.

Generate one static HTML contact sheet from the captured PNGs and print it with Playwright Chromium `page.pdf()`. Include the scene title, expected state, and a footer: `OFFLINE DEMO FALLBACK · SAMPLE DATA · NO REAL SMS · generated <timestamp> from <commit>`. The PDF generator must verify all required scene IDs exist and fail if any image is missing. The artifact directory should be gitignored by default; a deliberately curated redacted PDF can be copied into founder materials.

## Tests to add

### Isolation tests

- Reject every non-loopback `APP_URL`, including a loopback-looking subdomain.
- Reject `DATABASE_URL`, Supabase keys, Twilio credentials, Vercel markers, real enrollment, and Twilio transport one at a time and in combinations.
- Prove that the demo launcher strips inherited `.env.local` hosted values.
- Prove the PGlite path is under the dedicated demo root and has the matching marker.
- Reject reset for an unmarked directory, `.data/uptick`, repository root, parent directory, symlink escape, and path traversal.
- Insert one real member or real pilot run in an isolated fixture and prove seed/reset returns before mutation.
- Prove a stale manifest cannot operate on a new database run.
- Prove demo login and demo-control routes return 404 or 403 outside `assertDemoRuntime()`.
- Prove demo identities cannot satisfy hosted `verifiedSession()` because they have no provider token; retain the existing `/pilot` provider-token requirement.
- Inject a provider spy and prove the complete demo makes zero provider calls and every queued message remains `development`/simulated.

### Journey tests

- Run join → confirmation → current grant → claim → pair → staff QR → redemption through the HTTP/UI boundary.
- Verify merchant/operator views show exactly one recorded redemption and label it sample data.
- Run stockout → incident → recovery → recovery redemption; assert original claim/redemption/evidence rows remain unchanged and the recovery uses its separate ledger.
- Verify duplicate clicks are idempotent and reloads keep the same outcome.
- Verify all four pilot weeks are backed while only the current week has a demonstrated outcome.
- Verify every named screenshot scene is captured at both viewports and the PDF page count/scene index is complete.

Existing tests provide useful lower-level coverage: `tests/member-messaging.test.ts` covers environment fail-closed behavior and zero provider calls in development; `tests/tap.test.ts` covers QR policy, duplicate redemption, revocation, and an isolated rehearsal ledger; `tests/pilot-promise.test.ts` covers pre-claim and post-redemption recovery; `tests/member-experience.test.ts` covers durable recovery visibility; the HTTP specs cover same-origin, body, credential, and role boundaries. None currently proves the complete demo journey or the launcher/reset boundary.

## Privacy, admin, support, and MFA gaps

### Already present

- Public privacy, terms, and SMS pages disclose the currently unfinished retention/deletion review and keep legal approval visible.
- Member web help and inbound SMS create encrypted support requests. Operators see a masked phone hint, credential-redacted message text, membership/consent context, grant/incident/recovery references, and an audited encrypted resolution.
- Member sessions can be revoked, and eight hashed one-use recovery codes can replace earlier unused codes.
- Hosted operator sessions are checked against Supabase Auth on every request, including the underlying `auth.sessions` row. When enforcement is enabled, operators require an `aal2` token.
- Login can challenge and verify an already enrolled TOTP factor.

### Still missing before real enrollment

- There is no operator privacy-admin workflow for verified access, correction, deletion, de-identification, or account/session revocation requests.
- There is no request-state model or audit trail distinguishing identifiers, consent history, immutable operational evidence, and de-identified retained evidence.
- There is no configurable retention policy or deletion job. The public page correctly says the schedule and procedure still need approval.
- `/api/export` exports merchant activity; it is not a member privacy export.
- Support shows open queued/working requests and resolution, but has no aging/SLA flag, assignment/working transition, reopening/appeal path, verified-request workflow, or dedicated privacy-request type.
- `memberSupportQueue()` decrypts message bodies for an operator and queries all open requests. That is acceptable for an Uptick operator role, but future admin scopes should be explicit; do not expose this route to merchant personas.
- Operators can be challenged only after a TOTP factor already exists. The application has no MFA enrollment screen, factor management, recovery ceremony, backup-operator commissioning, or UI that proves enforcement is safe to enable.
- Logout clears Uptick’s cookie but does not call Supabase global/local sign-out. Server validation of the provider session limits the risk, yet the commissioning flow still needs an explicit provider-session revocation control and test.
- Member browser-session revocation exists only as a member sign-out action. There is no operator action to revoke all active sessions for a verified privacy/support request.

Keep `OPERATOR_MFA_REQUIRED=false` until enrollment, challenge, recovery, backup operator, and revoked-session tests all succeed. Demo Studio must never be presented as evidence that hosted MFA or provider recovery works.

## Non-negotiable risk boundaries

- Never accept a database URL as a demo argument.
- Never inherit provider credentials into the demo child process.
- Never create a demo endpoint whose only guard is a secret query parameter or a record’s `is_demo` flag.
- Never permit a hosted origin, preview deployment, non-loopback bind address, or production/staging environment to render or mutate Demo Studio.
- Never reuse `/pilot` staging personas for public/local demo access.
- Never expose bearer tokens in screenshot artifacts, fixture manifests committed to Git, terminal output, page titles, analytics, referrers, or support notes.
- Never call a simulated message sent, delivered, or read.
- Never turn the demonstrated digital redemption into proof of physical handoff or purchase.
- Never rewrite the original failed redemption or its evidence when recovery is issued.
- Never show synthetic/demo results as real merchant performance or real cohort retention.
- Never make reset depend on broad filesystem deletion, a glob, or an environment-selected database connection.
- Never use Demo Studio readiness as a reason to open enrollment, enable production delivery, enable MFA enforcement, or claim hosted commissioning.

## Recommended implementation order

1. Extract the fixture builder and add `assertDemoRuntime()` plus path-marker validation.
2. Build `demo:reset` and `demo` around a clean environment and fresh PGlite run.
3. Seed four weeks, one ready current grant, known local identities, one staff QR, and a funded fallback.
4. Add the loopback-only `/demo` controller and global demo banner.
5. Wire its buttons to the existing member, Tap, merchant, operator, incident, and recovery flows.
6. Add isolation tests before adding screenshot automation.
7. Capture the full desktop/mobile scene set and generate the redacted all-scenes PDF.
8. Separately implement privacy admin and MFA enrollment/recovery; keep their release gates closed until hosted commissioning is proven.
