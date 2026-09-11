# Uptick membership messaging and hosted pilot access

The primary recurring SMS relationship is **Uptick Local → Uptick member**. A store fulfills a perk. It does not gain that member's independent marketing consent or phone list.

## 1. Choose the environment explicitly

Set `UPTICK_ENV` to exactly one of these values:

| Environment                               | Transport     | Actual delivery                                                                                           |
| ----------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `development`                             | `development` | Simulated ledger entry; no provider call.                                                                 |
| `development`                             | `twilio`      | Blocked.                                                                                                  |
| `staging`                                 | `development` | Simulated ledger entry; hosted sign-in still required for workspaces.                                     |
| `staging`                                 | `twilio`      | Only exact E.164 numbers in `INTERNAL_TEST_NUMBERS`, with sender and platform readiness checks.           |
| `production`                              | `twilio`      | Requires `PRODUCTION_DELIVERY_ENABLED=true`, approved Uptick sender, and all production readiness checks. |
| Missing, mistyped, or incompatible values | Any           | Blocked on hosted environments.                                                                           |

A Vercel preview deployment cannot use `UPTICK_ENV=production`. Changing only `SMS_TRANSPORT` cannot turn development into a live sender. A malformed staging allowlist disables staging delivery. The same environment checks protect the retained merchant outbox and isolated internal tests.

The old explicit loopback-only `UPTICK_LOCAL_MODE=true` configuration remains a development compatibility fallback when `UPTICK_ENV` is absent. It never opens a hosted operator workspace.

## 2. Configure a dedicated membership sender

Use `configureMemberSender` through the protected operator workflow. The Messaging Service and sender phone must be separate from merchant programs. Approvals are human attestations after actual external registration; setting a checkbox does not register a campaign with Twilio.

Keep these concepts independent:

1. `member_access` records a requested private access link or a weekly Drop access credential.
2. `member_consents` records explicit recurring Uptick choices. A monotonic sequence determines the latest choice, including when two events share one transaction timestamp.
3. `member_suppressions` records the Uptick sender's carrier/provider suppression.
4. Legacy merchant subscriptions and suppression remain separate.

A requested access message is transactional fulfillment of that request. It does not require or create recurring membership consent. A credential generated for a weekly Drop cannot be sent using the requested-access purpose.

## 3. Prepare and dispatch

The membership domain creates the private access record. Then:

- `queueMemberAccess(db, accessId)` prepares one requested access message.
- `queueMemberDrop(db, { memberId, accessId, allocationId, weekKey, sendAt, expiresAt, timezone })` prepares one recurring Uptick per member and week. The optional time fields default to the current time and the access expiry.
- `dispatchMemberMessages(db, limit)` consumes queued messages. It rechecks environment, recipient allowlist, credential validity, sender approval, suppression and current membership consent. Weekly delivery also checks the saved allocation, approved usable supply, market state, week and quiet hours.

The outbox is separate from merchant messages. Foreign keys bind access and allocation to the same member. Immutable message context prevents changing the recipient, allocation, purpose, environment or sender after preparation.

Provider submission is durable before the network call. Interrupted or uncertain submissions become `unknown` and are never automatically retried. Development entries are labeled `development`; they are not marked sent or delivered. A provider's `delivered` result means carrier delivery, not that a person read the message.

## 4. Configure Twilio callbacks

For the dedicated membership service:

- Inbound callback: `https://YOUR_ORIGIN/api/member-twilio/inbound`
- Delivery status callback: the app supplies `https://YOUR_ORIGIN/api/member-twilio/status?message=MESSAGE_ID`

The server uses Twilio's SDK signature validation against the canonical HTTPS origin, exact path, query and form fields. It also checks `AccountSid`. Events are idempotent; delayed status events cannot downgrade a delivered message or change its provider identity.

Enable and configure Twilio Advanced Opt-Out for the real membership program:

- **STOP** suppresses the Uptick sender, pauses Uptick membership, appends a declined membership consent event, and suppresses queued membership messages. Merchant-specific consent does not change.
- **START** removes provider suppression only. The member must explicitly choose recurring membership again to resume it.
- **HELP** is recorded without creating consent. Configure the service's actual reviewed help response.

Official references: [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out), [Webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security), [Outbound status tracking](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status), [A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc).

Actual registration, reviewed program disclosures, approved sender configuration and carrier testing remain external work. No live membership delivery is claimed by the local tests.

## 5. Enter protected staging workspaces

1. Create the real pilot tester in Supabase Auth.
2. Give that exact user a live `operator` membership through the normal provisioning process.
3. Add that user's Auth ID to `STAGING_TEST_USER_IDS` on the staging deployment.
4. Sign in using the normal email/password form.
5. Open `/pilot` and choose Uptick operator or an available sample merchant.
6. Return to `/pilot` to switch to the second sample merchant and exercise tenant boundaries.

The server verifies the Supabase user before exposing a persona. Every later request rechecks tester access, the live operator membership and the selected organization's `is_demo` flag. The persona is an ordinary merchant actor scoped to that sample business; it cannot use operator actions or export permissions. Audit records retain the tester's real identity. Production has no persona switch.

Removing the tester allowlist entry, revoking their operator membership, or making the sample organization real immediately invalidates its persona on the next request. A hidden button is not an authorization boundary.

## Verification

`tests/member-messaging.test.ts` exercises explicit environment gates, malformed allowlists, requested access without recurring consent, purpose separation, one-message-per-week races, latest consent ordering, paused market/supply checks, last-moment allowlist removal, durable unknown provider outcomes, monotonic callbacks, STOP/START separation, dedicated sender ownership, immutable context, SDK webhook authentication, and protected sample persona scopes.

Provider calls in automated tests use an injected fake provider. These tests do not send SMS. A real hosted pilot still needs configured services and an allowlisted internal carrier test.
