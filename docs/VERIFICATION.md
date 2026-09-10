# Verification record — September 10, 2026

The application was built and exercised locally. Sample business names and addresses are illustrative. No Twilio message was sent, no Supabase project was connected, and no public deployment was created during this build.

## Automated checks

- `npm test`: 57 passing unit and database integration tests. These include the complete acquisition → explicit consent → scheduled Drop → recorded return loop, tenant boundaries, immutable promises, suppression, callback replay, approval races, consent scope isolation, and separate internal tests.
- `npm run typecheck` and `npm run lint`: passed.
- `npm run build`: passed with Next.js 16.3.4 and webpack, using the committed build command.
- `npm run test:e2e`: four passing HTTP integration checks against the built Next server. These verify rejected origins, body limits, protected exports/operator actions, and unsigned scheduler/provider requests. They do not substitute for browser interaction testing.
- `bash scripts/verify-postgres.sh`: passed against a disposable PostgreSQL 16 cluster with four independent sessions. See [POSTGRES_VERIFICATION.md](POSTGRES_VERIFICATION.md) for the actual race checks and isolation safeguards.

The real PostgreSQL check exposed double serialization of JSON snapshots, which could bypass quantity rules. Native object parameters and migration 008 corrected it. Both database paths now have object-shape constraints and regression coverage.

## Browser interaction checks

The Codex in-app browser exercised the application through its actual UI. Responsive checks included a 390 × 844 phone viewport and desktop views.

1. Customer claim: entered a fictional US number, saved a durable pass, opened it, confirmed redemption with the cashier step, and verified the redeemed state survived reload.
2. Optional marketing: the default claim did not require either subscription. A second claim requested both scopes; its private pass visibly presented those choices. Merchant consent was turned off there while network consent remained selected. The merchant-only post-redemption signup then joined that merchant without altering the network choice. The saved preference page showed the resulting states.
3. Merchant handoff: restored the breakfast draft, added retail value, estimated cost, required purchase, and cashier instructions, then submitted it. The operator saw the saved values and offer version 2, reviewed the final SMS, and approved the September 17 schedule. Merchant home and history reflected the schedule.
4. Customer support: an operator found the correct merchant-scoped journey using the short `UP-` code displayed on the pass. The result masked the phone number and did not expose a private pass credential.
5. Internal testing: selected the saved Weekly Drop, entered an allowlisted fictional number, created a development test pass, explicitly opened it, and confirmed a test redemption. The internal ledger showed development/no SMS. Production source counts remained at the two customer test claims and redemptions; no recorded return was added by the internal rehearsal.
6. Creative handoff: saved the first creative for the car-wash source. The system marked the placement intended pending a fresh external handoff, kept the saved offer version, and rendered the exported SVG at its actual 1920 × 1080 dimensions with a source QR. No physical installation was asserted.
7. Navigation and phone layout: Growth Plan, Audience, Calendar, Results, Activity, Loop, Offer Studio, Network, and the operator business/offer/review/message/audit/onboarding/creative/settings/placement surfaces loaded without page errors or horizontal page overflow at 390 pixels. Wide tables scroll within their own containers.

The mobile customer claim action was visible within the tested 844-pixel height with optional subscriptions collapsed. The test pass, merchant home/network/Studio, and operator screens were visually inspected. Browser testing also prompted fixes for mobile sample labeling, calendar-week planning copy, and singular labels.

## Boundaries of this evidence

Production-format local builds still used explicit local identities, illustrative businesses, and development messaging. Live Supabase sign-in/JWT/RLS behavior, registered A2P traffic, carrier callbacks, DNS, production hosting, backups, upstream private-link log redaction, and external screen installation require configuration and staging verification in the owner's accounts.

The PostgreSQL test server deliberately disabled disk flushing for speed; it verifies concurrency and SQL/driver behavior, not crash durability. Provider tests used injected stubs and signed request fixtures, never invented delivery results. Internal test passes are isolated from production consent and therefore do not replace staging verification of the actual marketing-consent loop.
