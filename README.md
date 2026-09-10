# Uptick Growth

Uptick’s operating product for local acquisition and recorded return: a nearby placement → QR → requested private pass → redemption → optional Weekly Drop subscription → later Drop → recorded return.

The public `upticklocal` repository remains the marketing and film site. This application reuses its marine / warm-canvas palette, Geist type, and restrained Newsreader accents, without its media stack. The five supplied mockups are product direction; the wider scope is mapped in [docs/PRODUCT_MAP.md](docs/PRODUCT_MAP.md).

## Start locally, step by step

1. Install Node 22.13+ (Node 26.3.1 was used here) and ensure at least 2 GB of free disk space.
2. Run `npm ci` in this directory. This installs the versions recorded in `package-lock.json`.
3. Copy `.env.example` to `.env.local`. Keep `UPTICK_LOCAL_MODE=true`, `SMS_TRANSPORT=development`, and `APP_URL=http://localhost:3000`.
4. Run `npm run db:seed`. This creates a local PostgreSQL-compatible PGlite database in `.data/uptick`, applies migrations, and inserts the illustrative businesses and offers. It does not invent customers, claims, redemptions, or delivered messages.
5. Run `npm run dev -- --webpack`.
6. Open `http://localhost:3000`. Select **Merchant view** or **Operator view** under the clearly marked local development section.
7. Open `http://localhost:3000/c/pilot-carwash-2026` for the customer test. Use a fictional US number such as `(201) 555-0123`. No SMS is sent in development transport.
8. Claim the offer. Open the development pass. If you requested optional texts, confirm or turn off those choices on the private pass. Tap **Open my pass** (or **Open my pass & save choices**), then redeem with the test cashier confirmation.
9. On the redeemed pass, choose the optional Weekly Drop subscription. Open the merchant workspace to see the recorded activity.

Local identity shortcuts require explicit local mode, a loopback APP_URL, and no Vercel environment. Sample businesses are prevented from sending through Twilio. They are not production customers.

If the machine is short of disk space, `UPTICK_LOW_DISK=true` disables webpack disk caching. This trades rebuild speed for less temporary storage. It does not reduce the space needed to install dependencies.

## Main surfaces

- Customer: `/c/{publicSourceToken}`, `/p/{privatePassCredential}`, merchant-specific pass history and preferences, `/privacy`, `/terms`, `/sms`.
- Merchant: Home, current Anchor, Local Network, Weekly Drops, Offer Studio, Audience, Growth Plan, Results, next 30 days, and activity.
- Operator: Today inbox, businesses/locations, placement and QR management, source history, offer review/scheduling, messages, private support timelines, audit, onboarding, and screen creative.
- Artifacts: source QR SVG, versioned screen creative SVG, printable staff/pilot page, authorized merchant consent-evidence export.

All figures are read from saved records. Source visits include repeated browser page visits and are not screen impressions. A claim is a saved entitlement. A redemption is an atomic database record. Carrier delivery is not a read. Recorded returns are later Drop-linked redemptions after an initial recorded redemption, not all physical return visits.

## Database and authentication

Production uses PostgreSQL through `DATABASE_URL`; Supabase is the intended host and auth provider. PGlite is a local, single-process development transport for the same SQL schema, not a Vercel database.

