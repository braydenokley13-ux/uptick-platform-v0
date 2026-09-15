> **Historical record.** This document describes an earlier implementation or review checkpoint. Use [current release truth](../REAL_ENROLLMENT_RELEASE_TRUTH.md) for this candidate’s fixes, evidence, verdicts and remaining gates. Earlier test counts, demo instructions and unresolved-gap statements are not current unless carried forward there.

# Messaging readiness review

**Reviewed:** September 15, 2026
**Scope:** Current local source for Re-foundation workstream 9: requested access, optional promotional consent, confirmation and STOP behavior, HELP/free-text support, provider callbacks, and real-service commissioning.
**Safety boundary:** This review used only source inspection and disposable in-memory databases. It made no hosted writes, provider calls, or SMS sends.

## Verdict

The local design preserves the central workstream 9 boundary: Uptick Local owns the recurring membership program, requested access is transactional, promotional messages require a separate current affirmative choice, and merchant subscriptions remain separate. STOP, HELP, free text, signed status callbacks, monotonic delivery evidence, environment gates, and uncertain-send handling are implemented.

The software is not ready to declare real messaging commissioned. Four concrete product gaps remain, and the real Twilio service has not supplied the external evidence needed to close commissioning.

## Behavior that is correctly implemented

| Requirement                                                 | Current evidence                                                                                                                                                                                                                                                                                | Result                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Requested access is separate from promotion                 | `queueMemberAccess` uses purpose `access`; `queueMemberDrop` uses purpose `drop`. Only the `drop` branch requires verified status and current promotional consent in `src/lib/member-messaging.ts:145-243`. Dispatch rechecks consent only for `drop` at `src/lib/member-messaging.ts:342-380`. | Pass                                   |
| A requested link does not manufacture consent               | The requested-access test dispatches without a `member_consents` or merchant `subscriptions` row in `tests/member-messaging.test.ts:183-203`.                                                                                                                                                   | Pass                                   |
| Initial private confirmation is single-use and append-only  | The initial confirmation records either `opt_in` or `declined` only after private confirmation at `src/lib/membership-identity.ts:296-335`. Access exchange locks the access row and rejects a consumed link at `src/lib/membership-identity.ts:367-397`.                                       | Pass                                   |
| STOP is idempotent and program-wide                         | Inbound provider IDs are inserted once at `src/lib/member-messaging.ts:631-643`. STOP updates sender and global suppressions, appends one consent event, and suppresses queued messages at `src/lib/member-messaging.ts:644-670`. START clears suppression without writing affirmative consent. | Pass                                   |
| Advanced Opt-Out does not get a duplicate application reply | `memberInbound` sets `shouldReply` false when `OptOutType` exists at `src/lib/member-messaging.ts:698-710`; the route emits empty TwiML at `src/app/api/member-twilio/[kind]/route.ts:33-38`. The new regression covers duplicate provider HELP and STOP.                                       | Pass in the current worktree           |
| HELP and free text are retained safely                      | HELP and ordinary text create an encrypted, immutable support request with membership/allocation context at `src/lib/member-messaging.ts:671-697`; duplicates are stopped by the inbound provider ID and support-request uniqueness.                                                            | Pass, subject to reply-copy gaps below |
| Status callbacks are authenticated and monotonic            | The callback verifies content type, exact canonical URL, complete query, account SID, and Twilio signature at `src/lib/member-messaging.ts:724-748`. States and provider identity are monotonic/idempotent at `src/lib/member-messaging.ts:532-592`.                                            | Pass locally                           |
| Provider uncertainty is preserved                           | Submission is marked before the network call; an uncertain failure becomes `unknown` and is not selected again at `src/lib/member-messaging.ts:389-516`.                                                                                                                                        | Pass                                   |

## Concrete software gaps

### 1. Requested access and promotional delivery share one activation switch

**Priority: P1 before production messaging activation**

`smsEnvironmentBlock` uses the single `PRODUCTION_DELIVERY_ENABLED` value for every message at `src/lib/environment.ts:46-63`. `memberMessageEligibility` calls that shared gate before branching on `message.purpose` at `src/lib/member-messaging.ts:287-342`.

This prevents a phased commissioning sequence in which requested secure-access delivery is enabled while recurring promotion remains administratively disabled. Consent and suppression checks still protect each promotional message, but there is no independent operational kill switch for that message class.

**Suggested change:** Add separate purpose-aware activation state for transactional access and recurring promotion. Recheck it immediately before provider submission, expose both states in the operator readiness screen, and leave recurring promotion closed until its Campaign, consent evidence, support, and callback rehearsal are complete.

### 2. A returning member can explicitly confirm the promotional checkbox, but the server discards that choice

**Priority: P2**

A fresh access request saves `consent_requested` at `src/lib/membership-identity.ts:198-213`. The private screen displays that choice and sends `acceptMarketing` at `src/components/member-controls.tsx:186-240`. The server records the choice only inside `firstVerification` at `src/lib/membership-identity.ts:300-326`; the returning-member branch at `src/lib/membership-identity.ts:336-348` records no consent.

The existing regression in `tests/membership-consent.test.ts:108-132` deliberately preserves the no-change backend behavior, but the current UI presents the control as effective. A returning member who selects the optional choice and confirms receives no saved opt-in.

