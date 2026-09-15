# Controlled real-enrollment release checklist

This is the action checklist. [Release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md) contains the current evidence and verdicts. An unchecked external item is not permission to infer success.

## Software candidate — integrator / release owner

- [ ] Record the exact platform and public-policy commits from the release truth; preserve newer main work if either main moves.
- [ ] Require passing CI for the final candidate before merging. Local candidate validation and main CI are separate evidence.
- [ ] Inspect migrations 022–034 in order. Confirm every server function packages all migration SQL files and schema checksums.
- [ ] Read the local PostgreSQL upgrade, independent-session races and restore results, including their limitations and transient test record.
- [ ] Rehearse the founder reset/launch sequence and open the offline PDF before a meeting.

## Controlled hosted release — deployment owner

- [ ] Approve the exact backup, 022–034 forward migration and closed deployment as a separate release action. Main auto-deploys: do not merge first and commission later by accident.
- [ ] Capture a recoverable hosted backup, migration ledger and row fingerprints. Verify identity, STOP, issued history and audit preservation after upgrade.
- [ ] Review legacy migration checksums against actual historical SQL/schema before recording a baseline in Pilot settings.
- [ ] Deploy the reviewed source and aligned public copy with enrollment, global delivery and both SMS classes closed.
- [ ] Set correct HTTPS origin, production classification, independent secret values and the privacy suppression HMAC key. Configure the approved legal identity, support contact and retention policy without inventing missing facts.
- [ ] Bootstrap the first verified operator once; then use **Settings → Account access** for named people/businesses. Commission TOTP, backup operator, recovery, logout/revocation and role/tenant rejection before MFA enforcement.
- [ ] Commission the actual provider Auth recovery configuration, callback URLs and member recovery. Local simulated identities are not this proof.
- [ ] Configure and observe the preparation and dispatch schedules. Current freshness windows are 15 and 5 minutes respectively.
- [ ] Verify application backup/restore separately from Supabase Auth, PITR availability, encryption/session secrets and Twilio state.

## Messaging — founder / Twilio account owner / support owner

- [ ] Supply legal name, entity type, EIN/profile evidence as applicable, representative, notice address and business-domain contact. Approve policy/retention wording with the responsible reviewer.
- [ ] Publish both repositories’ aligned Privacy, Terms and SMS pages with truthful entity facts. Replace development-only screenshots with anonymous canonical-host evidence for registration.
- [ ] Authorize and submit the truthful Brand/Campaign package. Record submission, approval and sender association as separate provider facts.
- [ ] Configure the dedicated membership service/number, Advanced Opt-Out and signed inbound/status URLs. Preserve status-callback query parameters.
- [ ] Authorize exact internal recipients and a controlled real-SMS window with enrollment closed. Staging additionally enforces `INTERNAL_TEST_NUMBERS`.
- [ ] Observe requested access, opt-in confirmation where enabled, weekly delivery where enabled, STOP, START, HELP, ordinary support, unknown outcomes and sender rotation. Record provider acceptance, signed callback and handset receipt separately.
- [ ] Record production-scoped inbound and status success on the exact release/account/origin/environment/sender. Repeat before seven days or immediately after any scope change.

## Market and daily operation — accountable operator / store and partner owners

- [ ] Create a real Market Cell and participating gas/convenience-store locations; save actual geography and manual travel relevance.
- [ ] Create the draft four-week run before commercial approval. Save exact zero-spend/zero-fee terms, independently usable finite fallback and named payer/fulfiller.
- [ ] Verify owner/manager contacts, all serving shifts, exact item, usable hours and staff QR. Check stock within 72 hours and readiness through the complete local week.
- [ ] Commit capacity for all four weeks. Review the minimum backed week, shared stock/paid ceilings and the hard cap of 200.
- [ ] Approve effective Growth terms if paid; organic supply can stand alone. Record payer/funder/protection/credit implications explicitly.
- [ ] Record acquisition partner distribution commitments, primary/backup support, recovery funding and the continuation/end plan.
- [ ] Admit only backed members, freeze the original cohort, review suitability recommendations, and publish one regular benefit per active included member/week.
- [ ] Recheck future coverage and readiness each week. Use prospective amendments for unreleased weeks, recovery for issued promises and outage controls for unusable destinations.

## Open enrollment last — founder and accountable operator

- [ ] Every required current-scope commissioning record is verified with owner, evidence and expiry.
- [ ] Requested access is ready; callback/job health is current; policy and privacy gates are approved; the real Market Cell is backed.
- [ ] Choose whether optional promotional delivery is enabled. Its evidence is required if that class is enabled.
- [ ] Enable application enrollment, then the public join destination, only for the agreed controlled pilot.
- [ ] Monitor queues, unknown outcomes, callbacks, job freshness, support age, store readiness, fallback and future-week coverage. Pause the relevant operation when its evidence is no longer current.

Follow [the real-enrollment runbook](REAL_ENROLLMENT_RUNBOOK.md) for the exact ordered commissioning procedure and flag names. Routine market operation is through product controls; deployment secrets, provider accounts and the first trust-root account remain deployment/provider-owner tasks.
