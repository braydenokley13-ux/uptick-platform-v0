# Real-enrollment candidate validation — 2026-09-15

## Candidate identity and evidence rules

- Validation date: 2026-09-15 EDT.
- Working branch: `codex/real-enrollment-ready`.
- Checked-out commit before the candidate is committed:
  `81ad63e0922e4a1fb3bf2c4d51bbf001d458f51b`.
- The candidate was an uncommitted working tree during these checks. The commit
  above identifies its base; it does not identify the candidate changes.
- No hosted database command was run. The PostgreSQL checks created disposable
  local clusters under `/tmp`, disabled TCP listening, enabled `fsync`, and
  removed their temporary directories after shutdown.

Evidence in this directory is separated into two kinds:

1. **Raw captured output** is output saved directly by a command or an exact
   read-only API response.
2. **Recorded result** is a faithful transcription of output observed in the
   Codex command transcript when no standalone log file was written. It is not
   represented as a raw log.

## Final local source gates

These are recorded results unless a raw evidence file is linked.

| Command                | Result | Recorded evidence                                                                     |
| ---------------------- | ------ | ------------------------------------------------------------------------------------- |
| `npm test`             | PASS   | 292 tests, 292 passed, 0 failed, 0 skipped, 0 cancelled; `duration_ms 123509.298042`  |
| `npm run typecheck`    | PASS   | `tsc --noEmit`, exit 0                                                                |
| `npm run lint`         | PASS   | `eslint .`, exit 0                                                                    |
| `npm run build`        | PASS   | Next.js 16.3.4; compile 5.1 s; TypeScript 6.0 s; 25/25 static pages generated; exit 0 |
| `npm run format:check` | PASS   | Exact output is in [format-check.txt](./format-check.txt)                             |
| `git diff --check`     | PASS   | Exit 0 with no output                                                                 |

The build reported that Next loaded `.env.local`. The build command did not run
the migration CLI or a hosted-database verification command. It also warned
that `/Users/braydenwhite/package-lock.json` was outside this Git repository
and was ignored.

### Packaged migration traces

The build completed its file tracing step. The three requested trace files each
contain migration 034:

- `.next/server/app/api/pilot-operations/route.js.nft.json` contains
  `../../../../../db/migrations/034_callback_commissioning_scope.sql`.
- `.next/server/app/api/member/route.js.nft.json` contains
  `../../../../../db/migrations/034_callback_commissioning_scope.sql`.
- `.next/server/app/operator/pilot/settings/page.js.nft.json` contains
  `../../../../../../db/migrations/034_callback_commissioning_scope.sql`.

The exact `rg` output is in
[build-migration-traces.txt](./build-migration-traces.txt). The `.next` trace
files are generated build artifacts and are not copied into this evidence
directory.

## Focused regressions

The following are recorded results:

- `tests/effective-program-version.test.ts`: 6/6 passed. This includes issuing
  a version 1 grant, approving version 2 afterward, and confirming the growth
  workspace still reports version 1 with one issued grant while version 2 has
  zero.
- `tests/growth-programs.test.ts`: 10/10 passed after correcting a synthetic
  supply fixture from `2030-02-04` to `2030-02-05`. The extra day is required
  because the fourth local New York week ends five hours after the UTC date
  literal used by the old fixture.
- `tests/frozen-pilot-resume.test.ts`: 2/2 passed in two immediate focused
  reruns, including one rerun after temporary diagnostics were removed.
- Callback route plus release-readiness focused checks: 9/9 passed. These cover
  invalid signatures, best-effort callback-health writes, aggregate bounded
  health fields, release/sender/configuration scope, expiry, legacy checksum
  baselines, and checksum drift rejection.
- Membership-consent focused checks: 5/5 passed, including bearer credentials
  with a leading or trailing hyphen.

## Transient and corrected failures

These failures are retained so the record does not imply every attempt passed.

### Frozen-pilot resume transient

An interim full run finished with 291/292 passing. The only failure was:

- `tests/frozen-pilot-resume.test.ts`, line 314 at that time.
- Expected one `fulfillment_grants` row for the published release and observed
  zero.
- The capacity assertion `[0, 1, 1, 1]`, live resume, frozen timestamp, and
  denominator assertions before it passed.

Temporary stage diagnostics in an immediate focused rerun observed one returned
grant and one stored grant before and after resume. That focused run passed 2/2.
The diagnostics were removed, a second focused run passed 2/2, and the final
full run passed 292/292. There was no retained code change made in response to
this transient failure. Its exact cause was not reproduced, so this report does
not claim a proven cause.

### Growth fixture boundary

An earlier full run finished with 284/290 passing and six failures in
`tests/growth-programs.test.ts`. Every failure stopped at “The selected pilot
has no backed audience available for paid placements.” The shared fixture's
fourth supply expired at `2030-02-04T00:00:00Z`, before the end of the fourth
New York local week at `2030-02-04T05:00:00Z`. Extending only the synthetic
fixture expiry to `2030-02-05` kept the production full-week predicate strict.
The focused growth suite then passed 10/10, and the final full suite passed.

## Real PostgreSQL 021-to-034 upgrade and admission proof

Command: `node --import tsx scripts/verify-real-enrollment-postgres.ts`

This section is a recorded result from the command's structured JSON output.
The final run exited 0 and reported:

- PostgreSQL 16.11 Homebrew on arm64 macOS.
- Disposable local PostgreSQL with a Unix socket only, TCP disabled, and
  `fsync` enabled.
