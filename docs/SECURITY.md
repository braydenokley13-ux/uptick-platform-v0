# Security and integrity of the pilot loop

## Customer passes

1. A customer requests a pass from an active source for a live offer. US phone input is normalized before lookup.
2. One customer can receive one entitlement per offer. The offer row is locked while checking inventory and creating the entitlement. The database also enforces that uniqueness.
3. A private link contains 32 random bytes encoded as a 43-character token. The database looks it up by SHA-256 hash. The recoverable copy used for the requested SMS is encrypted with AES-256-GCM. IDs and phone numbers cannot open a pass.
4. A GET or a link preview does not confirm phone possession. An explicit pass action does. The original offer, location, dates, quantity rule, source, and creative context remain attached to the pass.
5. Redemption locks the same offer row, checks the original entitlement, changes its state, and creates the redemption and audit event in one transaction. Repeating the action returns the completed redemption. An exhausted redemption cap rejects competing passes.

Pausing an offer or revoking a source prevents further acquisition; already issued passes retain their original terms. Invalidated, expired, and not-yet-active passes cannot redeem. Expiration is exclusive: a pass is expired at its exact expiration instant. Pass links are bearer credentials, so someone who receives a forwarded link can use it. They must not be placed in analytics events, logs, or public exports.

## Consent and sending

The first claim records the actual disclosure text, disclosure version, phone, scope, UI, and choice. Its optional merchant/network choices are also bound immutably to that exact pass. A public retry cannot change those choices or restore an unsubscribed scope; it records only the renewed fulfillment request. Promotion begins as pending. The private pass visibly presents its requested marketing choices, and only an explicit choice there or in private preferences activates marketing. Reading, opening without opting in, or redeeming a pass establishes no marketing permission. Pending choices from another claim are never silently activated. An unchecked choice while opening a pass can decline pending intent but cannot revoke an already confirmed subscription; the preference page provides that explicit control. Historical passes without saved claim choices default to no requested marketing.

STOP records sender suppression, unsubscribes that sender's merchant scope and the network scope, records consent evidence, and suppresses queued messages for that sender. It does not opt the customer out of other merchants' separate senders. An inbound provider ID is processed once. START removes sender suppression but does not restore marketing subscriptions. An explicit later opt-in is still required.

Before a promotional submission, the worker checks current merchant permission, confirmed possession, sender suppression, claim ownership/state/dates, active offer/broadcast, business time zone, and local weekly frequency. Quiet hours are before 9 AM and from 8 PM onward. Weekly boundaries use Monday in the business time zone. Deferred jobs do not stop the worker from checking later jobs. Concurrent workers serialize frequency decisions for the customer. The provider check is repeated immediately before submission; an opt-out cannot retract a request already submitted to the SMS provider.

Real Twilio submission requires the configured transport, messaging/legal approval environment gates, an approved business sender with a Messaging Service SID, credentials, and an HTTPS application URL. Sample entitlements are never sent through Twilio. Local transport records `development`, never `delivered`, and creates no fabricated provider callback.

Outside explicit local mode, offer approval and new public claims also require configured PostgreSQL/Supabase, independent encryption/session secrets of at least 32 characters, a canonical HTTPS origin, the reviewed business identity/support email, a scheduler secret, and an approved real merchant sender. A rejected public claim rolls back before saving a customer or entitlement. These checks inspect configuration and saved approval; they do not independently prove provider registration, legal review, DNS, or callback operation. Manual claim/pass/staff evidence remains a launch checklist so an approved offer can first be tested with controlled internal numbers.

The submission request disables provider auto-retry. A network failure or interrupted worker becomes `unknown` for operator review, not an automatic resend. An explicit provider rejection becomes `failed`. Signed, account-checked callbacks record immutable events and only advance the message's status. A duplicate callback cannot overwrite an earlier error, and a late failure cannot erase delivery evidence. The callback handler also rejects rebinding a job to another provider message ID.

## Business access and data history

