# Uptick Local — hosted commissioning record

September 14, 2026. **The operating release is deployed for internal rehearsal. Real pilot enrollment and promotional delivery remain closed.** Both repositories' release pull requests are merged. The public website is also live after the user supplied specific publication approval.

## 1. What is on GitHub and live

| Service            | GitHub release                                                                                                                                                 | Hosted result                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operating platform | [PR #2](https://github.com/braydenokley13-ux/uptick-platform-v0/pull/2) merged; commissioning source `33dc34325307174137a4b2ea9f6399c0fb43b161` pushed to main | [pilot.upticklocal.com](https://pilot.upticklocal.com), Vercel deployment `dpl_X82XhAVUwV1Pgj3BDX3nLyi6LYLM`, READY; production branch `main`                                |
| Public website     | [PR #13](https://github.com/braydenokley13-ux/upticklocal/pull/13) merged; main `6e6f135a44c0ab63b89abecfd6f1d82272bfa253`                                     | Production branch is `main`; production deployment `dpl_55oBSR1wwNYxpN6DAtDrLtPgLr7T` is READY at upticklocal.com and www.upticklocal.com; all seven live-page checks passed |

The operating deployment uses the existing Supabase project `dmirmwzubafuzoxcporr` (`uptick-staging`). The application was verified at `605f147`; release source `33dc343` additionally includes the tested migration 021, backup verifier and evidence. Later documentation-only commits can trigger a new deployment without changing that application behavior.

## 2. What was protected before the database changed

1. Captured all **65 public tables and 31 rows** before migration 014. The capture preserved exact PostgreSQL JSON text so numeric formatting did not change during transport.
2. Restored that capture into a fresh, isolated PostgreSQL cluster using migrations 001–013. **All 65 table counts and fingerprints matched.** The local cluster used a private Unix socket and durable writes, then was removed.
3. Kept the capture private at `.data/commissioning/public-before-014.json`, with permissions `0600` and Git ignore protection. It is intentionally absent from GitHub.
4. Applied forward migrations **014–021**. Existing migration history was preserved. All **64 legacy non-ledger tables** retained their row counts and fingerprints; the migration ledger intentionally gained entries.

This proves a local logical restore of the captured public application data. It does not prove a Supabase provider restore point, PITR, Auth recovery or Storage recovery. Those remain launch checks. Evidence: [backup restore](verification/hosted-public-backup-restore.txt), [migration and preservation results](verification/hosted-migrations.json), [migration checksums](PILOT_RELEASE_CANDIDATE.md).

## 3. What was checked on the deployed service

| Check                            | Observed result                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public and protected HTTP routes | **12/12 GET checks passed.** Public pages loaded; member/operator pages redirected to access screens; private APIs and cron routes rejected anonymous callers    |
| Write boundaries                 | **5/5 POST checks passed.** Enrollment stayed closed; missing sessions, foreign origin and unsigned Twilio callbacks were rejected                               |
| Actual scheduled preparation     | `membership_prepare` succeeded at `2026-09-14T03:45:38Z`, with zero processed                                                                                    |
| Actual scheduled dispatch        | `membership_dispatch` succeeded at `2026-09-14T03:46:18Z`, with zero processed                                                                                   |
| Data created by commissioning    | Zero members, member messages, releases and grants                                                                                                               |
| Hosted schema protections        | All **97 public tables have RLS**; zero public browser policies; **zero function search-path warnings** after migration 021                                      |
| GitHub CI                        | Release branch, pull request and main passed; [main run for 33dc343](https://github.com/braydenokley13-ux/uptick-platform-v0/actions/runs/34803344290) succeeded |

Evidence: [GET checks](verification/hosted-get-smoke.json), [POST checks](verification/hosted-post-smoke.json), [actual jobs](verification/hosted-jobs.json), [deployment](verification/operating-deployment.json). These HTTP checks establish access boundaries; a successful hosted operator/member journey still needs authorized account access.

Earlier verification includes **176 passing domain tests**, **12 passing local production-build HTTP tests**, a concurrent **150-grant PostgreSQL release**, full local join/access/redemption/recovery journeys, optimized builds, lint and type checks. The real PostgreSQL harness also passed through migration 021. Full details are in the [implementation report](PILOT_IMPLEMENTATION_REPORT.md).

## 4. Current launch settings

The operating service uses `UPTICK_ENV=staging`, `UPTICK_LOCAL_MODE=false`, `SMS_TRANSPORT=development`, and `APP_URL=https://pilot.upticklocal.com`. Enrollment, production delivery, messaging approval and legal approval are explicitly false. The public website's enrollment flag is also explicitly false. No A2P submission or real promotional send was performed.

Existing sensitive/encrypted environment protections and scopes were preserved. Database and signing/encryption secrets were not rotated or printed. Operator MFA enforcement is currently false because the existing Auth user has no verified factor; factor enrollment and tested recovery must precede enforcement and real-pilot admission. Preview deployments are prevented by application code from connecting to the shared pilot database.

Evidence: [operating settings](verification/hosted-commissioning-gates.json), [public enrollment gate](verification/public-hosted-gate.json), [production branch](verification/operating-production-branch.json).

## 5. What remains before real participants join

1. **Finish hosted account rehearsal.** Use authorized internal operator/member accounts to verify successful sign-in, session revocation, member return, staff QR redemption and signed callbacks. Enroll/test operator MFA and recovery, identify a backup operator, then enable enforcement.
2. **Public publication completed.** The user specifically approved switching the public Vercel project to main and publishing commit `6e6f135`. See [public production evidence](verification/public-production-deployment.json) and [live-page checks](verification/public-production-smoke.json). Enrollment remains closed.
3. **Supply the missing business facts.** Legal entity and business notice address are unknown. The reply supplied `iwhite@upticklocla.com`; confirmation of that spelling remains pending. Existing `iwhite@upticklocal.com` copy was preserved, and mailbox delivery was not tested.
4. **Finish hosted account and recovery protection.** Resolve [Supabase leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), verify actual provider backup/PITR coverage and restore points, and document separately held secret/recovery ownership. The advisor warning is still present.
5. **Rehearse with actual staff, stock and phones.** Record merchant commitments, staffed hours, quantities, independent fallback funding and partner execution. Verify a phone-camera scan and physical item handoff. The in-app browser did not honor the requested narrow viewport, so it is not evidence of a completed mobile-device check.
6. **Complete carrier readiness and an independent hosted security review.** The software checks do not establish carrier approval, working monitored support or an independent security sign-off. The earlier delegated security review was blocked by automatic screening.

The [operator playbook](PILOT_OPERATOR_PLAYBOOK.md) gives the steps and sign-off records. The [recovery runbook](PILOT_RECOVERY_RUNBOOK.md) covers restore hazards, issued commitments and STOP/callback reconciliation. Keep enrollment and promotional delivery closed until the remaining launch evidence is recorded.

## Approval-review record

The user approved pushing the work and commissioning the operating service. Automatic review rejected an attempt to change existing protected settings to plain text; preserving their sensitive/encrypted types resolved that rejection. It also rejected a combined production-branch change. The operating branch change was subsequently approved after the verified release was merged and the database was ready. The user subsequently supplied the specific public production approval. The branch change and exact-source deployment then passed automatic review; the restriction was resolved without bypassing it.
