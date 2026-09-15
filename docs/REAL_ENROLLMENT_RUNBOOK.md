# Real-enrollment software commissioning runbook

**Prepared:** September 15, 2026
**Status:** software procedure and local validation complete; hosted execution pending. See [current release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md) for the exact candidate and results.

This runbook orders the current software and external commissioning work. It does not authorize enrollment, real-recipient messaging, a Twilio submission, or a production change by itself.

## 1. Known starting point

The dated hosted migration record in `docs/verification/hosted-migrations.json` reports that the hosted application database had migrations `001_platform.sql` through `021_membership_function_search_paths.sql` applied on September 14, 2026. It also reports a private application-schema backup, row-preservation comparison, row-level security review, and no browser policies. Treat this file as evidence of that bounded event only.

The current candidate migration set ends at `034_callback_commissioning_scope.sql`. Therefore the planned hosted upgrade is:

- known hosted baseline: migrations 001–021;
- forward candidate: migrations 022–034; and
- current hosted state after that upgrade: unknown until it is backed up, migrated, compared, and recorded on the intended host.

Do not infer a deployed release SHA, successful build, passing final test suite, Twilio configuration, or carrier delivery from the migration record or this runbook.

## 2. Freeze the candidate

1. Choose the exact commit that will be commissioned and record its full SHA.
2. Confirm the repository migration list ends at `034_callback_commissioning_scope.sql` and contains no missing or renamed migration.
3. Complete the project's required review, build, and test commands for that exact commit. Record their actual outputs separately. The current local results are linked in the release truth; candidate CI and checks on the intended release remain required before commissioning.
4. Confirm the deployment uses the same commit SHA through `VERCEL_GIT_COMMIT_SHA`.
5. Keep these gates closed while preparing the host:
   - `PILOT_ENROLLMENT_ENABLED=false`
   - `PRODUCTION_DELIVERY_ENABLED=false`
   - `MEMBER_ACCESS_SMS_ENABLED=false`
   - `MEMBER_PROMOTIONAL_SMS_ENABLED=false`
   - public-site `NEXT_PUBLIC_UPTICK_PILOT_ENROLLMENT_OPEN=false`

## 3. Back up and upgrade the hosted database

1. Identify the intended hosted database and accountable operator. Do not paste credentials into evidence.
2. Capture a restorable backup that includes the application schema and record its provider reference, time, scope, and owner.
3. Capture the current `schema_migrations` rows and relevant schema/row fingerprints before changing the database.
4. Confirm the observed baseline matches the expected 001–021 record. Stop if migrations are missing, unexpected, renamed, or altered.
5. Apply only the forward migrations 022–034 with the repository migration command.
6. Confirm every migration appears exactly once in `schema_migrations` and the hosted schema matches the candidate.
7. Compare preserved legacy rows and the safety-sensitive state affected by the forward migrations, including program-wide STOP suppression, member/service history, privacy records, message records, and issued benefits.
8. Exercise the restore procedure or perform the approved restore rehearsal. Record what was restored and reconciled.
9. In **Pilot settings → Hosted commissioning evidence**, use **Record reviewed legacy baseline** only after a human compares every previously applied migration statement and the resulting hosted schema. This records checksums for legacy rows; it does not rerun them.

## 4. Deploy the closed candidate

1. Deploy the frozen commit to the canonical production origin with enrollment and all SMS class gates still off.
2. Configure the final HTTPS `APP_URL`. It must be the exact origin used in Twilio webhook signature validation.
3. Configure `UPTICK_ENV=production`, `SMS_TRANSPORT=twilio`, database access, encryption/session keys, Supabase settings, and the scheduled-job secret.
4. Keep `LEGAL_APPROVED=false` and `MESSAGING_APPROVED=false` until the named external owners have actually completed those reviews.
5. Complete the account-security procedure in `docs/HOSTED_ACCOUNT_COMMISSIONING.md`, including primary and backup operators, MFA, recovery, logout, session revocation, and tenant rejection.
6. Verify the public host, Privacy Policy, Terms, SMS page, join flow, and evidence URLs anonymously. The public SMS page must use the current requested-access, weekly, opt-in confirmation, and phone-correction samples before it becomes Campaign evidence.

## 5. Complete Twilio and public-policy actions

1. Finalize the legal entity, EIN evidence, address, representative, business-domain contact email, support email, and policy text.
2. Create or approve the Primary Customer Profile and register the truthful Direct Brand type.
3. Create the A2P Campaign from `docs/TWILIO_REAL_ENROLLMENT_PACKAGE.md`, including its four representative templates and public evidence URLs.
4. Create a dedicated Uptick Local membership Messaging Service, associate the approved Campaign, and add the dedicated US 10DLC number.
5. Configure Advanced Opt-Out keywords and the exact STOP, START, and HELP responses on that Messaging Service.
6. Configure the inbound webhook and preserve the full per-message status-callback URL, including its query string.
7. Record provider approval and sender association as external facts. Account creation, payment, Campaign submission, approval, sender purchase, sender association, and Console changes are outside this repository.

## 6. Configure the exact messaging scope

The software hashes these non-secret identifiers into the current messaging scope:

