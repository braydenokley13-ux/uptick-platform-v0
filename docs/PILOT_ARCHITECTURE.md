# Pilot service implementation decisions

Baseline: `8acc4a64ff0e2427398c366be72b0968fb7a98bf` (latest main, checked September 13, 2026). Branch: `codex/pilot-ready-service`.

The implementation brief overrides the CEO package where they differ: target 150 adults, cap 200, negotiated fee, no mandatory third destination, reuse the existing Supabase project, and do not submit A2P. No real launch or promotional delivery is implied by a deployment.

## Shared model and launch invariants

1. A verified membership is separate from optional promotional consent. Joining needs an adult attestation. STOP preserves membership and issued obligations. One-time access links exchange by POST into revocable sessions; GET does not reserve, subscribe or redeem.
2. Keep `member_allocations(member_id, week_key)` as the global member-week anchor. New pilot releases issue one featured, inventory-backed grant per admitted member. Recovery references that original obligation and never becomes another paid placement. Existing claim-only history remains readable and redeemable under its saved terms.
3. New pilot supply has explicit exact item, usable hours, zero required spend and member fee, finite capacity, funder and fulfiller. Historical records are not silently certified. Destination readiness and executable fallback must be current before release.
4. Release locks the run/market and inventory in a stable order, reserves a whole reviewed cohort in one transaction, and publishes only if every member is covered. Claiming transfers an existing reservation; it does not consume a second unit. Inventory reductions cannot undercut obligations. Expiry and disputed redemption do not erase history.
5. Incident recovery is idempotent, backed, assigned, and recorded with payer/evidence. Same-counter substitution is preferred. Original digital redemption remains recorded even if physical handoff failed.
6. `growth_programs` and immutable `growth_program_versions` record buyer, dated objective, negotiated fee, benefit ceiling, planned placements, evaluation and narrowly scoped paid-featured protection. `program_supply_links` attach execution to an approved version. Organic supply needs no program. Payment never bypasses readiness or supply.
7. `pilot_runs` are four-week operating records above Market Cells. `pilot_admissions` freeze the evaluation cohort. Admission capacity cannot exceed 200 or the smallest confirmed weekly capacity. `partner_commitments` record actual planned/completed distribution. `economic_entries` and `labor_entries` keep revenue, expense, exposure, liquidity and retail value separate.
8. New pilot records carry `data_kind` (`real`, `internal`, `demo`, `synthetic`). Existing uncertain records default to `internal`; no automatic promotion to real. Real reporting uses the fixed real admitted cohort. Seed utilities fail closed against hosted or real records.
9. Preserve deny-by-default RLS, signed callbacks, tenant checks, immutable commitments and uncertainty-safe messaging. Jobs are bounded and observable; the scheduler no longer runs legacy outbound work. Live consent flow is built before A2P submission.

## Refinements from independent review

- A cohort freezes permanently when the run first becomes live. A paused live run can resume but cannot return to enrollment. Migration 020 enforces this in the database as well as the application.
- Every paid version has a placement category. Existing protections apply even if the new buyer requests no protection. Commercial capacity uses the backed target before freeze and actual admitted cohort after freeze.
- Amendments cannot rewrite any Program with issued grants. This deliberately conservative pilot rule avoids reselling attention already delivered; a richer prospective-only amendment engine is deferred.
- The same supply can carry forward between unissued versions of one Program/week, while serialized validation prevents reuse by other Programs/weeks. Credit references are idempotent.
- Recovery is available before claim, before redemption, or after digital redemption. A later claim binds a pre-issued remedy exactly once. A fulfilled remedy invalidates an unredeemed original without fabricating an original redemption; already recorded original evidence remains intact.
- Incident forms carry the exact grant shown on the pass. Outstanding older-week recovery appears independently of the current allocation.
- Pilot and partner use metrics follow grants issued by the selected run and matching classification. Legacy and other-run redemptions do not enter the numerator.
- Preview builds cannot access the reused shared pilot database. Local synthetic verification and canonical hosted commissioning remain distinct.
- Initial commercial approval and each weekly release require current stock evidence; a future-dated confirmation is never evidence of completed work. Readiness must cover the full promised period.

