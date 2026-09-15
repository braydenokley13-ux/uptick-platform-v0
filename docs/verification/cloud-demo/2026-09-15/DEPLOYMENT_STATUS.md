# Cloud demo deployment status — 2026-09-15

## Completed

- Platform branch pushed: `codex/real-enrollment-ready`.
- Cloud application commit: `01c7f169b34d434e295e0deb52ceed5b54690067`.
- Final verification/runbook commit: `07ef0cbb29f78a55f8cb0c1265dbf4cccad59085`. [Final CI 35000140768](https://github.com/braydenokley13-ux/uptick-platform-v0/actions/runs/35000140768) passed in 6m29s, including the new isolated cloud database rehearsal. Runtime application files match the cloud application commit above.
- GitHub CI: [34998979714](https://github.com/braydenokley13-ux/uptick-platform-v0/actions/runs/34998979714), **success**. Includes lint, TypeScript, unit tests, PostgreSQL verification, restore rehearsal, HTTP/browser tests, and build.
- Full local test rerun: **299 passed, 0 failed**. An earlier restricted run stopped with callback-test failures; those tests passed independently and the full rerun passed. The failed run is not used as release evidence.
- Dedicated cloud Vercel project: `prj_OaNjYj6hnSFqyy7iiT7d8lOGTUgF` (`uptick-cloud-demo`).
- Vercel build: `dpl_7KhBNEzRTjRBBgysJd75zXuwUHAX`, **READY**, from the exact application commit above.
- Noncanonical deployment URL returns HTTP **421**, verifying that the configured origin guard is active.
- Supabase migration `20260915170135_isolated_cloud_demo_schema` installed the private demo schemas in existing project `dmirmwzubafuzoxcporr`. No new Supabase project was created.
- Hosted readback: private migration ledger **34**, normal application ledger **21**; **1 sample member**, **0 normal members**.
- Hosted role audit: **0 normal application/auth table privileges**; superuser, RLS bypass, create-role, and create-database powers all false; **0 private tables with RLS disabled**.
- Disposable PostgreSQL proof in `database-proof.json`: real-data constraints, restricted-role denial, shared persistence, complete claim/redemption/failure/recovery-redemption journey, reset, old-lease invalidation, and failed-reset rollback all passed. The normal-schema sentinel remained unchanged.

## Still pending

1. Obtain the existing Supabase transaction-pooler hostname. The available project metadata exposes the direct host only; a local connection to that direct endpoint failed DNS resolution.
2. Update the dedicated runtime URL to the confirmed pooler host and verify connection as the restricted role.
3. Move `pilot.upticklocal.com` to the tested demo deployment, retaining the previous deployment for rollback.
4. Verify the entire journey and reset in the actual hosted browser, then update this file with that evidence.

**The pilot domain has not been moved. The cloud demo is not yet declared runnable or GREEN.**

The founder was asked for the non-secret pooler hostname, or specific approval for a preview-only diagnostic that writes only hostname and port to their Vercel build logs. Automatic approval review rejected that diagnostic without specific payload/destination approval. It was not executed and the normal deployment was not changed by it.

## Evidence limits

A whole-database fingerprint changed between readbacks while the normal deployment's scheduled jobs were active (`scheduled_job_runs` had 2,689 rows on the later check). Consequently, this report does **not** claim that every normal database row remained byte-for-byte unchanged during the elapsed interval. The directly verified isolation evidence is the restricted role's zero privileges, private-only installation, unchanged normal migration count, zero normal members, and the disposable cross-schema sentinel test.

This demo deliberately shares the physical Supabase project with the normal application, per the founder's explicit revised instruction. It uses private tables and independent credentials. The laptop demo still touches zero hosted data. Neither synthetic records nor a successful deployment are real-enrollment evidence.

## Readiness separation

| State                              | Status                                              | Evidence / remaining gate                                                                                                       |
| ---------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| DEMO READINESS                     | YELLOW for cloud; laptop evidence remains available | Hosted connection, domain switch, and actual browser journey pending.                                                           |
| SOFTWARE REAL-ENROLLMENT READINESS | Existing candidate evidence retained                | This change adds cloud-demo isolation; it does not commission normal hosted enrollment. See `REAL_ENROLLMENT_RELEASE_TRUTH.md`. |
| TWILIO / MESSAGING READINESS       | External gates remain closed                        | Cloud demo has no Twilio credentials and real sending disabled.                                                                 |
| HOSTED COMMISSIONING               | RED for normal enrollment; YELLOW for demo          | Build and private schema complete; runtime connection and hosted journey pending.                                               |
| MARKET-CELL READINESS              | RED for real enrollment                             | No real market-cell/member setup is created by the demo.                                                                        |
| REAL ENROLLMENT                    | RED                                                 | Real enrollment remains disabled; normal schema is still at migration 21.                                                       |
