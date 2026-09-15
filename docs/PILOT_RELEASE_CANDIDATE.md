> **Historical record.** This document describes an earlier implementation or review checkpoint. Use [current release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md) for this candidate’s fixes, evidence, verdicts and remaining gates. Earlier test counts, demo instructions and unresolved-gap statements are not current unless carried forward there.

# Pilot release candidate for hosted commissioning

Prepared September 14, 2026. **Operating deployment and migrations approved and executed.** See [HOSTED_COMMISSIONING.md](HOSTED_COMMISSIONING.md) for the completed release and remaining authenticated/physical checks. This release enables an internal rehearsal; it does not authorize real enrollment, promotional sending or A2P submission.

## September 14, 2026 pre-pilot repair campaign

This section records the final pre-pilot software campaign and supersedes any
earlier "all green" claim about the release path. It does not change the hosted
or launch status below, which remains gated.

**Branch `claude/keen-brown-wtdvht`, commit `0b68859`, base
`b2562c4e83dc652478064ebd82e30bb2aced04f2`.**

Six release-path defects were confirmed against current source and repaired,
each with a regression test that fails without its fix:

| Defect                       | Behaviour before                                                                                                                                                                                                                       | Behaviour now                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time-dependent recovery test | The same-counter recovery test asserted a rejection using "three days from now" while the fixture's readiness ended one day after the current market week, so the expectation depended on the weekday and failed on a Monday.          | Expiry is judged against the readiness boundary the fixture persisted, with just-before, equal-to and just-after cases, plus fixed-instant week and DST boundary tests. |
| Frozen cohort vs. geography  | The weekly release compared each member's current, mutable `market_id` to the release market, so one admitted member changing ZIP blocked the whole frozen cohort's committed week.                                                    | A frozen run identifies its obligations through `pilot_admissions`. Releases without a frozen run still resolve their audience by current market.                       |
| Paid supply read as organic  | `programForSupply` filtered on the approved version inside the `WHERE` clause, so a link to a pending, unapproved or superseded Program version matched nothing and the supply was released as organic, losing commercial attribution. | Links are found first and validated after, so invalid commercial context is rejected instead of silently reclassified.                                                  |
| Opposing lock order          | Program approval took the coordination singleton before the pilot run; the weekly release took them in the opposite order and could deadlock against it.                                                                               | The release takes the singleton first. The shared order is documented in [PILOT_ARCHITECTURE.md](PILOT_ARCHITECTURE.md).                                                |
| QR readiness mismatch        | Program approval counted any active credential as staff QR readiness, so an NFC-only credential passed approval and then failed at release.                                                                                            | Approval requires `credential_type='qr'`, matching the release.                                                                                                         |
| Terminal fallback exhaustion | Issuing a recovery wrote a terminal `exhausted` state derived from a capacity count, so an unused reservation that later expired left the fallback permanently unusable.                                                               | Availability is recomputed from redeemed grants and still-live reservations; the state is a recorded observation, not a withdrawal of approval.                         |

Migration `022_suppression_reconciliation.sql` reconciles pre-014 sender-level
STOP history into `member_global_suppressions`, so rotating a sender cannot
resurrect a member who already stopped. It is forward-only and idempotent, never
overwrites a newer global record, and resolves ambiguous ordering conservatively
in favour of STOP. Migration 014 is not rewritten.

One supplied finding was **not** a defect on current source: supply linked to a
_terminated_ Program was already rejected. Its regression test is kept.

### Verification actually run

| Check                       | Command                                                             | Result                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Unit/database suite         | `npm test`                                                          | 195 passed, 0 failed (baseline was 175 passed, 1 failed)                                                                 |
| Lint                        | `npm run lint`                                                      | Passed                                                                                                                   |
| Types                       | `npm run typecheck`                                                 | Passed                                                                                                                   |
| Formatting                  | `npm run format:check`                                              | Passed                                                                                                                   |
| Production build            | `npm run build`                                                     | Passed                                                                                                                   |
| Separate-session PostgreSQL | `bash scripts/verify-postgres.sh` (isolated cluster, PostgreSQL 16) | All checks passed, including 150 synthetic grants under competing sessions and migration 022 applying on real PostgreSQL |
| Lock order under contention | `scripts/verify-postgres-lock-order.ts`                             | The opposing order still deadlocks; the shared order serializes without deadlock across repeated interleavings           |

Each regression test was also run against the unpatched source to confirm it
fails there rather than passing vacuously.

### Not run here, and why

- Hosted/authenticated journeys on `pilot.upticklocal.com`: requires deployment
  authorization not granted in this session. No remote push or deploy was made.
- Real carrier messaging, A2P submission, real members, real SMS: deliberately
  not performed. Enrollment and delivery stay closed.
- Physical counter rehearsal and phone/camera capture: require the real store,
  staff and device.
- Browser end-to-end (`npm run test:e2e`) and backup/restore rehearsal against
  hosted infrastructure: not executed in this session.

## Exact source and destination

