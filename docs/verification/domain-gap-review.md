> **Historical record.** This document describes an earlier implementation or review checkpoint. Use [current release truth](../REAL_ENROLLMENT_RELEASE_TRUTH.md) for this candidate’s fixes, evidence, verdicts and remaining gates. Earlier test counts, demo instructions and unresolved-gap statements are not current unless carried forward there.

# Real-enrollment domain gap review

Reviewed September 14, 2026 against commit `81ad63e0922e4a1fb3bf2c4d51bbf001d458f51b` (`origin/main` at review time) and the requirements in `UPTICK_GPT6_REAL_ENROLLMENT_MASTER_PROMPT.md`.

This was a read-only audit of application code, migrations, operator/member surfaces, and focused tests. No application code or migration was changed. Unrelated worktree changes were present and were left untouched.

## Release verdict

The audited domains are **not ready for controlled real enrollment**. The existing implementation has a sound immutable grant/evidence base and good release-time checks, but six P0 capabilities from the brief are absent or contradicted by current behavior:

1. admission capacity can remain overstated after backing supply becomes invalid and is not serialized with supply changes;
2. an unreleased future week cannot be amended append-only;
3. retained Growth Program history prevents the effective approved version from releasing;
4. the pilot assignment is sorted-list slicing, with no server-generated suitability decision or reasoned override;
5. withdrawal cannot be represented and a paused member blocks the whole cohort release;
6. a failed recovery cannot be superseded, and whole-location failure does not automatically stop new primary or recovery directions.

The focused existing suites pass, which shows these are contract and coverage gaps rather than known failing regressions:

```text
node --import tsx --test --test-concurrency=1 \
  tests/pilot-operations.test.ts \
  tests/pilot-promise.test.ts \
  tests/pilot-release-integrity.test.ts \
  tests/growth-programs.test.ts

36 passed, 0 failed
```

## P0-1: admission capacity can overstate real four-week backing

### Defect