- deployed release SHA;
- Twilio Account SID;
- canonical application origin;
- Uptick environment; and
- active sender record, including internal sender ID, Messaging Service SID, and sending number.

Changing any value invalidates prior Messaging evidence and callback success for the new scope. Schema changes separately invalidate all saved commissioning checks through the migration fingerprint.

Before a controlled production carrier test:

1. Confirm the message queue has no unintended real recipients.
2. Keep public enrollment closed.
3. Set `MESSAGING_APPROVED=true` and `LEGAL_APPROVED=true` only from completed approvals.
4. Set `PRODUCTION_DELIVERY_ENABLED=true` for the controlled window.
5. Enable `MEMBER_ACCESS_SMS_ENABLED=true` to test requested access and requested phone-correction verification.
6. Leave `MEMBER_PROMOTIONAL_SMS_ENABLED=false` until the access class, STOP behavior, and support coverage have passed their recorded tests.
7. Enable `MEMBER_PROMOTIONAL_SMS_ENABLED=true` only for the authorized opt-in confirmation and weekly-message tests.

In staging, real delivery is additionally limited to valid E.164 numbers in `INTERNAL_TEST_NUMBERS`. Production has no equivalent allowlist, so queue review and closed enrollment are required controls during the production-scoped callback test.

## 7. Run the controlled carrier journeys

Use only numbers whose owners explicitly authorized the test. Record provider acceptance, callback state, and handset observation as separate facts.

1. Request access with promotional consent off. Verify the access message, signed status callback, handset receipt, one-use private link, and absence of promotional eligibility.
2. Repeat the web flow with an affirmative promotional choice. Verify the immutable consent record and one opt-in confirmation.
3. Prove decline, replay, refresh, repeated “on,” STOP, START, fresh re-opt-in, quiet hours, and weekly-slot behavior described in the Twilio package.
4. Run HELP and ordinary-text support journeys. Confirm one provider-managed keyword reply where configured, no duplicate application reply, and a monitored support item.
5. Run duplicate and out-of-order status callbacks and one controlled unknown-outcome reconciliation without blind retry.
6. Run the requested phone-correction journey:
   - create and verify the member-requested correction;
   - send the 15-minute challenge only to the proposed number;
   - reject expiry and replay;
   - apply the verified correction within 24 hours;
   - confirm old sessions, recovery codes, access links, and queued recipient context are revoked or suppressed;
   - confirm issued-benefit history remains intact; and
   - confirm promotional consent remains off until a fresh web opt-in.

## 8. Establish callback health

1. Process one authenticated inbound callback and one authenticated status callback on the exact production release, Twilio account, canonical origin, environment, Messaging Service, and sender.
2. Confirm both rows appear as current in **Pilot settings → Twilio and messaging**.
3. A successful callback remains current for less than seven days. Repeat both kinds before either expires.
4. Repeat both immediately after any release, Account SID, origin, environment, active sender, Messaging Service, or sending-number change.
5. Keep callback evidence free of message bodies, member phone numbers, private links, tokens, and secrets. The software stores only aggregate counts, timestamps, bounded failure codes, and the scope hash.

## 9. Record every commissioning check

In **Pilot settings → Hosted commissioning evidence**, record the actual result, accountable owner, evidence summary, limits, and future review date for:

- CI/build at the exact release;
- hosted schema comparison;
- operator authentication and MFA;
- backup operator and lost-factor recovery;
- merchant authentication and tenant boundaries;
- member recovery;
- account recovery and session revocation;
- backup restore and reconciliation;
- approved Brand, Campaign, Messaging Service, and sender association;
- requested-access provider acceptance, callback, and handset receipt;
- opt-in confirmation and weekly handset receipt when promotional delivery is enabled;
- STOP, START, HELP, and ordinary reply rehearsal; and
- primary and backup support coverage.

Software checks require the current release SHA and schema fingerprint. Messaging checks additionally require the current sender and messaging scope. An expired review date, changed release, changed schema, or changed messaging scope makes the saved item unverified.

## 10. Open enrollment last

1. Confirm both scheduled jobs are healthy in their current windows: preparation within 15 minutes and dispatch within 5 minutes.
2. Confirm requested-access messaging is ready, operator MFA enforcement is on, both scoped callback-health rows are current, and every required commissioning record is verified.
3. Confirm policy, support, supply, capacity, location, recovery, and privacy operations are ready for real members.
4. Choose whether promotional sending is enabled. If it is off, keep `MEMBER_PROMOTIONAL_SMS_ENABLED=false`; the promotion receipt check is not required by the software gate in that state. If it is on, its evidence must be current.
5. Only then set `PILOT_ENROLLMENT_ENABLED=true` for the application and separately open the public join destination.
6. Monitor callback age, job health, message failures/unknown outcomes, support backlog, supply, and incidents. Close the applicable class flag or global delivery/enrollment gate when evidence becomes stale or an incident requires a pause.

## Evidence boundary

The September 15 read-only refresh still shows hosted migrations 001–021. Local candidate build, test, migration, restore and demo results are recorded in [current release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md). No hosted 022–034 migration, candidate deployment, real sender, Brand or A2P approval, provider receipt, signed production callback, handset receipt or live enrollment is claimed.