**Suggested change:** Choose one truthful contract. Either hide the promotional confirmation control for verified returning members and direct them to preferences after access exchange, or record the explicit two-screen returning-member choice as a new append-only event. Keep a replay from adding another event.

### 3. HELP fallback points to a session-oriented page instead of the public SMS/help page

**Priority: P2**

`memberHelpReply` directs the sender to `/your-uptick` at `src/lib/member-messaging.ts:716-722`. The reviewed commissioning copy directs HELP to the public `/sms` program/help page in `docs/TWILIO_REAL_ENROLLMENT_PACKAGE.md:171-179`. An unknown sender or a member without a current browser session may not get useful help from `/your-uptick`.

**Suggested change:** Use the canonical public `/sms` URL and the tested support address in the application fallback. Keep the reply free of private account information.

The regression `the application HELP fallback sends people to the public SMS help page` currently fails with the `/your-uptick` response.

### 4. Ordinary support acknowledgement omits its STOP instruction

**Priority: P2**

The ordinary inbound acknowledgement at `src/lib/member-messaging.ts:703-710` ends after “A support person will review it.” The exact application-response copy in `docs/TWILIO_REAL_ENROLLMENT_PACKAGE.md:181-194` includes “Reply STOP to stop texts.”

**Suggested change:** Append the reviewed STOP sentence to the ordinary-text acknowledgement and keep duplicate provider deliveries reply-free.

The regression `an ordinary support acknowledgement includes the STOP instruction` currently fails on the shorter response.

### 5. Application readiness has no durable callback/support commissioning evidence

**Priority: P2 before enabling recurring promotion**

`memberMessagingReadiness` treats a simulated transport as ready, or otherwise combines platform configuration with the active sender's `approved` boolean at `src/lib/member-messaging.ts:111-129`. Sender approval is an operator checkbox at `src/app/operator/network/[[...section]]/page.tsx:1952-1960`. The operator messaging view reads message counts and recent outbox rows at `src/lib/network-operations.ts:1020-1050`, but it does not show last successful inbound/status callback, callback failures, an aged HELP queue, or the evidence from a controlled handset rehearsal.

Configuration is necessary, but it cannot prove that the deployed canonical callback URL, Advanced Opt-Out behavior, support coverage, and carrier delivery actually worked.

**Suggested change:** Persist a commissioning record containing environment, sender/service identity, reviewed source revision, controlled recipients, callback/keyword rehearsal timestamps and Message SIDs, primary/backup support ownership, reviewer, and expiry/revocation state. Gate recurring promotion on a current approved record and expose callback/support health without storing message bodies or private links in the commissioning record.

## Documentation drift

- `docs/MEMBERSHIP_MESSAGING.md:58` says STOP “pauses Uptick membership.” Current code and the reviewed real-enrollment package preserve membership and issued benefits while ending program texts. Update that sentence before using the document for training or provider review.
- The blocker table in `docs/TWILIO_REAL_ENROLLMENT_PACKAGE.md:46` still describes the old duplicate Advanced Opt-Out reply behavior. The current worktree has the `shouldReply` repair. Keep the blocker open only for deployment and real-service verification, not as an unresolved local implementation defect.

## Optional opt-in confirmation SMS

No separate promotional welcome/confirmation SMS exists. This is deliberate in the current package, not a software fault: `docs/TWILIO_REAL_ENROLLMENT_PACKAGE.md:139-147` says the web-only flow does not require an `opt_in_message` and reserves a template only if product/legal later commissions it.

If that decision changes, the current message schema supports only `access` and `drop` (`db/migrations/011_membership_messaging.sql:13-28`). A new confirmation purpose needs its own idempotency key, must be queued only for a newly committed affirmative consent event, must be blocked after STOP, must not be sent after decline/refresh/replay/START, and must not count as the weekly promotional Drop.

## Missing hosted evidence, separate from software defects

This local review cannot establish any of the following:

1. The legal entity, DBA/Brand, EIN match, Campaign type, Messaging Service, and sender are approved in the real Twilio account.
2. The public join, privacy, terms, SMS, and redacted two-screen evidence URLs match the submitted Campaign wording and return successfully without authentication.
3. Advanced Opt-Out is enabled with the reviewed STOP, START/UNSTOP, and HELP/INFO responses.
4. Signed inbound and status callbacks reach the canonical deployed URL and remain idempotent when Twilio retries or sends states out of order.
5. A controlled allowlisted handset receives requested access, can decline promotion, can opt in separately, receives no promotion after STOP, and reaches monitored support through HELP/free text.
6. Named primary and backup support owners monitor the queue during published coverage hours and reconcile aged HELP requests and `unknown` submissions.

These require the controlled staging commissioning sequence in `docs/TWILIO_REAL_ENROLLMENT_PACKAGE.md:295-325`. A green local suite, a READY deployment, or an operator approval checkbox is not substitute evidence.

## Local regression result

Command:

```sh
node --import tsx --test --test-concurrency=1 tests/messaging-readiness.test.ts
```

Current result: **1 pass, 2 expected failures**.

- Pass: provider-managed duplicate HELP and STOP are recorded once and receive no second application reply.
- Fail: HELP fallback uses `/your-uptick` instead of `/sms`.
- Fail: ordinary support acknowledgement omits “Reply STOP to stop texts.”

No SMS provider or network transport was invoked.
