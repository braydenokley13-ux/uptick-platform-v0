# Uptick Local — commissioning handoff, 2026-09-16

What was actually done, what was actually proved, and what is actually left.
Where something was not proved, it says so rather than inferring it from
something adjacent.

---

## SOURCE

|                    |                                                                                |
| ------------------ | ------------------------------------------------------------------------------ |
| Original `main`    | `ee947a9c2e66a98879d29c0474baf519cf16516c`                                     |
| Frontier branch    | `claude/vigilant-shannon-f7yc4o` at `453684959f36c492cd2a524a2e4a09e75f8d73ef` |
| Integration branch | `claude/uptick-live-commissioning-20260916`                                    |
| Final SHA          | `dce181394687d5eb5991c5bbe3796279e50e5c7b`                                     |
| Working tree       | clean                                                                          |
| Pushed             | yes                                                                            |

The frontier was a single commit sitting directly on `main` with no divergence,
so the integration branch was cut from it and history preserved. Three commits
were added:

1. `69cea16` — merchant truthfulness
2. `5f7b554` — schema hardening and migration tooling
3. `dce1813` — erasure fail-closed, member claim CTA, readiness unification, counsel packet

The frontier was never merged into `main` directly, as instructed. What should
happen to this branch is a judgement, not a consequence of the tests passing —
see "Merge recommendation".

---

## DATABASE

The single most consequential thing in this campaign.

|                                          | Before                                     | After                                     |
| ---------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| Migrations applied                       | 21                                         | 35                                        |
| Latest                                   | `021_membership_function_search_paths.sql` | `035_restore_public_schema_hardening.sql` |
| Base tables in `public`                  | 97                                         | 117                                       |
| Checksums recorded                       | 0                                          | 14 (`022`–`035`, basis `applied`)         |
| Functions without a pinned `search_path` | 0                                          | 0                                         |
| Views without `security_invoker`         | 0                                          | 0                                         |
| Tables without RLS                       | 0                                          | 0                                         |

Target verified as `dmirmwzubafuzoxcporr` through both the private migration
credentials and the pooler username, connected as `postgres` to database
`postgres` on PostgreSQL 17.6 with `transaction_read_only = off`.

**Backup.** Four dumps taken before touching anything — full cluster (custom
format, all 11 schemas), `public`, `auth`, and `uptick_cloud_demo` — plus one
after. SHA-256 for each is in `evidence/BACKUP_CHECKSUMS.sha256`; tool and
server versions in `evidence/BACKUP_PROVENANCE.txt`. The files themselves are in
a `700` directory outside the repository and were not committed.

**Restore proof.** The `public` dump was restored into a disposable local
PostgreSQL 17.11 cluster and produced 97 base tables, 26 functions, a 21-row
ledger and row counts identical to the hosted database. A `pg_dump` that exits
zero is not a backup; this is the step that shows the file turns back into the
database.

**Rehearsal.** Ran twice against fresh restores: `022`–`034`, then `022`–`035`.
Both reached 117 tables with every row preserved. 117 is also exactly what the
`uptick_cloud_demo` schema has carried since it was installed with the full
range — independent corroboration that the range applies cleanly to a schema of
this lineage.

**Review.** No migration in the range drops a table or a column, and none
rewrites data with an `UPDATE`. `022` is the only data-writing migration and is
idempotent (`on conflict do update`). The statements that scan as destructive are
all `drop constraint` followed by a widened re-add. No migration creates an
extension, a role, or an object in a hardcoded schema, so the range is
structurally incapable of reaching the demo schema sharing this database.

**Migration 035 is this campaign's own addition**, which is a deliberate
departure from the stated `022`–`034` range. Applying `022`–`034` as written
ends with 2 functions whose pinned `search_path` was silently reset by `028`
(`CREATE OR REPLACE` with no `SET` clause reassigns every function property) and
1 definer view created by `030` — on a database whose commissioning record
certifies zero of each. The cloud demo installer has been applying exactly these
three repairs to its own schema since it was written; `public` never received
them. 035 closes that gap forward, because the checksum ledger rightly forbids
rewriting an applied migration.

**Effect on the live application.** Before: `/join` on the production platform
returned HTTP 500, because `supplySelect` references `location_outages`, a table
added by migration `027` that the database did not have. Every page built on that
query failed identically, and the error surfaced as an anonymous Next.js digest.
After: `/join` returns HTTP 200. The production outage is repaired.