| Item                                 | Value                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Operating repository                 | `braydenokley13-ux/uptick-platform-v0`                                                         |
| Branch                               | `codex/pilot-ready-service`                                                                    |
| Verified application commit          | `605f147504d74325b7baf8439281debbbcc0a5f8`                                                     |
| Verified hosted release source       | `33dc34325307174137a4b2ea9f6399c0fb43b161` (includes migration 021 and commissioning evidence) |
| Production branch                    | `main`                                                                                         |
| Vercel team                          | `team_FVNcvbojx1qlGIHJGRhwOihR`                                                                |
| Vercel project                       | `prj_U1rgTJlWYnxdLOOu6wPppoa39W2c`                                                             |
| Canonical alias                      | `https://pilot.upticklocal.com`                                                                |
| Existing Supabase project            | `dmirmwzubafuzoxcporr` (`uptick-staging`)                                                      |
| Existing hosted source at inspection | `a16fd6edd742edc0bcf2ede6a30f438a39c3944f`                                                     |
| Separate public-site candidate       | `e6174b72a598c5949b3680ada23ac313574e8530` in `braydenokley13-ux/upticklocal`                  |

The hosted release source contains the verified application plus the separately tested migration 021 and backup verifier. Later documentation-only commits do not change application behavior. Deployment `dpl_X82XhAVUwV1Pgj3BDX3nLyi6LYLM` reached READY and received the canonical alias. Future releases should record their exact source and recheck any changed application, migration, dependency or configuration files.

## Commissioning settings

These explicit non-secret commissioning values were written to the canonical Vercel project, preserving each existing sensitive/encrypted protection. See the sanitized commissioning-gates evidence.

```text
APP_URL=https://pilot.upticklocal.com
UPTICK_ENV=staging
UPTICK_LOCAL_MODE=false
PILOT_ENROLLMENT_ENABLED=false
PRODUCTION_DELIVERY_ENABLED=false
SMS_TRANSPORT=development
MESSAGING_APPROVED=false
LEGAL_APPROVED=false
OPERATOR_MFA_REQUIRED=false
```

Keep the existing database and cryptographic secrets in their protected environment store. Do not rotate encryption keys during this routine release. Confirm actual operator membership and the staging tester allowlist before hosted sign-in. Turn on `OPERATOR_MFA_REQUIRED=true` only after the operator has enrolled and successfully tested a factor and recovery access. The real-pilot decision requires that protection; a green internal rehearsal does not waive it.

The simulated SMS transport sends no carrier messages. A later carrier test requires a separate deliberate transport/allowlist configuration and authorized internal recipients. Retain closed enrollment and closed production delivery throughout commissioning. Do not change the public pilot to production mode until its separate launch conditions are satisfied.

## Forward migration checksums

Applied 014–021 in order, using a transaction per file and preserving the repository filename convention in `schema_migrations`. Preserve existing 001–013 history and all legacy records. Never run a seed against this project.

```text
91d62bdbe91edf7eabd6c0e80ca138cc20164277671e19e35130f4577b033260  014_membership_service.sql
7b8108c7a8bb2d91f89829c96a4e7cfac356a76e6b844446713a4a467b92d555  015_pilot_promises.sql
7166a1344e99b2d5e5e59ba8c11ad3088833ea616af86bfb4d0363517972baa1  016_growth_programs.sql
684e2f0edc12283889419ca0535b40bf0b282e41a3b1f00ded20b3df78dddcfa  017_pilot_operations.sql
c126c969ffcf2bae2a1da55e834dc045e51b866e5ca624f42275ce257bb14550  018_runtime_safety.sql
dfd3a2bc869cb435d77bce2d73352916fbabb64b58ee95a0a7922ca109e1b626  019_growth_review_fixes.sql
7659a8c9c5060dec6837eaa89ff5c5a8ab229bf57c251ff674d59a5731386830  020_frozen_pilot_cohorts.sql
640a9730e75b4f46c86926a1a65cad603cc75a63558f6e2ac910a8f017813809  021_membership_function_search_paths.sql
```

## Commissioning sequence and remaining checks

1. **Completed:** inspected the deployment target, migration ledger and existing row counts before changing the hosted service.
2. **Public-data recovery completed locally:** captured and restored all 65 pre-release public tables and 31 rows with matching fingerprints. Auth, Storage, provider restore points and PITR remain outside this proof.
3. **Completed:** applied 014–021, preserved all 64 non-ledger legacy table fingerprints, verified all 97 public tables have RLS and cleared function search-path warnings.
4. **Completed:** deployed exact source `33dc343` to the named operating project; verified its canonical alias and closed enrollment/delivery settings.
5. **Partly completed:** all 17 hosted anonymous/session-boundary checks passed, and both actual authenticated Vercel cron jobs succeeded. Positive operator sign-in/revocation, member access, staff QR and signed callback flows remain to be rehearsed with authorized internal accounts.
6. **Remaining:** follow the operator playbook for a real-phone and physical-counter rehearsal. Resolve legal identity, exact support email, business commitments, account protections, provider recovery and carrier readiness before a real launch decision.

Public-site publication is a separate release from its archived candidate. Its exact Vercel target is `prj_ZHFEe3PL6RGJ1fmkLS0RZ1kC2Bjv`; merged main is `6e6f135a44c0ab63b89abecfd6f1d82272bfa253`. The user supplied the specifically requested production branch/publication approval. The production branch is now main, and the exact merged source was submitted as deployment `dpl_55oBSR1wwNYxpN6DAtDrLtPgLr7T`; see the public production evidence for verified completion. Enrollment is explicitly closed for that project.

The [implementation report](PILOT_IMPLEMENTATION_REPORT.md) records exact local test evidence and remaining blockers. The [recovery runbook](PILOT_RECOVERY_RUNBOOK.md) explains database rollback, issued commitments, keys outside the database and STOP/callback reconciliation.