Sessions are signed, HTTP-only cookies with a 55-minute expiration. Production sessions additionally validate the Supabase access token. Roles and organization memberships are read from the database on each authenticated request; they are not trusted from a client-supplied role. Merchant operations check organization ownership, and only operators approve, schedule, pause, or edit Anchors.

All operating tables use row-level security with no browser policies. Deploy with a dedicated backend database role; do not expose that credential to the browser. Composite foreign keys also prevent claims, locations, senders, messages, and redemptions from being assembled across the wrong business.

Offer versions, versioned product metadata, consent, claim-specific requested choices, redemptions, audit, inbound events, and provider events are immutable. Issued entitlement context and source attribution cannot be rewritten. Source revocation remains possible. New creative attribution uses a new source. First pass opening and a completed redemption cannot be reset.

Approval saves the exact reviewed offer version and operator in immutable review history in the same transaction as the publication/schedule. A QR whose saved creative belongs to an older offer version cannot create a new claim against changed terms. Already issued private passes keep their original snapshot.

The one-time `scripts/bootstrap-operator.ts` command requires an administrator `DATABASE_URL`, an actual existing UUID from that database’s Supabase `auth.users`, and an operating organization name. A transaction lock serializes concurrent bootstrap attempts. It creates the first membership and audit record only; normal Supabase sign-in remains required. Later access assignments require a live operator session.

Local sign-in and the development encryption/signing fallback require `UPTICK_LOCAL_MODE=true`, a loopback `APP_URL`, and absence of the Vercel runtime flag. Production must provide unique, randomly generated `SESSION_SECRET` and `PASS_ENCRYPTION_KEY` values. Changing the encryption key without a migration would make saved pass credentials unreadable for SMS recovery.

## HTTP boundaries and request abuse

Browser mutations require the configured application origin and JSON. Request streams are limited by their actual bytes, even when Content-Length is missing or understated. Twilio form bodies are bounded before signature processing. API responses show approved human-facing validation messages; unexpected database/provider details are not serialized. Sensitive exports disable caching, require explicit `can_export` membership, stay within that membership’s organization, and record an audit event. Ordinary operator support results show phone suffixes and never return private pass credentials.

Normalized phone claims are limited to six attempts per hour; sign-in emails to ten attempts per hour. Private-pass changes and authenticated account changes also have bounded request buckets. Per-IP limits are used only when `TRUST_PROXY_IP_HEADERS=true` and `x-real-ip` is a valid address. Enable that flag only behind a verified reverse proxy that overwrites the header. Otherwise anonymous production traffic shares a broad aggregate cap of 6,000 claim/login attempts per action per hour, while phone/email limits remain active. A missing address must not accidentally give every visitor one person’s 30-attempt allowance. Configure upstream bot, volume, and spend controls before public distribution; application counters do not provide complete bot protection.

## Verification and remaining deployment work

Run the database integration suite with:

```sh
npm run test
npm run test:e2e
```

The unit/integration suite runs all migrations against an in-memory PostgreSQL-compatible PGlite database and tests actual domain queries, transaction rollback, simultaneous claim/redemption attempts, quantity limits, private token lookup, tenant constraints, immutable history, consent/STOP, weekly scheduling, audience expansion, send eligibility, callback replay/order, deferred queues, uncertain delivery handling, local-mode boundaries, readiness gates, and HTTP parsing/error redaction. The Playwright request suite checks the actual Next HTTP endpoints for origin, body-size, authentication and callback-signature rejection.

PGlite serializes its database connections. These tests exercise concurrent application calls and the database invariants, but they do not prove behavior across independent PostgreSQL sessions. Before a live pilot, run the same race scenarios against the deployed PostgreSQL service, exercise valid and invalid Twilio webhook signatures over the public callback URL, and verify a real approved sender's STOP/START and delivery callbacks with controlled internal numbers. This build does not claim those external checks have happened.

Production also needs applied migrations, reviewed legal/disclosure copy, live provider/account configuration, backups and restore verification, and an operational retention/access policy for phone and consent records. Provider readiness gates stay closed until configured. Do not treat local sample activity as production merchant results.