**Demo untouched.** `uptick_cloud_demo` remains at 34 migrations with its data
intact (2 memberships, 1 grant, 1 market cell, 1 redemption), and
`pilot.upticklocal.com` still returns 200.

Full detail: `evidence/MIGRATION_RECORD.md`.

---

## VERCEL

| Project              | ID                                 | Production URL                  |
| -------------------- | ---------------------------------- | ------------------------------- |
| `upticklocal`        | `prj_ZHFEe3PL6RGJ1fmkLS0RZ1kC2Bjv` | `www.upticklocal.com`           |
| `uptick-platform-v0` | `prj_U1rgTJlWYnxdLOOu6wPppoa39W2c` | `uptick-platform-v0.vercel.app` |
| `uptick-cloud-demo`  | `prj_OaNjYj6hnSFqyy7iiT7d8lOGTUgF` | `pilot.upticklocal.com`         |

All three IDs match what was expected. The candidate was deployed as a **preview**
(`dpl_59RruCxyYHwQGY1A3EjRw6KZL2AS`, status Ready) to prove it builds and deploys.
Production was not promoted.

**The domain migration was not performed, and could not be.** The intended end
state is `pilot.upticklocal.com` → the normal platform and `demo.upticklocal.com`
→ the demo. `upticklocal.com` uses third-party nameservers
(`ns25/ns26.domaincontrol.com`, GoDaddy), not Vercel's, so `demo.upticklocal.com`
cannot be created from here — it needs a DNS record at the registrar, which this
campaign has no credentials for. Moving `pilot.upticklocal.com` before the demo
has a working alternative hostname would take the demo down, so the known-working
mapping was left exactly as it is. This is an external dependency, not a decision.

**Isolation.** The demo and the normal application share one Postgres database,
separated by schema. That separation is genuinely strong: the installer rewrites
every migration's `search_path` to the demo schema, creates a dedicated
`nobypassrls` login role with a connection limit, revokes `public` from both demo
schemas, and then verifies inside the same transaction that the demo role has
acquired no privilege on `public` or `auth` and can execute no `SECURITY DEFINER`
function there — rolling back the whole installation if either check finds
anything. The normal application's connection now also pins `search_path` to
`public`, which it previously did not.

---

## ENVIRONMENT CONFIGURATION

Audited by name and scope only; no values are reproduced here.