## Migration and file ownership

All migrations are forward-only using this repository's sequential numbered convention (the explicit brief overrides a skill's generic timestamp convention). No agent rewrites applied migrations. Root serializes Git commits.

| Owner                           | Files and scope                                                                                                                                                               | Migration                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Root, before parallel edits     | Extract identity into `membership-identity.ts` and events into `demand-events.ts`; retain network re-exports                                                                  | none                            |
| Membership (Sol)                | `membership-identity.ts`, member sessions, membership copy, `member-messaging.ts`, `member-experience.ts`, member controls/pages, API member and member Twilio, related tests | 014 membership/consent/sessions |
| Promise (Sol, extra reasoning)  | `network.ts`, `network-operations.ts`, supply/readiness/grants/recovery modules, `tap.ts`, promise API, dedicated tests                                                       | 015 pilot promises              |
| Commercial (Sol)                | New growth program module/API/components and merchant workspace only; dedicated tests                                                                                         | 016 Growth Programs             |
| Root                            | Pilot runs/admission/partner/economics/Today/reporting and shared integration                                                                                                 | 017 pilot operations            |
| Later reliability/public squads | Jobs, seed safety, public alignment, isolated Postgres/restore and hosted commissioning                                                                                       | 018+ if needed                  |

No two agents independently rewrite a shared core file. Cross-owner changes are requested through the root. Every module validates authorization server-side. UI mutations use same-origin POST and no-store responses. Read the installed Next.js guides before route/component edits.

## Integration contracts

- Membership module re-exports the existing identity function signatures through `network.ts`; functions may accept server-side session credentials after exchange. Public routes must derive identity from a cookie, never trust a posted member ID.
- Promise module exposes released grant/readiness/recovery functions. It must enforce real admission through `pilot_admissions` when available; root supplies the admission adapter before final integration. New release accepts an explicit reviewed member ID cohort, week and optional run ID; root must verify that cohort against admissions.
- Commercial approval accepts bounded capacity supported by stored commitments, not merchant-entered audience claims. Program versions are immutable; amendments do not rewrite issued grants. Root integrates attention checks with run/week records.
- Historical compatibility exists for old records only. Real members cannot obtain unreserved benefits through old allocation paths. Read-only pages never issue new reservations.

## Lock order

Every operation that can touch both the Growth Program coordination singleton
and a pilot run takes its row locks in exactly this order:

1. `growth_program_coordination` (the global singleton)
2. `pilot_runs`
3. `market_cells`
4. `growth_programs`
5. `network_drop_supplies`, ascending by id
6. `uptick_members`, ascending by id

Program approval (`approveGrowthProgramVersion`) already followed this order.
The weekly release (`releaseWeeklyBenefits`) took the pilot run first and the
coordination singleton last, so an approval and a release running at the same
time could each hold the lock the other needed next. The release now takes the
coordination singleton at the top of its transaction.

An operation that needs only a lower-numbered lock may still take it alone; the
rule is that locks are never acquired in decreasing order. Adding a new shared
operation means placing it in this list, not inventing a local order for it.

`scripts/verify-postgres-lock-order.ts` proves this against separate PostgreSQL
sessions. It deliberately also drives the old, opposing order and asserts that
it still deadlocks, so the check keeps demonstrating the ordering rather than
quietly passing if contention stops happening.

## Verification plan

Baseline unit/database suite: 146 passed, 0 failed. Required candidate checks include migration replay, unit/request tests, real PostgreSQL concurrency (150 members, competing release workers, last unit), grant/claim accounting, STOP after queueing, recovery after digital redemption, duplicate remedies, protection/amendments, fixed denominators, data isolation, job restarts, signed callbacks, tenant boundaries, mobile browser flow and isolated backup restore. Report hosted/carrier/physical checks separately and never mark an unperformed check passed.
