# Pilot data recovery and commissioning

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

1. Declare the incident and name an incident owner. Disable new admissions and promotional dispatch; keep the support owner reachable.
2. Preserve the current database, release SHA, job history and provider identifiers before attempting repair. Do not overwrite the only recoverable copy.
3. Determine the recovery point and the issued commitments after it. Export the exact affected grant, incident, recovery and provider IDs through protected operator tooling. Never use a broad public export.
4. Restore to an isolated destination first. Apply forward migrations for the selected release and compare schema, counts, grants, claims, consent, suppressions and event evidence. Replay migrations once to confirm idempotence.
5. Reconcile the interval after the backup with Twilio provider records and protected operational evidence. Unknown delivery is not a safe retry. Callbacks received during the outage may be retried by the provider, but do not assume that every event will reappear.
6. Restore the most current STOP/suppression information before any promotional send. When uncertain, remain suppressed. Do not let an older database recreate marketing consent.
7. For grants issued after the restore point, make a deliberate member-by-member reconciliation. An older database may not know a pass was redeemed. Do not automatically reissue inventory or rerun a weekly release from an old backup.
8. Preserve physical commitments already made at stores. Contact destinations and the affected members through authorized support channels. Record repaired commitments with an audit trail and an accountable payer.
9. Reconcile idempotency keys, message uncertainty, job leases, QR credential versions and recovery redemption evidence. Rotate compromised credentials; do not rotate merely because a database was restored.
10. Validate the canonical environment with internal testers. Resume admission and messaging independently only when their specific checks pass. Record actual recovery time and data loss, including anything not recoverable.

## Release sequence

1. Verify the implementation branch is committed, tests pass, migration replay passes, and the restore evidence is recorded.
2. Resolve the deployment approval recorded in the implementation report. Prepare the exact target, commit and gate values before asking to publish.
3. Apply forward migrations in order to the existing project using a transaction per migration, preserving `schema_migrations` filenames. Never rerun an old seed or rewrite migrations 001–013.
4. Verify legacy organization/location/offer counts are preserved and all new public tables keep RLS enabled with no permissive browser policies.
5. Deploy the reviewed commit to the canonical Vercel production alias with real enrollment and promotional delivery still disabled. Preview deployments cannot access the shared pilot database.
6. Verify hosted operator sign-in, MFA and revocation; member no-store/session behavior; protected APIs; staff QR; job authentication; signed provider callbacks; and internal-only delivery configuration. Do not send a real promotion merely to test deployment.
7. Publish the separate public-site copy alignment from its verified patch/bundle after public build verification. Resolve the legal identity/contact blockers before opening the pilot.
8. Complete the physical rehearsal and the business launch checks. Record a specific decision to open real enrollment. A2P submission and campaign launch remain separate founder/carrier work.
