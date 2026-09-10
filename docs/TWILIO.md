# Uptick membership messaging and Twilio setup

Official provider documentation was checked on September 10, 2026. This file describes the implemented product and the external setup still required. No real SMS or registration submission was made during the build.

## The primary program is Uptick membership

The new program belongs to Uptick Local. A consumer asks for a secure access link, confirms possession of their phone and explicitly accepts the Uptick membership disclosure. That permission supports the recurring Uptick benefit. It does not enroll the person in every participating merchant’s marketing program. Old merchant subscribers are not automatically enrolled in membership.

Uptick membership has its own Messaging Service, sender, consent history, suppression records, outbox and signed callbacks. A membership sender cannot reuse a Messaging Service or number already assigned to a legacy merchant program. Merchant-specific direct campaigns remain separate and retain their original sender and consent records.

Register the actual business, opt-in journey, recurring program, sample messages and participating-merchant relationship accurately. Do not assume an old merchant campaign or a generic platform brand authorizes this new membership program. Confirm the appropriate brand/campaign and customer-versus-ISV structure with Twilio before launch. See [A2P 10DLC overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc) and [ISV onboarding](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv).

## What an operator can do in the app

Open **Operator → Market network → Member messaging** (`/operator/network/messaging`). This is a protected workspace across all Market Cells.

1. **Save the membership sender.** Enter its real `MG…` Messaging Service SID and US `+1…` number. Mark provider approval only after it exists. This checkbox records an operator attestation; it cannot register or approve a campaign.
2. **Inspect readiness.** The page shows the environment, actual sender record and every platform gate. Development transport is clearly marked as simulation with no SMS.
3. **Prepare the current week.** The app checks up to 100 verified, permissioned members in active markets. It creates a saved allocation and a message only when current approved supply remains available. It queues at most one weekly Uptick per member/calendar week. It does not send.
4. **Review the queue and copy.** The ledger shows the latest 80 membership messages with masked member references, environment, schedule, expiry and outcome. The complete access and weekly message templates are visible with private links redacted.
5. **Dispatch a bounded batch.** After the operator checks the review box, the app processes up to 20 queued messages. Each message is checked again for environment, current permission, sender suppression, current supply, expiry and quiet hours. Unknown outcomes are never retried by this control.
6. **Follow the outcome.** Provider accepted, sent and delivered are distinct. Only an authenticated delivery callback can record delivered. Development means nothing was sent. Failed, undelivered, suppressed and unknown remain visible.

The scheduled `/api/cron` worker also prepares membership weeks and dispatches eligible messages. It requires the configured cron bearer secret. Repeated preparation is idempotent; members temporarily waiting for supply have bounded deferred preparation records so later eligible members can proceed. A saved allocation does not reserve inventory.

For an individual support question, use **Members & cohorts → Protected member support**. An exact normalized phone lookup is operator-only, limited and audited. It can find a signup before the first claim. Results show masked identity, consent, source, allocations, claims, redemption evidence and delivery outcomes without private credentials.

## Exact staging setup

1. Provision a separate managed PostgreSQL database and Supabase Auth project. Apply all forward migrations. Create the actual operator Auth user and bootstrap its live operator membership. Hosted staging does not permit anonymous local preview identities.
2. Set `UPTICK_ENV=staging`, `UPTICK_LOCAL_MODE=false`, a canonical HTTPS `APP_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, independent `PASS_ENCRYPTION_KEY` and `SESSION_SECRET`, and `CRON_SECRET`.
3. Configure the real legal business name and support email. Finish the actual policy review and provider registration. Supply real business information, public privacy/terms/SMS URLs and accurate opt-in screenshots. See [Required business information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info).
4. For a no-send staging rehearsal, use `SMS_TRANSPORT=development`. For actual internal carrier testing, use `SMS_TRANSPORT=twilio`, the actual `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`, `MESSAGING_APPROVED=true`, `LEGAL_APPROVED=true`, and `INTERNAL_TEST_NUMBERS` containing only authorized internal E.164 recipients. An empty or malformed list disables real staging delivery. Development never sends real SMS.
5. Configure the dedicated membership Messaging Service and approved sender through the operator page. Configure Advanced Opt-Out and the actual program/help response in Twilio. Set its inbound webhook to `https://YOUR-CANONICAL-HOST/api/member-twilio/inbound`, HTTP POST.
6. The application supplies the exact per-message status URL: `https://YOUR-CANONICAL-HOST/api/member-twilio/status?message={internalMessageId}`. Preserve the canonical hostname and query. The SDK verifies the complete URL, parameters, account SID and signature.
7. Optionally set `STAGING_TEST_USER_IDS` to approved operator Auth user IDs for protected staging personas. This does not grant access without actual sign-in and a live operator membership.
8. Run the real internal join → access text → explicit consent → available Uptick → claim → destination verification → redemption loop. Inspect the saved consent and evidence. Test STOP, START, HELP, duplicate/out-of-order callbacks, invalid signatures, an off-allowlist recipient, unavailable inventory and uncertain provider outcomes.

Production requires its own real database/auth configuration, `UPTICK_ENV=production`, `SMS_TRANSPORT=twilio` and `PRODUCTION_DELIVERY_ENABLED=true`, in addition to all approval, sender and platform gates. Do not point preview deployments at production customer data. The explicit production switch cannot be used in a Vercel preview environment.

## Consent, suppression and delivery behavior

- A GET, link preview, allocation or redemption does not create membership permission. The member must confirm a private access request and explicitly choose the membership program.
- Requested access is a bounded service request. Weekly Upticks require current verified membership consent and an active market with available approved Drop supply. One weekly message does not become a per-merchant weekly allowance.
- Recurring messages are deferred during the app’s 8 PM–9 AM quiet period in the saved market timezone. This is a product send window, not a claim about every recipient’s jurisdiction.
- STOP pauses Uptick membership, records withdrawal and suppresses queued membership messages. Sender suppression also blocks requested-access delivery from that sender. The app never switches senders to evade an opt-out.
- START clears the affected sender/carrier suppression. It does not silently restore membership; a new explicit web choice is required. HELP and keyword replies are managed through Advanced Opt-Out to avoid duplicate replies. See [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).
- Each message retains its original member, access, allocation, sender, environment and weekly context. Replacing the active sender does not rewrite queued records. Plan a sender migration and reconcile outstanding requests before changing services.
- A provider timeout leaves the outcome unknown. The app does not guess that it failed and send again. Reconcile it against the provider record. Callback events are immutable, deduplicated and monotonic. See [Webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security) and [Message status](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

## Existing merchant programs

Legacy customer passes and merchant-specific consent continue working. Their provider identity is “{merchant} via Uptick”; separate sender records preserve merchant STOP routing. They use `/api/twilio/inbound` and `/api/twilio/status?message={internalMessageId}`. The isolated old-program rehearsal ledger uses its own `/api/twilio-test` callback. None is a replacement for the new membership callbacks.

Do not enroll old merchant subscribers in Uptick membership or broadcast across merchant lists. Membership access and allocation are the new primary product, while existing issued promises and opt-outs remain intact.

## External work not completed by code

Real business/campaign approval, legal review, sender provisioning, carrier delivery, physical Tap installation and NFC hardware provisioning require the corresponding external evidence. The local sample workspace establishes none of them. Before a public pilot, verify the actual locations and signs, train staff, use the approved internal recipients, inspect Twilio delivery records and complete the operating checklist.