`uptick-platform-v0` (production) carries: `UPTICK_ENV`, `APP_URL`,
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PASS_ENCRYPTION_KEY`,
`SESSION_SECRET`, `CRON_SECRET`, `SMS_TRANSPORT`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `MESSAGING_APPROVED`, `LEGAL_APPROVED`,
`PRODUCTION_DELIVERY_ENABLED`, `PILOT_ENROLLMENT_ENABLED`,
`OPERATOR_MFA_REQUIRED`, `BUSINESS_LEGAL_NAME`, `SUPPORT_EMAIL`,
`TRUST_PROXY_IP_HEADERS`, `INTERNAL_TEST_NUMBERS`, `OPERATOR_AUTH_USER_ID`,
`OPERATOR_ORGANIZATION_NAME`, `UPTICK_LOCAL_MODE`, `LOCAL_DATABASE_PATH`.

Everything except `PRODUCTION_DELIVERY_ENABLED` is stored as a Vercel Secret and
cannot be read back, which is the right posture. `PRODUCTION_DELIVERY_ENABLED` is
readable and is `false`.

**Gaps found:**

- **`PRIVACY_SUPPRESSION_KEY` is absent** from `uptick-platform-v0` while present
  on `uptick-cloud-demo`. Until this commit that silently disabled the erasure
  do-not-contact check; it now blocks sending instead. **It must be set before
  any real message is sent.** It is also one of the nine conditions the
  enrollment gate enforces.
- `MEMBER_ACCESS_SMS_ENABLED` and `MEMBER_PROMOTIONAL_SMS_ENABLED` are absent
  from the platform project but present on the demo.
- `STAGING_TEST_USER_IDS` is absent.
- `UPTICK_LOCAL_MODE` and `LOCAL_DATABASE_PATH` are set on **production**. The
  code prefers `DATABASE_URL`, so the hosted database is still used, but a
  local-mode flag on a production deployment is a footgun worth removing.

---

## AUTH

**Not commissioned. Nothing here was proved.**

No operator sign-in, backup operator, MFA enforcement, session revocation,
merchant tenant isolation or account recovery was exercised against the hosted
application. The hosted `auth.users` table holds exactly one account, which has
signed in once, on 2026-09-11.

This was not skipped for convenience. Proving these requires creating real hosted
accounts with real credentials and real recovery addresses for named people —
which is the kind of real-world fact this campaign was told not to invent — and
production recovery email needs SMTP that is not configured. The honest state is
that hosted identity is **not commissioned**, and the readiness map now says so
rather than showing a gate that was never evaluated.

What _was_ done is make the absence visible: hosted identity is one of the nine
conditions the enrollment gate enforces, and it now has a gate on the operator
map that cannot read ready while its evidence is unrecorded.

---

## TWILIO

|                   |                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Brand             | `BN7289830871d782bb38b08eaa2a283b44` — STANDARD, **APPROVED**, identity VERIFIED, TCR `BL1EFQE` |
| Campaign          | **none exists**                                                                                 |
| Messaging Service | `MGad1b0b78971cab175b42420c8f8f1be1`, usecase `undeclared`, no inbound URL, no status callback  |
| Sender            | `+19144915169`, SMS-capable, **`smsUrl` empty**, no status callback                             |

Nothing was created, modified or deleted. The rejected campaign was not
resubmitted and no replacement was made.

`us-app-to-person:list` returns an empty list with exit status 0 and no error:
there is no A2P 10DLC campaign. The service still reports
`usAppToPersonRegistered: true` while its usecase is `undeclared`, which together
with an empty campaign list is consistent with a campaign that was created,
rejected and removed — matching the known 30882 history. That is an inference
from current state, not a retrieved rejection record; the object carrying the
reason no longer exists.

**REAL SMS IS BLOCKED BY PROVIDER STATE.** An approved Brand without a campaign is
not permission to send. This blocks internal testers too, not only the public —
the filter is at the carrier, and an internal tester's handset sits behind the
same filter as anyone else's.

Two further gaps that would matter even with a campaign: the sender's inbound
webhook is empty while `useInboundWebhookOnNumber` is true, so STOP/START/HELP
would never reach the application and nothing would be written to the suppression
tables; and no status callback is configured, so delivery outcomes cannot be
recorded and the readiness condition requiring a current signed status callback
cannot be satisfied by provider traffic.

Full inventory and the exact remaining provider steps: `evidence/TWILIO_STATE.md`.

---

## LEGAL

```
PENDING COUNSEL REVIEW
```

`LEGAL_APPROVED` was not set. No claim of attorney approval is made anywhere.
Public enrollment remains closed. No A2P resubmission was attempted.

`docs/counsel/UPTICK_COUNSEL_REVIEW_PACKET.md` contains every disclosure, all six
message bodies, both keyword behaviours, the data/retention/erasure/correction
workflows, the merchant boundary, what can and cannot be said about the 30882
rejection, seven contradictions found during this work, and twelve specific
questions. Three of those contradictions were privacy defects fixed here; four
remain open because they are counsel's call, not an engineering call.

---

## MEMBER JOURNEY

**Proved:** the code path, end to end, and two defects in it that are now fixed.

**Not proved:** that a real internal tester completed it on the hosted
application. No internal commissioning member path was built, and no real or
simulated member was driven through the hosted system.

This is the largest thing not delivered. It was blocked twice over: real SMS is
unavailable at the carrier (no campaign), and sending anything — including to an
internal tester — currently requires `LEGAL_APPROVED=true`, which was not set and
must not be faked. Building the distinct commissioning path that would break that
deadlock is designed but unbuilt; see "Remaining work".

Two defects found and fixed along the way:

- **The claim CTA pointed nowhere.** The weekly benefit's "Claim your Uptick"
  button linked to `/u/<supplyId>`, but `/u/[token]` resolves a member _access
  token_. The one action in the entire member journey that turns a benefit into a
  pass led to a URL that could never resolve. Claiming is a write, not a
  navigation; it now invokes the existing claim control.
- **Live make-goods were shown as expired.** Recovery status was inferred from
  absence in a list filtered to unsuperseded, unexpired rows joined through an
  original claim and capped at ten. A recovery whose `original_claim_id` was never
  bound — the column is nullable — read as expired while still usable. Status now
  comes from the recovery's own state and expiry.

---

## MERCHANT TRUTH — what each number now means

| Label                       | What it counts                                                                   | What it does **not** prove                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Benefits issued             | `fulfillment_grants` rows for this merchant, this run                            | that anyone saw or wanted it                                                                                 |
| Recorded redemptions        | grants at `state='redeemed'`                                                     | purchase, visit, incrementality, or that an item changed hands                                               |
| staff-verified (sub-figure) | redemptions with `redemption_evidence.staff_gated` and `verification_level >= 1` | still not physical handoff — only that a staff-held credential was used rather than a member self-confirming |
| Make-goods completed        | incidents whose current recovery reached `state='redeemed'`                      | nothing inferred; expired, active and superseded are counted separately                                      |
| still open                  | incidents with no redeemed recovery and no operator resolution                   | —                                                                                                            |

The schema settles the ceiling itself: `redemption_evidence.transaction_verified`
carries `check(transaction_verified = false)`, a column the database forbids from
ever being true. Uptick cannot prove a purchase, and now does not imply one.

Four defects fixed:

- **"Handed over"** was read straight off `state='redeemed'`, which is produced by
  `self_confirm` (level 0), `public_tap` (not staff-gated) and `operator_override`
  from a desk as readily as by a staff scan.
- **"Made good"** counted any non-superseded recovery grant that merely existed.
  An expired, never-used make-good read as a success _and_ was simultaneously
  removed from the open-incident count, so a member left with nothing vanished
  from the merchant's view entirely. The same file already used the correct
  predicate for fallback capacity; the incident query now matches it.
- **The counter instruction** came from `order by s.created_at desc limit 1` — the
  newest supply row, so a supply amended for a later week became today's
  instruction. It now reads the week's row from `effective_pilot_week_supplies`,
  and only approved supply and approved fallbacks.
- **Completing a pilot erased the merchant's results.** The run query excluded
  `state='complete'`, so the numbers a renewal conversation depends on disappeared
  the moment the pilot finished. A completed run is now selected and labelled.

Also: `"Nothing is charged to you for the member experience"` asserted a
commercial term the system does not hold — Growth pricing is negotiated per
merchant and this page loads no commercial data at all. Removed. What the schema
_does_ guarantee, that members are never charged (`required_spend` and
`member_fee` are pinned to zero by check constraint), is still said, because that
one is provable.

Headline totals no longer come from a twenty-row slice, and run selection now
prefers the live run over a future draft.

---

## READINESS

Thirteen distinct readiness evaluations exist in this codebase. The two that
decide anything both read `releaseReadiness()` and then derived **different
answers from it**: the server gate enforces nine conditions; the seven visual
gates encoded four. Job health, access messaging, privacy policy currency, the
suppression key and operator MFA appeared in no gate at all.

The consequence was not cosmetic. The map could show every gate green under the
headline _"Real enrollment is held closed deliberately. Nothing technical is
blocking it"_ while every signup attempt returned 503.

`enrollmentBlockers()` is now the single list. The server assert throws when it is
non-empty — with a deliberately generic message, because it also guards public
signup and an unauthenticated caller should not be handed a list of what is
unfinished. `readinessGates` reconciles every gate against the same list, so a
gate cannot read ready while a condition it owns is unmet. A new **Operations**
gate owns scheduler health and the privacy prerequisites, which previously had no
gate at all.

The **Market Cell** gate read `state='pilot'` from a free operator-set text
column, so a cell with no supply behind it reported ready. It now requires four
distinct backed weeks, approved supply, an approved fallback and a destination
rehearsed within its validity window — and names which of those is missing.

`tests/readiness-unification.test.ts` asserts the relationship rather than any
particular gate: if the server would refuse, some gate must say so, and every
server condition must be owned by a gate the map renders.

---

## FOUR-WEEK REHEARSAL

**Not run.** The operational rehearsal across four weekly transitions —
release, claims, redemptions, incident, same-counter recovery, a mid-pilot future
supply amendment, a failed-and-superseded recovery in week three, and completion
— was not performed.

Individual mechanisms in it are covered by the test suite (supersession, future
week amendments, frozen cohorts, release integrity, the new merchant and
readiness tests), but that is not the same as a four-week operational rehearsal
driven through the UI, and it should not be reported as one.

---

## SECURITY

Fixed here:

- **Erasure suppression failed open.** The check against the erasure
  do-not-contact list was skipped entirely when `PRIVACY_SUPPRESSION_KEY` was
  unset — and it is unset on the hosted platform project. The environment least
  able to honour an erasure was the one that would have messaged those people
  anyway. A hosted environment without the key now refuses to send.
- **START cleared the erasure record.** A carrier-level START from whoever holds
  a number today cleared the erasure-derived do-not-contact fingerprint. If the
  number was recycled, that is a different person entirely. STOP may now
  strengthen that record; START cannot reach it.
- **Two trigger functions lost their pinned `search_path`** and **one view lost
  `security_invoker`** in migrations `028` and `030`. Restored by `035`, with a
  catalog-level test so the next migration to drop one fails in CI.
- **The migration runner pinned no `search_path`**, leaving the schema that
  unqualified DDL lands in up to the connecting role's default — in a database
  that also holds the demo schema. Now pinned.
- **`migrate()` had a time-of-check/time-of-use gap** between reading the ledger
  and applying a migration. Now re-checked inside the transaction behind an
  advisory lock.
- **`scripts/migrate.ts` discarded the Postgres error entirely**, reporting "check
  the database connection" for what might be a constraint violation in a named
  file — the same undiagnosable failure the schema guard exists to eliminate. It
  now prints SQLSTATE, message, detail, hint, PL/pgSQL context and constraint,
  while still withholding the stack and raw error, which carry the query and its
  parameters.

Found and **not** fixed:

- **Inbound keyword replies bypass every send gate.** HELP, STOP and free-text
  replies are returned as TwiML directly from the webhook, are not recorded in
  `member_messages`, and are subject to none of `PRODUCTION_DELIVERY_ENABLED`,
  `MESSAGING_APPROVED`, `LEGAL_APPROVED` or the tester allowlist. They are also
  the replies carrier rules require, which is exactly why they were not simply
  gated — whether they may go out before approval is question 27.6 for counsel.
  The duplicate-reply guard is already correct (`shouldReply: !fields.OptOutType`).
- **RLS is enabled on every table with zero policies**, and the application
  connects as the owning role, which bypasses RLS. This is deliberate
  fail-closed design — anything _other_ than the owner gets nothing — but it means
  RLS is not a defence against a compromised application credential. Worth stating
  plainly rather than counting "RLS enabled everywhere" as protection it does not
  provide.
- **Migration `014` cannot apply to a database that already holds
  `member_consents` rows.** Its backfill `update member_consents set