1. Create a Supabase project in your account.
2. Set `DATABASE_URL` to its server-side Postgres/pooler connection. The postgres driver disables prepared statements for transaction pooling.
3. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` for server-side password sign-in.
4. Generate independent secrets with `openssl rand -hex 32`, then set `PASS_ENCRYPTION_KEY`, `SESSION_SECRET`, and `CRON_SECRET` in your secret manager. Do not put them in Git. Keep the pass encryption key backed up; replacing it invalidates the ability to send previously issued encrypted credentials.
5. Run `npm run db:migrate` with these environment variables loaded. Migration files are applied once in filename order and tracked in `schema_migrations`.
6. Create the first operator user in **Supabase → Authentication → Users** in that same project. Set the user’s actual UUID as `OPERATOR_AUTH_USER_ID`, and set `OPERATOR_ORGANIZATION_NAME` to the operating organization’s real name. Do not use a sample UUID. Keep `DATABASE_URL` set to an administrator connection for this one-time setup, then run `node --import tsx scripts/bootstrap-operator.ts`. The command checks that the UUID exists in `auth.users`, creates the operating organization and first operator membership in one transaction, and records an audit event. It refuses to create another first operator if one already exists. Rerunning it for the same operator makes no changes.
7. Replace the administrator connection with the intended server database role, then sign in through `/login` using that Supabase user’s normal credentials. The bootstrap command creates no password, session, or runtime bypass. Every operation rechecks the live membership; merchant scope is enforced server-side. Assign later existing-user access in the operator UI. Browser Supabase roles have no policies permitting direct table access. RLS is enabled on private tables.

A dedicated server DB role with only required privileges is recommended; keep it server-only. The application’s service connection must be able to access RLS-protected tables, while `anon` and `authenticated` must not receive backend privileges. See [docs/SECURITY.md](docs/SECURITY.md) for the actual guarantees and remaining live-service verification.

Local data is designed for one app process. Do not simultaneously open the same PGlite directory from a seed script, test script, and running server. Stop the server before rerunning migrations on that directory. Integration tests use a separate in-memory database.

## Configure the actual pilot

1. Enter the operator workspace and choose **Launch a merchant**.
2. Create Joe’s real business, category, timezone, and location. Do not reuse the illustrative seed as production data.
3. Add Main Street Car Wash, Quick Lube, and Ridge Tire as host businesses, with their actual locations/categories.
4. Use Offer Studio to create the Anchor: buy $25 of gas → free large coffee. Enter exact dates, terms, optional reward-cost estimates, and staff instructions. Submit it for review.
5. Create each host placement with its screen context and external reference. The operator chooses placement manually. Matching merchant/host categories are blocked as direct competitors; incomplete categories are visibly unassessed.
6. Generate a QR for each source. Generate and export the screen creative associated with that source. A creative revision gets a new source/QR; old sources and claims retain their original context.
7. Install or schedule the creative through your external screen system. Record the operator confirmation, time, and note in Uptick. This is not proof of playback or human impressions.
8. Complete the sender and policy setup below. Production approval and public claim creation require configured PostgreSQL, Supabase, independent encryption/session secrets, canonical HTTPS, approved Twilio transport/sender, reviewed legal identity/support contact, and a scheduler secret. The operator workspace shows these checks. Local mode keeps its explicit simulation path.
9. Brief the cashier, approve the Anchor for a controlled internal test, and complete the claim/pass/manual launch checklist before distributing the QR to customers. The manual notes record human verification; they do not prove carrier or screen-system success. After that test, draft a Weekly Drop, review the quality warnings and actual eligible audience, and approve its schedule.

Do not merge or publish the marketing site to deploy this app. The application uses one canonical `APP_URL` in V0 so customer links, callbacks, and mutation-origin checks agree. A single production origin such as `app.upticklocal.com` is the simplest first deployment. A separate claim domain needs an explicit allowed-origin/domain configuration before use.

## Rehearse without changing production results

1. Add only approved internal recipients to `INTERNAL_TEST_NUMBERS`, separated by commas, in the server environment. In local development, a fictional number such as `+12015550123` is suitable. An empty allowlist disables creation.
2. Restart the app after changing the environment. Run migrations 001–008 before production use.
3. Sign in as an operator and open **Internal testing**. Choose a saved merchant Anchor or Weekly Drop. Review its exact test message, enter an approved number, and confirm the tester requested it.
4. In development transport, choose **Create a local test pass**. In configured production transport, the action sends a real SMS only after merchant, sender, legal, platform, allowlist, and suppression checks pass. Sample businesses cannot send through Twilio.
5. Open the private test pass, deliberately open it, and confirm the test redemption. Every screen is labeled TEST; no purchase or free item is involved.
6. Read the internal ledger for the result. Development means no SMS. Provider acceptance is not delivery. Unknown outcomes are retained for investigation and never automatically resent.

Tests live in separate `internal_test_runs` and `internal_test_events` tables. They create no production customers, claims, redemptions, subscriptions, broadcasts, or merchant metrics. The signed test status endpoint is `/api/twilio-test`; the SDK includes its test identifier in the callback URL. Keep `/t/*` credentials private and redact those paths in upstream logs just like `/p/*`.

## Messaging and scheduling

See [docs/TWILIO.md](docs/TWILIO.md) for the registration decision and exact webhook setup.

- `SMS_TRANSPORT=development`: durable outbox records become `development`. They are never labeled sent or delivered. A private pass link is returned to the submitting browser only in explicit local mode.
- `SMS_TRANSPORT=twilio`: actual sends require Twilio credentials, `MESSAGING_APPROVED=true`, `LEGAL_APPROVED=true`, canonical HTTPS, and an approved per-merchant sender record. Sample businesses cannot send.
- `GET /api/cron` requires `Authorization: Bearer {CRON_SECRET}`. `vercel.json` requests a one-minute schedule; choose a Vercel plan supporting that interval or configure an equivalent authenticated scheduler.
- Each run expands due Drops and processes a bounded outbox batch. It checks consent, suppression, week, business quiet hours, and offer validity immediately before provider submission.
- A send with an uncertain provider outcome becomes `unknown`; it is not blindly retried. A crashed submission becomes unknown after five minutes. The operator inspects provider status before deciding on a manual recovery procedure.
- STOP blocks the sender internally and withdraws subscriptions for the affected merchant plus network scope. START clears sender suppression only, requiring a fresh merchant subscription choice.
- Quiet hours are our V0 scheduling choice of 9 AM–8 PM in the merchant timezone, not a blanket statement of legal sufficiency. Customer-timezone precision and jurisdiction review are production expansion considerations.

A public claim submission does not reveal an existing private pass in production. Repeated claims return the same entitlement internally and do not automatically resend indefinitely. If a customer lost their original SMS, support investigates the message record rather than issuing a second entitlement.

## Verification

```sh
npm run test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

The integration suite exercises the domain using PGlite, including the complete scheduled-return loop, production-readiness rollback, consent evidence, and request limits. `npm run test:e2e` runs HTTP boundary checks through the running Next application; it starts a local development server if one is not running. Stop the app before running seed/migration scripts against its local data directory. Set `PLAYWRIGHT_BASE_URL` only to a controlled test deployment to check that existing server instead. This suite checks rejected origins, JSON limits, unauthenticated access, and unsigned callbacks; it does not send messages or change customer data.

The separate `bash scripts/verify-postgres.sh` harness verifies the production adapter and races across independent PostgreSQL sessions in its own disposable local cluster. See [docs/POSTGRES_VERIFICATION.md](docs/POSTGRES_VERIFICATION.md). It never connects to an existing database.

These checks are not proof of Supabase JWT/RLS integration, live carrier delivery, or registered A2P traffic. The browser verification and precise limits of this build are recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Deployment gate

The repository is intended to be deployable once the environment is configured, but no real customer launch is implied by local tests. Before accepting production traffic:

1. Configure managed PostgreSQL, migrations, Supabase users/memberships, HTTPS, and server secrets.
2. Supply reviewed legal/business identity, support address, privacy/terms/SMS copy and retention policy. Set `LEGAL_APPROVED=true` only after review.
3. Complete Twilio registration for the correct business/ISV relationship, approve sender/campaign, configure callbacks and Advanced Opt-Out, and set messaging approval only when verified.
4. Verify webhooks and live PostgreSQL concurrency/tenant restrictions in staging. Configure upstream access-log redaction for `/p/*` and `/t/*` private credentials and disable third-party analytics on customer pages. Verify that the reverse proxy overwrites `x-real-ip` with the actual client address before setting `TRUST_PROXY_IP_HEADERS=true`; never trust a forwarded client-supplied value. Configure upstream traffic/SMS abuse controls as well. Without trusted IP information, the app uses a broad aggregate request limit and still limits normalized phones and login emails separately.
5. Use **Internal testing** to rehearse carrier delivery and cashier actions outside production metrics. Then verify the actual consent → scheduled Drop → recorded return loop in a controlled staging environment. Set up backups, error monitoring, missed-cron detection, and the unknown-send reconciliation procedure.
6. Complete the operator launch checklist and confirm actual screen handoff before publicly distributing a real Anchor QR. Approval is permitted for the controlled internal test once the machine-checkable production gates pass. The platform does not certify the manual checklist or make an external screen live.

The generated policy surfaces explicitly remain drafts until reviewed. The software does not register a legal business, approve a carrier campaign, provision DNS, or fabricate successful external connections.
