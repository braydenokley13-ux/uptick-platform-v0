# Uptick cloud demo: live, verified, and separate from real enrollment

**September 15, 2026. Accountable integrator: GPT-6.**

## Open it

1. Open **https://pilot.upticklocal.com**.
2. Select **Open demo**. If prompted, paste the founder key from the private `private/cloud-demo/FOUNDER_ACCESS.md` file on this laptop.
3. Use the six-step guide in the same browser. Return to Demo Studio is at the top of each screen.
4. Open **Reset or finish this demo** to reset the fictional activity or end the session.

No terminal or SQL is needed for the cloud rehearsal. The laptop launcher remains available separately. The physical Supabase project is shared per the founder's revised instruction; demo tables, credentials, and access are isolated.

## Verified hosted journey

The real application at the pilot domain completed:

- Fictional member entry with optional promotional consent left unchecked.
- Simulated private access link. UI explicitly reported no text sent.
- Backed weekly coffee benefit and saved claim.
- Pass preparation and the exact staff QR destination.
- Original digital redemption, recorded September 15 at 3:27:12 PM Eastern.
- Merchant results: 1 issued placement, 1 claim, 1 recorded redemption. Operator overview: 1 admitted member, 1 member with digital use.
- Sample stockout before physical handoff, preserving the original digital evidence.
- Backed sealed-water recovery using separate fallback stock.
- Recovery redemption at the same staff QR, recorded at 3:30:18 PM Eastern.
- UI and database totals: **1 / 1 / 1 / 1 / 1** (claim, original redemption, incident, recovery, recovery redemption).
- Browser reset returned every activity total to **0**. Visiting the pre-reset private pass displayed **“This private link isn’t valid.”**

Screenshots are in `docs/demo/screenshots/cloud-refresh/`. The offline guide is `output/pdf/uptick-cloud-demo-guide.pdf`. These are sample evidence, not traction or proof of purchase/physical fulfillment.

## Source, build, and tests

- Repository/branch: `braydenokley13-ux/uptick-platform-v0`, `codex/real-enrollment-ready`.
- Main remains `81ad63e0922e4a1fb3bf2c4d51bbf001d458f51b`.
- Visual foundation: `8d1f970c71e6904528b3822893e4e01dbfcb819d`; [CI 35012202208](https://github.com/braydenokley13-ux/uptick-platform-v0/actions/runs/35012202208) passed.
- Guided demo and task workspaces: `e670b6e4c36c2029e4e1fb217ded6033bf8f29c9`; [CI 35013090123](https://github.com/braydenokley13-ux/uptick-platform-v0/actions/runs/35013090123) passed. Full hosted journey above used this version.
- Vercel project: `uptick-cloud-demo`, `prj_OaNjYj6hnSFqyy7iiT7d8lOGTUgF`. Deployment `dpl_EqpnC2F9RvoL6ctCSZjHdB666hB5` reached READY for the guided version. Final presentation release `fc54a5bf557a58d670898d6b4e1cc629b3a5cfc2` is READY as `dpl_8qFXFFRLcNSx2zqFZeeRxEHqKMh2`; [CI 35014771313](https://github.com/braydenokley13-ux/uptick-platform-v0/actions/runs/35014771313) passed. Fresh entry, claim, compact pass, reset to zero and session release were verified on that deployment. See `release-receipt.json` and `artifact-manifest.json`.
- Local unit/domain tests: **299 passed, 0 failed**. TypeScript, lint and whitespace checks passed.
- Dedicated real-PostgreSQL isolation verifier passed: restricted public/auth access, lease isolation, shared persistence, full recovery journey, reset rotation, failed-reset rollback, normal-schema sentinel unchanged.
- CI additionally checks PostgreSQL upgrade/concurrency, backup/restore, HTTP/browser behavior and production build.

## Hosted isolation evidence

- Existing Supabase project `dmirmwzubafuzoxcporr` is reused. No new project was purchased.
- Private demo migrations: 001–034. Normal application migrations: 001–021, unchanged.
- Runtime role: `uptick_cloud_demo_runtime`; no grants on normal application/auth tables, no superuser/RLS bypass/role creation/database creation; private tables have RLS.
- The confirmed transaction pooler works with this restricted role. Direct normal-table access was denied with PostgreSQL 42501.
- No Twilio credentials exist in the demo deployment. Access SMS, promotional SMS, production delivery and real enrollment flags are disabled.
- Final readback after reset: **0 normal members**, **0 sample activity counts**, **0 provider-associated sample messages**, **0 normal table grants** for the demo role.
- Protected normal-data fingerprint across **95 tables** was identical before and after the hosted journey/reset: `f9b5d642fe1708d49bbab165c461282d`.
- That fingerprint excludes `scheduled_job_runs`, `scheduled_job_leases`, and `rate_limits`, because the retained normal deployment's scheduled jobs legitimately update them. It is not a claim that every normal row is unchanged.

The pilot domain now serves the demo project. The earlier hostname/domain blockers are resolved. The original normal Vercel project and deployment remain available for rollback; its default build configuration was restored.

## Six separate readiness decisions

| State                                  | Verdict    | Exact basis / remaining gate                                                                                                                                                                                                                                                 |
| -------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DEMO READINESS**                     | **GREEN**  | Hosted full journey and reset above; isolated runtime role; normal-data fingerprint unchanged; laptop launcher and offline fallback available.                                                                                                                               |
| **SOFTWARE REAL-ENROLLMENT READINESS** | **GREEN**  | Implemented candidate has 299 passing tests plus successful CI, PostgreSQL concurrency/upgrade, restore and HTTP/browser checks. See `REAL_ENROLLMENT_RELEASE_TRUTH.md` for the software blocker inventory. Bounded to controlled four-week enrollment after external gates. |
| **TWILIO / MESSAGING READINESS**       | **YELLOW** | Software and evidence package exist; provider registration/approval, sender association and actual handset delivery remain unproved. No real SMS was sent by this demo.                                                                                                      |
| **HOSTED COMMISSIONING**               | **RED**    | Demo hosting works. Normal enrollment still needs migrations 022–034 and positive hosted auth/MFA/recovery/callback/support/restore evidence on its release.                                                                                                                 |
| **MARKET-CELL READINESS**              | **RED**    | No real supply, fallback, distribution, trained staff, or support commitments are established by sample data.                                                                                                                                                                |
| **REAL ENROLLMENT**                    | **RED**    | Disabled. Provider, legal/business, hosted commissioning and actual market-cell gates must be satisfied first.                                                                                                                                                               |

## Exact next actions for real enrollment

1. Review the prepared messaging/consent/policy evidence, submit the correct Twilio/A2P registration and associate approved senders. Prove signed callbacks and handset delivery with explicitly authorized recipients.
2. Commission a normal deployment using the existing release/upgrade runbook: reviewed migration baseline, forward migrations, hosted operator/member/merchant login, MFA, recovery, support and backup/restore evidence. Do not turn the isolated demo project into the normal runtime by changing a flag.
3. Record actual four-week capacity and fallback funding, destination/staff readiness, distribution and support coverage in the operator setup screens.
4. Review the separate readiness gates. Only then explicitly enable controlled real enrollment.