consent_action = … where consent_action is null` fires the
  `immutable_member_consents` trigger. It passes everywhere because on an empty
  table the UPDATE matches zero rows. The local development database, stranded at
  migration 013 with two consent rows, reproduces it exactly and could not be
  migrated forward. Hosted is unaffected — `014` was applied there long ago — but
  any new environment bootstrapped from a database with consent history will hit
  this.

A full adversarial pass over QR/tap token entropy and replay, CSRF, session
fixation, MFA bypass and cron authorization was read but not separately reported;
the tap and security suites already cover these and pass.

---

## TEST MATRIX

Run on **Node 24.21.0**, matching Vercel's 24.x target, after `npm ci`.

|                     |                                        |
| ------------------- | -------------------------------------- |
| `npm ci`            | clean, 0 vulnerabilities               |
| `npm run lint`      | clean                                  |
| `npm run typecheck` | clean                                  |
| `npm test`          | **322 passed, 0 failed** (up from 305) |
| `npm run test:e2e`  | **13 passed**                          |
| `npm run build`     | succeeds                               |

17 tests were added: 7 for merchant truthfulness, 5 for schema hardening, 4 for
readiness unification, 1 for the erasure fail-closed path.

---

## VERDICTS

| Area               |                               | Why                                                                                                                                                                  |
| ------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SOFTWARE           | **GREEN**                     | Full matrix green on Node 24; four truthfulness defects, two privacy defects, a broken member CTA and the readiness divergence all fixed with tests                  |
| HOSTED DATABASE    | **GREEN**                     | 21→35, backed up, restored, rehearsed twice, every row preserved, hardening properties 0/0/0, demo untouched                                                         |
| NORMAL DEPLOYMENT  | **YELLOW**                    | The live 500 is repaired and the candidate builds and deploys as a preview, but the candidate is not in production and `pilot.upticklocal.com` still serves the demo |
| DEMO               | **GREEN**                     | Untouched, still 200, still at migration 34, isolation verified                                                                                                      |
| HOSTED AUTH        | **RED**                       | Nothing commissioned. One account, one sign-in, no MFA/recovery/tenant proof                                                                                         |
| INTERNAL MESSAGING | **RED**                       | No campaign at the carrier, and no commissioning path that avoids asserting legal approval. Nothing was sent                                                         |
| PUBLIC MESSAGING   | **RED**                       | No A2P campaign; no inbound webhook; no status callback; legal hold in force                                                                                         |
| SUPPORT            | **RED**                       | No named primary or backup owner recorded. A real external dependency, not a software gap                                                                            |
| REAL MARKET CELL   | **RED**                       | Zero market cells, pilot runs, members, admissions or customers exist in the hosted `public` schema                                                                  |
| LEGAL / COUNSEL    | **RED**                       | `PENDING COUNSEL REVIEW`. Packet prepared; twelve questions outstanding                                                                                              |
| REAL ENROLLMENT    | **RED — deliberately closed** | Correct and intended. Nothing here changes it                                                                                                                        |

No area's GREEN implies another's. In particular: the database being green means
the schema is sound and recoverable, not that there is anything in it.

---

## MERGE RECOMMENDATION

**Merge to `main` — but as a decision, not because the tests pass.**

For: the hosted database is already at 035, so `main` (at 034) is now _behind_
the database it talks to. That is benign today — the drift guard only fails on
missing migrations, not extra ones — but it means `main` and production have
diverged in a way that only this branch resolves. The branch also carries the
repairs for a live production 500, four merchant claims the data did not support,
two privacy defects, and a readiness surface that could tell the founder nothing
was blocking while the server blocked everything.

Against: none of it has run in production, and hosted auth, messaging and the
four-week rehearsal are untested.

Recommended: merge, deploy to production, then re-verify `/join`, the operator
readiness map and the merchant overview against the hosted database before doing
anything else. Do not open enrollment as part of that.

---

## REMAINING EXTERNAL GATES

Things a human, a provider or a lawyer must do. Software cannot close these.

1. **Counsel review** of `docs/counsel/UPTICK_COUNSEL_REVIEW_PACKET.md`,
   especially questions 6 (may carrier-required auto-replies go out before
   approval?) and 7 (may we message named internal testers?). Question 7 gates
   the entire internal commissioning path.
2. **A2P campaign** against the approved Brand. Requires explicit authorization —
   it was rejected before, and both resubmitting and creating a replacement were
   outside what this campaign was permitted to do.
3. **DNS at the registrar** (`domaincontrol.com`): create `demo.upticklocal.com`
   so the demo can move off `pilot.upticklocal.com`.
4. **Set `PRIVACY_SUPPRESSION_KEY`** on `uptick-platform-v0`. Sending is now
   refused without it, and enrollment is gated on it.
5. **Twilio webhooks**: inbound to `<APP_URL>/api/member-twilio/inbound`, status
   to `<APP_URL>/api/member-twilio/status`, pointed at the normal application and
   never at the demo host.
6. **SMTP** for account recovery, or hosted account recovery cannot be proved.
7. **Name a support owner and a backup**, with a contact path that has been
   tested. Two real people.
8. **A real Market Cell**: a real neighbourhood, real destinations, real
   inventory-backed supply for four weeks, a real fallback, and real merchants who
   have agreed. None of this exists and none of it may be invented.
9. **Founder decision on opening enrollment**, which stays closed until then.

---

## THE SINGLE NEXT ACTION

**Send the counsel packet to Ian White's reviewer and get an answer to question
7: may Uptick send real messages to a small, named, written-consent list of adult
internal testers while public enrollment stays closed?**

Everything else is either already done, blocked behind that answer, or a
real-world fact that has to be created rather than built. A "yes" unblocks the
internal commissioning path, which unblocks the first real hosted member journey,
which is the last technical unknown before a real pilot. A "no" is equally
valuable, because it means the simulated path is the one to build and the
remaining work is known.

The A2P campaign is the close second — and it should follow counsel's answer, not
precede it, since the prior rejection was about exactly the consent flow counsel
is being asked to review.
