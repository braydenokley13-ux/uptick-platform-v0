# Pilot release candidate for hosted commissioning

Prepared September 14, 2026. **Awaiting deployment approval.** This release enables an internal rehearsal; it does not authorize real enrollment, promotional sending or A2P submission.

## Exact source and destination

| Item                                 | Value                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Operating repository                 | `braydenokley13-ux/uptick-platform-v0`                                        |
| Branch                               | `codex/pilot-ready-service`                                                   |
| Verified application commit          | `605f147504d74325b7baf8439281debbbcc0a5f8`                                    |
| Vercel team                          | `team_FVNcvbojx1qlGIHJGRhwOihR`                                               |
| Vercel project                       | `prj_U1rgTJlWYnxdLOOu6wPppoa39W2c`                                            |
| Canonical alias                      | `https://pilot.upticklocal.com`                                               |
| Existing Supabase project            | `dmirmwzubafuzoxcporr` (`uptick-staging`)                                     |
| Existing hosted source at inspection | `a16fd6edd742edc0bcf2ede6a30f438a39c3944f`                                    |
| Separate public-site candidate       | `e6174b72a598c5949b3680ada23ac313574e8530` in `braydenokley13-ux/upticklocal` |

Documentation-only commits may follow the verified application commit. Before publishing, record the exact final release SHA and confirm that its application, migration, dependency and configuration files match the verified source. Do not deploy from an uncommitted working directory or an unspecified target.

## Commissioning settings

Set these explicit non-secret values for the canonical Vercel deployment before testing. These are proposed settings, not a claim that the hosted environment already has them.

```text
APP_URL=https://pilot.upticklocal.com
UPTICK_ENV=staging
UPTICK_LOCAL_MODE=false
PILOT_ENROLLMENT_ENABLED=false
PRODUCTION_DELIVERY_ENABLED=false
SMS_TRANSPORT=development
MESSAGING_APPROVED=false
LEGAL_APPROVED=false
OPERATOR_MFA_REQUIRED=false
```

Keep the existing database and cryptographic secrets in their protected environment store. Do not rotate encryption keys during this routine release. Confirm actual operator membership and the staging tester allowlist before hosted sign-in. Turn on `OPERATOR_MFA_REQUIRED=true` only after the operator has enrolled and successfully tested a factor and recovery access. The real-pilot decision requires that protection; a green internal rehearsal does not waive it.

The simulated SMS transport sends no carrier messages. A later carrier test requires a separate deliberate transport/allowlist configuration and authorized internal recipients. Retain closed enrollment and closed production delivery throughout commissioning. Do not change the public pilot to production mode until its separate launch conditions are satisfied.

## Forward migration checksums

Apply 014–020 in order, using a transaction per file and preserving the repository filename convention in `schema_migrations`. Preserve existing 001–013 history and all legacy records. Never run a seed against this project.

```text
91d62bdbe91edf7eabd6c0e80ca138cc20164277671e19e35130f4577b033260  014_membership_service.sql
7b8108c7a8bb2d91f89829c96a4e7cfac356a76e6b844446713a4a467b92d555  015_pilot_promises.sql
7166a1344e99b2d5e5e59ba8c11ad3088833ea616af86bfb4d0363517972baa1  016_growth_programs.sql
684e2f0edc12283889419ca0535b40bf0b282e41a3b1f00ded20b3df78dddcfa  017_pilot_operations.sql
c126c969ffcf2bae2a1da55e834dc045e51b866e5ca624f42275ce257bb14550  018_runtime_safety.sql
dfd3a2bc869cb435d77bce2d73352916fbabb64b58ee95a0a7922ca109e1b626  019_growth_review_fixes.sql
7659a8c9c5060dec6837eaa89ff5c5a8ab229bf57c251ff674d59a5731386830  020_frozen_pilot_cohorts.sql
```

## Work after approval

1. Recheck the target deployment, database migration ledger and existing record counts. Stop to reconcile any intervening changes before applying this candidate.
2. Confirm a protected recoverable backup and the provider recovery procedure before changing the hosted database. The completed local restore is not proof of a hosted restore point.
3. Apply the forward migrations and verify preserved records, migration filenames, RLS and function search paths.
4. Publish the exact committed source to the named Vercel project and verify the canonical alias and all closed-launch settings.
5. Run hosted internal sign-in/revocation, member session, protected API, staff QR, signed callback and authenticated scheduler checks. Record observed outcomes and distinguish simulated delivery from carrier delivery.
6. Follow the operator playbook for a real-phone and physical-counter rehearsal. Resolve legal identity, exact support email, business commitments and carrier readiness before requesting the real launch decision.

Public-site publication is a separate release from its archived candidate. Its deployment target and required policy facts must be confirmed before publishing those pages.

The [implementation report](PILOT_IMPLEMENTATION_REPORT.md) records exact local test evidence and remaining blockers. The [recovery runbook](PILOT_RECOVERY_RUNBOOK.md) explains database rollback, issued commitments, keys outside the database and STOP/callback reconciliation.