- Upgrade start: `021_membership_function_search_paths.sql`.
- Upgrade end: `034_callback_commissioning_scope.sql`.
- Exact migration ledger matched the migration directory.
- Migration `034_callback_commissioning_scope.sql` had a 64-character lowercase
  SHA-256 record with `basis: applied`.
- Seeded rows in `customers`, `uptick_members`, `member_senders`, and
  `member_suppressions` had identical before/after fingerprints.
- A pre-upgrade sender STOP was reconciled into program-wide suppression.
- Every one of four supply weeks included finite primary stock, zero-spend and
  zero-fee terms, an independently keyed approved fallback, time-bound complete
  readiness, and an active staff QR credential.
- Capacity before reduction: `[150, 150, 150, 150]`.
- Capacity after one physical-stock reduction: `[150, 150, 149, 150]`.
- Smallest four-week capacity: 149.
- Simultaneous admission attempts: 150.
- Admitted: 149.
- Waitlisted: 1.
- `hostedDatabaseTouched: false`.

## Real PostgreSQL separate-session concurrency proof

Command: `bash scripts/verify-postgres.sh`

This is a recorded result. The final run exited 0 with
`ALL SEPARATE-SESSION POSTGRESQL CHECKS PASSED.` It applied migrations 001
through 034 and proved these named paths:

- Four simultaneously active independent PostgreSQL sessions.
- Four concurrent duplicate claims converge on one claim, one message, and one
  consent-choice row.
- Four concurrent redemptions converge on one redemption.
- Competing claims for the final reserved pass commit one winner and fully roll
  back the loser.
- Competing uses of the final redemption permit one success.
- Concurrent same-week approvals create one broadcast and one approved-version
  row.
- Same-phone claims preserve separate merchant entitlements and reject
  cross-tenant writes.
- Four members competing for the final reserved network perk produce one
  entitlement and reservation.
- Concurrent weekly allocation and merchant choice preserve one immutable
  allocation and chosen benefit.
- Four passes racing at one location QR consume the final redemption once.
- Secure NFC rejects replay, stale counters, and wrong locations while accepting
  a fresh counter with exact evidence.
- Overlapping weekly schedulers create one Drop credential and Drop message per
  member and advance beyond the first page.
- Six concurrent first-verified referral joins respect a five-join cap without
  undoing valid memberships.
- Competing pending access links credit only the invitation attached to the
  exact first verification.
- A 200-member coverage graph uses six SQL round trips and counts 100 physical
  items as no more than 100 covered members.
- Merchant and membership sender configuration cannot share a service or phone.
- Two competing release workers publish 150 grants atomically; duplicate claim
  and recovery paths converge.
- Opposing lock order reproduces the documented deadlock, while the shared lock
  order repeatedly serializes without deadlock.

The first attempt reached the overlapping-scheduler assertion and found eight
total messages where the old verifier expected four. The four additional rows
were the newly required `opt_in_confirmation` messages. The verifier was
corrected to assert four `purpose='drop'` messages and four
`purpose='opt_in_confirmation'` messages separately. The complete rerun then
passed.

## Real PostgreSQL logical restore proof

Command: `bash scripts/rehearse-restore.sh`

This is a recorded result. The final run exited 0 and reported:

- Isolated local logical dump and restore.
- TCP disabled and `fsync` enabled.
- Restore duration: 420 ms.
- 150 grants retained.
- Exact fingerprints matched across 15 tables:
  `schema_migrations`, `pilot_runs`, `pilot_admissions`,
  `pilot_week_supplies`, `weekly_releases`, `fulfillment_grants`,
  `member_claims`, `claims`, `fulfillment_incidents`, `recovery_grants`,
  `recovery_redemptions`, `member_consents`,
  `member_global_suppressions`, `member_messages`, and
  `member_message_events`.
- `realProjectTouched: false`.

An earlier successful restore run recorded the same table and grant checks in
562 ms. The 420 ms result above is the final run.

## Current `main` GitHub Actions status

The public GitHub REST API was queried read-only and without credentials on
2026-09-15. The latest `main` workflow run returned HTTP 200:

- Workflow: `Pilot service checks`.
- Run: [34908507326](https://github.com/braydenokley13-ux/uptick-platform-v0/actions/runs/34908507326).
- Run number: 12.
- Commit: `81ad63e0922e4a1fb3bf2c4d51bbf001d458f51b`.
- Started: `2026-09-14T23:21:50Z`.
- Completed: `2026-09-14T23:25:27Z`.
- Conclusion: success.
- The `verify` job and each reported step completed successfully, including
  install, lint, typecheck, tests, PostgreSQL concurrency, restore, HTTP E2E,
  and build.

The exact jobs API response is saved as
[github-main-ci-jobs.json.txt](./github-main-ci-jobs.json.txt). This workflow validates
the current committed `main` SHA. It does not validate the uncommitted candidate
working tree described above.

## Scope limits

- PGlite tests are included in the 292-test local suite, but PGlite is not
  counted as real multi-session PostgreSQL evidence.
- The PostgreSQL commands were rerun after migration 034 and the capacity,
  reporting, and scheduler verifier changes. Later candidate work did not add a
  migration beyond 034. The final full tests, typecheck, lint, format check, and
  production build ran after the remaining source changes.
- Hosted commissioning, live provider delivery, and hosted backup recovery are
  outside this local validation report.