`pilotCapacity` correctly creates the four Monday keys and takes the minimum week, but its per-supply arithmetic restores the full commitment after `supplyUsage` has already subtracted that commitment: [src/lib/pilot-operations.ts:192](../../src/lib/pilot-operations.ts#L192), [src/lib/pilot-operations.ts:205](../../src/lib/pilot-operations.ts#L205), [src/lib/pilot-operations.ts:214](../../src/lib/pilot-operations.ts#L214).

`supplyUsage` first computes total adjusted inventory, then reserves `max(committed, active grants)` and clamps `remaining` to zero: [src/lib/network.ts:95](../../src/lib/network.ts#L95), [src/lib/network.ts:145](../../src/lib/network.ts#L145), [src/lib/network.ts:160](../../src/lib/network.ts#L160). Adding `committed_quantity` after that clamp loses the amount of any shortfall.

Concrete example:

```text
saved quantity                         150
active pilot commitment               150
later physical inventory truth        100
supplyUsage.remaining                    0  (clamped)
pilotCapacity calculation       min(150, 0 + 150)
reported admission capacity            150  (should be at most 100)
```

The normal `adjustSupply` path refuses to create this shortfall, which is useful protection, but capacity must still fail closed when the stored facts are inconsistent, imported, reconciled, or changed by another authorized path. The brief explicitly requires the 150-committed/100-available case.

There is a second race. Admission locks the pilot run and then reads each supply in separate queries, but it does not lock the backing supplies: [src/lib/pilot-operations.ts:244](../../src/lib/pilot-operations.ts#L244), [src/lib/pilot-operations.ts:259](../../src/lib/pilot-operations.ts#L259). Supply pause locks only the supply row: [src/lib/network-operations.ts:613](../../src/lib/network-operations.ts#L613). A pause can therefore commit immediately after capacity admits a member. `pilotCapacity` can also combine values from different instants because it calls `supplyUsage` once per plan.

The current test covers the minimum of four weeks only when three weeks are completely absent: [tests/pilot-operations.test.ts:144](../../tests/pilot-operations.test.ts#L144). The short-stock test waits until release time: [tests/pilot-promise.test.ts:63](../../tests/pilot-promise.test.ts#L63), which is explicitly too late for the admission invariant.

### Existing code to reuse

- `pilotWeeks` for the exact four keys: [src/lib/pilot-operations.ts:44](../../src/lib/pilot-operations.ts#L44).
- The obligation categories already gathered by `supplyUsage`: adjustments, legacy reservations, grants, commitments, and replacement recoveries: [src/lib/network.ts:95](../../src/lib/network.ts#L95).
- The documented lock order in [docs/PILOT_ARCHITECTURE.md:53](../PILOT_ARCHITECTURE.md#L53).
- The hard-cap database trigger remains a final 200-member guard: [db/migrations/020_frozen_pilot_cohorts.sql:17](../../db/migrations/020_frozen_pilot_cohorts.sql#L17).

### Minimal contract

Introduce one shared backing calculation that returns unclamped components, for example:

```ts
type SupplyBacking = {
  totalInventory: number;
  pilotCommitment: number;
  issuedForCommitment: number;
  externalActiveObligations: number;
  replacementRecoveries: number;
  availableForCommitment: number;
  backedCommitment: number;
  shortfall: number;
};
```

`backedCommitment` must be computed before clamping hides a deficit. `pilotCapacity` should resolve only effective commitments, lock all of their supply rows in stable ID order in the same transaction, calculate every week from one consistent locked state, then return the smallest of all four weeks and the hard cap. Any fallback contribution needs an explicit admission-backing policy; the current recovery fallback must not be silently added to primary capacity.

Supply mutation paths that affect an active pilot must participate in the same lock protocol or refuse the mutation after rechecking admissions and effective capacity.

### Adversarial tests

1. Commit 150, seed/reconcile physical total to 100, assert capacity 100 and the 101st concurrent admission waits.
2. Commit 150, add 20 external active obligations, assert capacity is no more than 130.
3. Increase physical stock while commitment stays 150, assert capacity never exceeds 150.
4. Make week capacities 180/160/149/170, assert the cohort stops at 149.
5. Race 150 admissions with a supply pause or backing amendment; assert no serialization outcome leaves admitted count above effective four-week capacity.
6. Publish existing grants, reduce later available stock in a reconciliation fixture, and assert issued obligations remain visible while new admission capacity does not invent units.

## P0-2: future-week supply amendment does not exist

### Defect

`pilot_week_supplies` is a single current row with no ID, predecessor, reason, payer/commercial implications, or amendment state: [db/migrations/017_pilot_operations.sql:26](../../db/migrations/017_pilot_operations.sql#L26). Once any admission exists, its trigger rejects every update or delete, including a future-week replacement: [db/migrations/017_pilot_operations.sql:72](../../db/migrations/017_pilot_operations.sql#L72).

The only application mutation is `commitPilotSupply`, and it accepts only `draft` or `enrolling` runs: [src/lib/pilot-operations.ts:127](../../src/lib/pilot-operations.ts#L127), [src/lib/pilot-operations.ts:138](../../src/lib/pilot-operations.ts#L138). The operator API exposes only `supply-commit`: [src/app/api/pilot-operations/route.ts:38](../../src/app/api/pilot-operations/route.ts#L38). The operator page offers only a new unused commitment: [src/app/operator/pilot/page.tsx:267](../../src/app/operator/pilot/page.tsx#L267).

Release reads the original `pilot_week_supplies` row directly, so there is no effective future commitment to resolve: [src/lib/pilot-promise.ts:973](../../src/lib/pilot-promise.ts#L973).

### Existing code to reuse

- `commitPilotSupply` validation for run/week/market/classification/full-week coverage and finite stock.
- Release-time readiness, fallback, QR, zero-spend, and inventory checks: [src/lib/pilot-promise.ts:917](../../src/lib/pilot-promise.ts#L917).
- Growth Program roles and version links in `program_supply_links`.
- `economic_entries` and `growth_program_credits` for explicit financial adjustments rather than overwriting fees.
- The global Growth coordination and pilot/supply lock order.

### Minimal contract

Keep `pilot_week_supplies` as original history and add an immutable successor table such as:

```text
pilot_week_supply_amendments
  id
  run_id + week_key
  prior_supply_id
  replacement_supply_id
  replacement_committed_quantity
  reason
  payer_implication
  program_id + program_version (nullable pair)
  protection_implication
  financial_adjustment_reference (nullable)
  amended_by + amended_at
```

Allow one successor per prior effective commitment and resolve the chain with one shared `effectivePilotWeekSupplies(runId, weekKey)` function. The amendment transaction must lock coordination, run, and both supplies in the documented order; reject a week with a `weekly_releases` row; validate classification, full-week timing, inventory, readiness, fallback, payer/funder continuity, Program version, protection, and recalculated four-week cohort coverage. It must never update grants or the original commitment.

The operator surface needs an “Amend unreleased future week” action that displays old and new terms together and requires all implication fields before save.

### Adversarial tests

1. Live/frozen run, week 3 unreleased, replace Store A supply with Store B; assert original and successor both remain and only Store B is effective.
2. Attempt the same change after week 3 release; assert no write.
3. Race amendment with release; exactly one wins and no released grant is rewritten.
4. Race amendment with admission and inventory adjustment; assert final admissions remain within all-four-week capacity.
5. Replace paid supply with an unlinked supply; assert rejection rather than organic attribution.
6. Change payer/funder or protection without an explicit implication/credit record; assert rejection.

## P0-3: effective Growth Program version resolution contradicts retained history

### Defect

Migration 019 intentionally allows one supply to remain linked to sequential versions of the same Program and week: [db/migrations/019_growth_review_fixes.sql:16](../../db/migrations/019_growth_review_fixes.sql#L16). `programForSupply` then rejects whenever more than one historical link exists, before selecting the approved version: [src/lib/pilot-promise.ts:633](../../src/lib/pilot-promise.ts#L633), [src/lib/pilot-promise.ts:668](../../src/lib/pilot-promise.ts#L668). Thus the required `v1 -> v2 approved -> release with v2 attribution while v1 remains` journey cannot succeed.

The current integrity test codifies rejection of a superseded link rather than testing a retained v1 plus effective v2 link: [tests/pilot-release-integrity.test.ts:170](../../tests/pilot-release-integrity.test.ts#L170).

A second blocker prevents prospective amendments after any earlier Program grant has been issued. Approval queries for any grant from the Program, without limiting the check to affected or already released weeks: [src/lib/growth-programs.ts:683](../../src/lib/growth-programs.ts#L683). That makes a legitimate week-3 amendment after a week-1 release impossible. The existing test expects that blanket rejection: [tests/growth-programs.test.ts:503](../../tests/growth-programs.test.ts#L503).

### Existing code to reuse

- `program_supply_links` retains immutable history and its trigger prevents cross-Program/cross-week reuse.
- `growth_programs.approved_version`, immutable versions, and run-specific `growth_program_approvals` already identify the candidate effective context.
- `programForSupply` already fails closed for linked-but-invalid commercial supply and enforces the approved ceiling and weekly plan.
- The fulfillment-grant database trigger validates the final approved Program attribution: [db/migrations/016_growth_programs.sql:102](../../db/migrations/016_growth_programs.sql#L102).

### Minimal contract

Replace “exactly one historical link” with:

1. load every link for supply/week;
2. require that all links belong to one Program and one week;
3. select exactly one link whose version equals `growth_programs.approved_version` and has a run-specific approved decision;
4. require Program status `approved` or `active`;
5. reject if historical links exist but no unique effective approved link exists;
6. apply ceilings to that effective version and write its ID/version to the grant.

Program amendment approval should reject changes to already released weeks but permit changed, unreleased future weeks. Earlier grants keep their original `source_program_version`.

### Adversarial tests

1. v1 link retained, v2 link added, v2 approved for the run, no grants yet: release succeeds and every grant records v2.
2. Same history with v2 pending or rejected: release fails as paid supply, never organic.
3. v1 week 1 already issued; v2 changes only unreleased week 3: approval and week-3 release succeed, week-1 grants stay v1.
4. v2 attempts to alter an already released week: approval fails.
5. Historical links span two Programs or two weeks: fail closed as corrupt attribution.
6. Race v2 approval with release and assert the shared lock order yields either valid v1 or valid v2 attribution, never null or mixed attribution.

## P0-4: pilot assignment has no suitability model or auditable override

### Defect

The operator UI sorts admitted member IDs, asks only for a count per supply, and assigns each consecutive slice to that supply: [src/app/operator/pilot/fulfillment/page.tsx:73](../../src/app/operator/pilot/fulfillment/page.tsx#L73), [src/components/weekly-release-form.tsx:37](../../src/components/weekly-release-form.tsx#L37). It explicitly calls this “stable order”: [src/components/weekly-release-form.tsx:81](../../src/components/weekly-release-form.tsx#L81).

The server accepts the client-provided mapping. It checks eligibility, readiness, capacity, and duplicate week/offer entitlements, but it never computes or validates member-to-destination suitability: [src/lib/pilot-promise.ts:708](../../src/lib/pilot-promise.ts#L708), [src/lib/pilot-promise.ts:1027](../../src/lib/pilot-promise.ts#L1027). The saved reason contains only release metadata and `reviewedBy`; it contains no ZIP relevance, travel relevance, history, unknown-suitability flag, repeated exposure, paid load, or override reason: [src/lib/pilot-promise.ts:1119](../../src/lib/pilot-promise.ts#L1119).

Because there is no suitability predicate, paid supply can pass all commercial/readiness checks and still be assigned to a member for whom the destination is not suitable. Payment does not explicitly bypass a check; the check is absent.

### Existing code to reuse

`allocateMember` already has a simple, explainable ordering based on referral, recent merchant redemptions, operator-entered drive minutes, and stable ID tie-breaking: [src/lib/network.ts:260](../../src/lib/network.ts#L260), [src/lib/network.ts:282](../../src/lib/network.ts#L282), [src/lib/network.ts:301](../../src/lib/network.ts#L301). Its reason JSON is close to the required audit record: [src/lib/network.ts:313](../../src/lib/network.ts#L313).

Use the ranking ingredients, not `eligibleDrops` unchanged: the real pilot must use the frozen admission as the obligation anchor even if current ZIP changes, while recording moved/unknown geography truthfully.

### Minimal contract

Add a server-side `recommendPilotAssignments({runId, weekKey})` that returns a persisted proposal/fingerprint with:

- one recommended supply per operationally eligible admitted member;
- member-level reason fields (`homeZipMatch`, `workZipMatch`, `acquisitionPartner`, `driveMinutes`, `recentDestinationCount`, `unknownSuitability`, `rotationKey`);
- supply aggregates (`assigned`, `available`, `fallbackAvailable`, `paidAssigned`, `repeatedExposure`);
- an explicit tiny-cell “all destinations fit” fact and reproducible rotation when applicable.

Release should accept a proposal ID/fingerprint. A manual member/supply override needs an immutable reason and must rerun every hard limit. Paid status may influence the paid-load aggregate, never the suitability score or eligibility predicate.

### Adversarial tests

1. Two destinations with different drive-minute relevance; reverse member IDs and assert assignments follow suitability, not ID order.
2. Missing travel estimate produces `unknownSuitability=true` and is visible to the operator.
3. A member received the same merchant last week under a different offer; assert repeated exposure is counted and rotation prefers the other suitable location.
4. A paid location is unsuitable while organic supply is suitable; assert payment cannot select it.
5. Manual override without a reason fails; with a reason but over capacity or unsuitable destination still fails.
6. Same inputs produce the same recommendation/fingerprint under concurrent operator review.

## P0-5: withdrawal and operational disposition are missing

### Defect

Member state has only `pending`, `active`, and `paused`: [db/migrations/009_network.sql:34](../../db/migrations/009_network.sql#L34), [src/lib/membership-identity.ts:21](../../src/lib/membership-identity.ts#L21). There is no append-only pilot disposition record for voluntary withdrawal, service suspension, verified deletion request, inaccessibility, geography change, or SMS opt-out.

The member API offers sign-out, recovery codes, help, incident reporting, preferences, and claim, but no withdrawal: [src/app/api/member/route.ts:222](../../src/app/api/member/route.ts#L222). The account surface likewise ends with browser sign-out: [src/components/member-controls.tsx:523](../../src/components/member-controls.tsx#L523).

For a frozen run, release requires the submitted members to exactly equal every admission and also requires every one to be `active`: [src/lib/pilot-promise.ts:875](../../src/lib/pilot-promise.ts#L875), [src/lib/pilot-promise.ts:891](../../src/lib/pilot-promise.ts#L891). Therefore pausing one admitted member either includes them and fails the active check or omits them and fails the exact-cohort check. One withdrawn/inaccessible member blocks the release for everyone.

The analytical denominator behavior is already correct and should be preserved: `pilotScorecard` starts from all immutable admissions, regardless of later engagement: [src/lib/pilot-operations.ts:563](../../src/lib/pilot-operations.ts#L563).

### Existing code to reuse

- Immutable `pilot_admissions` as the analytical denominator.
- Append-only consent records so marketing STOP remains separate.
- Session/recovery-code revocation for operational suspension or deletion handling.
- `pilotScorecard` and `partnerSummary` for historical cohort reporting.

### Minimal contract

Add append-only `pilot_member_dispositions` events keyed by run/member, with a constrained kind, effective time, reason/evidence, actor, and `blocks_future_release` flag determined by kind. Suggested kinds: `voluntary_withdrawal`, `service_suspension`, `verified_deletion_request`, `inaccessible`, `geography_changed`, and `sms_opt_out_observed`. SMS opt-out and geography change should be recorded facts but must not automatically end the membership obligation.

Derive the operational weekly audience as admissions minus the latest effective disposition that blocks release. Persist the excluded member IDs and disposition IDs in the weekly release audit/fingerprint. Keep all admissions in the scorecard denominator; do not create a grant, fulfillment, or replacement benefit for a withdrawn member.

### Adversarial tests

1. Freeze 150; one member voluntarily withdraws before week 2; release 149, retain denominator 150, and record no week-2 grant for that member.
2. Marketing STOP leaves the member in the operational audience and preserves an issued grant.
3. Geography change is recorded but does not block a frozen obligation.
4. Service suspension before release excludes only that member; lifting it uses a new event and does not rewrite history.
5. Withdrawal raced with release produces either a grant created before the effective withdrawal or a documented exclusion, never an untracked omission.
6. Verified deletion handling revokes sessions while keeping the minimum immutable analytical/audit record required by policy.

## P0-6: repeated recovery and recovery supersession are structurally impossible

### Defect

`recovery_grants.state` supports only `issued` and `redeemed`; it has no failed, superseded, canceled, or expired terminal fact: [db/migrations/015_pilot_promises.sql:136](../../db/migrations/015_pilot_promises.sql#L136). Both `incident_id` and `original_grant_id` are globally unique: [db/migrations/015_pilot_promises.sql:137](../../db/migrations/015_pilot_promises.sql#L137), [db/migrations/015_pilot_promises.sql:183](../../db/migrations/015_pilot_promises.sql#L183).

`issueIncidentRecovery` returns the same remedy for an identical retry, rejects a different remedy for the incident, and separately rejects any recovery already attached to the original grant: [src/lib/pilot-promise.ts:1360](../../src/lib/pilot-promise.ts#L1360), [src/lib/pilot-promise.ts:1390](../../src/lib/pilot-promise.ts#L1390). A failed first remedy therefore cannot be preserved and superseded by a second backed remedy.

The member can report a new incident against the original grant, but the second incident still cannot receive a recovery. Existing tests cover pre-claim recovery, post-redemption recovery, expiry boundaries, and idempotent redemption; none covers a failed first remedy followed by a second recovery.

### Existing code to reuse

- Immutable original grant, claim, redemption evidence, incident evidence, and recovery snapshots.
- Capacity checks for same-counter fallback and independent replacement supply.
- `counts_as_weekly_benefit=false` and `counts_as_paid_placement=false` constraints.
- Recovery redemption evidence and the original private-pass binding.

### Minimal contract

Permit multiple historical recovery attempts per original grant while enforcing one active remedy with a partial unique index. Add `supersedes_recovery_id`, a failure/supersession reason, and lifecycle states such as `issued`, `redeemed`, `failed`, `superseded`, and `canceled` (expiry can be a recorded state or an explicit derived-and-closed event). A `supersedeRecovery` transaction must lock the original grant and active remedy, record failure evidence, reserve the next remedy, then supersede the old remedy atomically. It must release only an unredeemed old reservation and must never alter original evidence.

### Adversarial tests

1. First same-counter remedy fails; issue replacement-supply remedy; assert both snapshots remain and only the second is active.
2. Two operators concurrently supersede one remedy; exactly one successor becomes active.
3. Expired unredeemed remedy frees its reservation exactly once before the successor reserves stock.
4. Redeemed remedy cannot be superseded or double-counted.
5. Second recovery crosses into a later week or past pilot end while preserving the original week and paid attribution flags.
6. Failure after a digital recovery redemption preserves unknown physical handoff rather than fabricating success.

## P0-7: whole-location failure does not stop new directions

### Defect

The ordinary member eligibility path joins `market_locations` and requires `active`: [src/lib/network.ts:183](../../src/lib/network.ts#L183). The real pilot release supply query does not join `market_locations` at all: [src/lib/pilot-promise.ts:822](../../src/lib/pilot-promise.ts#L822). The replacement-recovery query also omits it: [src/lib/pilot-promise.ts:1544](../../src/lib/pilot-promise.ts#L1544). As a result, setting a whole location inactive does not by itself stop new pilot grants or new replacement recoveries when the per-supply readiness row still says `ready`.

Incidents are grant/member scoped only: [db/migrations/015_pilot_promises.sql:118](../../db/migrations/015_pilot_promises.sql#L118). The operations warning groups unresolved incidents by owner rather than location and has no repeated-failure threshold or location action: [src/lib/pilot-operations.ts:789](../../src/lib/pilot-operations.ts#L789). Readiness can be manually suspended per supply, but there is no atomic whole-location outage or bulk affected-obligation workflow.

### Existing code to reuse

- `market_locations.active` as the canonical location routing gate.
- `pauseSupply` and `saveDestinationReadiness(state='suspended')` for individual supply controls.
- Existing grant-scoped incidents and recovery issuance for member-specific evidence/remedies.
- Operations constraint display for surfacing an outage and recovery queue.

### Minimal contract

Add an immutable location incident/outage record with location, start/end, reason, severity, owner, and state. Opening an outage should atomically deactivate or override routing for every supply at that location, identify affected outstanding grants, and create a recovery work queue without fabricating individual member outcomes. Every primary release and both recovery destination queries must require the location to be active and free of an active outage.

Add an explicit, configurable repeated-failure escalation rule based on location plus a bounded time window. Crossing the threshold should require operator review and prevent new assignments immediately; it should not silently rewrite Program protection or issued grants.

### Adversarial tests

1. Mark the location inactive while readiness remains `ready`; primary release rejects it.
2. Mark the replacement location inactive; replacement recovery rejects it.
3. Open a whole-location outage with 150 outstanding grants; all appear once in a recovery queue and no new direction points there.
4. Race outage creation with release; either the release commits first and every grant is queued as affected, or outage wins and release writes nothing.
5. Repeated high-severity incidents cross the threshold and block assignment; low-severity isolated incidents do not trigger it.
6. Closing an outage does not automatically restore stale readiness; stock, shifts, QR, and fallback must be rechecked.

## Integration order

The safest dependency order is:

1. add effective future-week commitment resolution and the shared locked capacity calculation;
2. fix effective Growth version selection and future-week-only amendment approval;
3. add persisted assignment recommendations and reasoned overrides;
4. add member disposition events and derive the operational release audience;
5. add recovery supersession and location outages;
6. update operator surfaces and run concurrency tests on PostgreSQL, not only PGlite.

All new mutations that touch these domains should follow the existing order: Growth coordination, pilot run, Market Cell, Growth Program, supply rows by ID, then member rows by ID. Database constraints should remain the final guard because several failures above can otherwise be reintroduced through a second application path.
