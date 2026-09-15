# Pilot data recovery and commissioning

## Release-status authority

This runbook explains how to rehearse and perform recovery. It does not declare the current candidate ready or prove that a hosted restore succeeded. Use [Real-enrollment release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md) for the candidate SHA, migration boundary, hosted evidence, open blockers and enrollment verdict.

Any earlier dated readiness statement, test count, screenshot, restore result or hosted check is stale for the current release verdict unless that truth record explicitly carries it forward.

## What the automated restore rehearsal proves

`bash scripts/rehearse-restore.sh` creates its own temporary local PostgreSQL cluster, disables TCP, enables fsync and synchronous commit, applies the numbered migrations, issues synthetic grants, exercises recovery, makes a custom-format logical dump, restores to another database, compares table fingerprints and replays migrations. It refuses application connection strings and real-project directories. It is a logical database restore test, not a test of Supabase's hosted backup entitlement or point-in-time recovery.

The guard requires 768 MB free before creating a cluster. Never lower that guard just to obtain a green result on a full disk.

## Hosted facts to record before launch

- Existing project: `dmirmwzubafuzoxcporr` (`uptick-staging`), reused by founder decision.
- Canonical service: `https://pilot.upticklocal.com`.
- Record backup plan, last successful restore point, retention, recovery window, restore operator and actual restore destination from the Supabase dashboard. These cannot be inferred from “healthy.”
- Record Vercel production release SHA and environment gate names. Never copy secret values into this repository or incident notes.
- Verify active operator MFA, a second recovery-capable owner and revoked-session behavior. Record the credential inventory in an appropriate secret manager.

## Outside the database

The database dump does not restore Vercel environment variables, the data-encryption/signing keys, Supabase JWT/auth provider configuration, Twilio credentials, sender/campaign approval, domain/DNS configuration, physical QR signs or merchant stock. Losing the encryption key can make encrypted access/support/message history unreadable even when rows restore successfully. Keep separately controlled backups and named owners for these dependencies.

## Incident procedure

1. Declare the incident and name an incident owner. In `/operator/pilot`, choose **Pause new operations** when the pilot must be paused. Disable new admissions and promotional dispatch independently; keep the support owner reachable.
2. Preserve the current database, release SHA, job history and provider identifiers before attempting repair. Do not overwrite the only recoverable copy.
3. Determine the recovery point and the issued commitments after it. Export the exact affected grant, incident, recovery and provider IDs through protected operator tooling. Never use a broad public export.
4. Restore to an isolated destination first. Apply forward migrations for the selected release and compare schema, counts, grants, claims, consent, suppressions and event evidence. Replay migrations once to confirm idempotence.
5. Reconcile the interval after the backup with Twilio provider records and protected operational evidence. Unknown delivery is not a safe retry. Callbacks received during the outage may be retried by the provider, but do not assume that every event will reappear.
6. Restore the most current STOP/suppression information before any promotional send. When uncertain, remain suppressed. Do not let an older database recreate marketing consent.
7. For grants issued after the restore point, make a deliberate member-by-member reconciliation. An older database may not know a pass was redeemed. Do not automatically reissue inventory or rerun a weekly release from an old backup.
8. Preserve physical commitments already made at stores. Contact destinations and the affected members through authorized support channels. In **Destination readiness, incidents and recovery**, record repaired commitments with an audit trail and an accountable payer.
9. Reconcile idempotency keys, message uncertainty, job leases, QR credential versions and recovery redemption evidence. Rotate compromised credentials; do not rotate merely because a database was restored.
10. Validate the canonical environment with internal testers. Resume admission and messaging independently only when their specific checks pass. Record actual recovery time and data loss, including anything not recoverable.

## Whole-location outage during recovery

1. In **Destination readiness, incidents and recovery**, use **Stop routing and open outage** for an unavailable location. Preserve the outage cause, time and owner.
2. Use **Open this member’s recovery incident** for each affected issued promise. Database recovery does not itself make a member whole.
3. If a remedy failed or expired, expand **Replace a failed or expired remedy**. Preserve the original recovery attempt, record failure/handoff evidence, and issue one independently backed replacement with a named payer.
4. Use **Close outage; keep routing paused** only after member incidents are accounted for. Closing an outage must leave routing paused.
5. Reconfirm exact stock, hours, staff briefing, QR operation and independent fallback. Save fresh readiness evidence before reactivating the destination or its supply.

## Reconciliation before resuming service

Compare restored state with protected exports, provider records and physical evidence. Record each difference and its resolution.

| Area               | Reconcile                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Release and schema | Candidate SHA, ordered migration filenames, migration checksums, schema fingerprint and legacy baseline                            |
| Pilot run          | Market Cell, classification, fixed admitted cohort, weekly coverage, launch state and capacity                                     |
| Supply             | Original commitments, append-only future-week amendments, readiness evidence, fallback and paid-program limits                     |
| Members            | Admissions, verified dispositions, access revocations, geography changes and resumptions                                           |
| Privacy            | Request type, identity verification, export/correction/deletion action, retention decision and erased identifiers                  |
| Promises           | Weekly releases, grants, claims, redemption evidence, incidents, recovery attempts, superseded remedies and whole-location outages |
| Messaging          | Consent records, STOP/suppressions, queued work, provider identifiers, callback history and uncertain/failed/undelivered outcomes  |
| Operations         | Job leases/idempotency, partner distribution outcomes, economic entries, reversals, credits, payer evidence and labor              |

Then complete these steps:

1. Open `/operator/pilot/settings`, headed **Know what is ready.** Review **Software and migration integrity**, **Twilio and messaging**, **Hosted commissioning evidence**, **Market-cell readiness** and **Real enrollment controls**.
2. Use **Record a reviewed legacy migration baseline** and **Save commissioning evidence** only for evidence actually observed for this candidate and environment.
3. Open `/operator/pilot`, headed **Today’s pilot work.** Review **NEEDS ACTION**, then open **Members & support**, **Destination readiness, incidents and recovery**, and **Check message delivery** until all recovery differences have an owner and disposition.
4. Keep admissions, promotional delivery and each affected destination paused until its own current evidence passes. Do not infer one gate from another.
5. Update [Real-enrollment release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md) with the observed recovery evidence and remaining blockers. Only its current verdict controls whether real enrollment may resume.

## Release sequence

1. Identify the exact candidate SHA and migration boundary in [Real-enrollment release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md). Verify the implementation branch is committed, required tests pass, migration replay passes, and current restore evidence is recorded; do not carry forward a prior candidate’s result without explicit validation.
2. Resolve the deployment approval recorded in the implementation report. Prepare the exact target, commit and gate values before asking to publish.
3. Apply forward migrations in order to the existing project using a transaction per migration, preserving `schema_migrations` filenames. Never rerun an old seed or rewrite migrations 001–013.
4. Verify legacy organization/location/offer counts are preserved and all new public tables keep RLS enabled with no permissive browser policies.
5. Deploy the reviewed commit to the canonical Vercel production alias with real enrollment and promotional delivery still disabled. Preview deployments cannot access the shared pilot database.
6. Verify hosted operator sign-in, MFA and revocation; member no-store/session behavior; protected APIs; staff QR; job authentication; signed provider callbacks; and internal-only delivery configuration. Do not send a real promotion merely to test deployment.
7. Publish the separate public-site copy alignment from its verified patch/bundle after public build verification. Resolve the legal identity/contact blockers before opening the pilot.
8. Complete the physical rehearsal and the business launch checks. Record a specific decision to open real enrollment. A2P submission and campaign launch remain separate founder/carrier work.
