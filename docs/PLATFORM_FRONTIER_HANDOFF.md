# Uptick — platform frontier and commissioning handoff

**Date: September 16, 2026.** Accountable engineer for this pass: Claude (Opus 5).
Base commit: `ee947a9c2e66a98879d29c0474baf519cf16516c` (merge of PR #4, verified as
the current remote `main` at the start of this work — it had not moved).

This record supersedes nothing. It adds one pass of product and interface work on
top of [the September 15 release truth](REAL_ENROLLMENT_RELEASE_TRUTH.md), whose
verdicts on provider, hosted and market readiness still stand except where this
document explicitly changes them.

---

## 1. The honest constraint on this pass

**No credentials of any kind were present in the execution environment.** There was
no `DATABASE_URL`, no `SUPABASE_URL` / `SUPABASE_ANON_KEY`, no `TWILIO_ACCOUNT_SID` /
`TWILIO_AUTH_TOKEN`, and no Vercel token. This was verified by inspecting the process
environment, not assumed.

That boundary is factual and it decides what this pass could and could not do:

| Could do (and did)                                                                   | Could not do (and did not pretend to)                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| All platform software, interface and product work                                    | Apply migrations to the hosted Supabase database             |
| A real four-week pilot rehearsal on local storage                                    | Discover or change actual Twilio account state               |
| Prove the schema-drift fix, and the 021→034 upgrade, on a real PostgreSQL 16 cluster | Submit or approve the A2P Campaign                           |
| Full responsive browser QA with screenshots                                          | Commission hosted Auth, MFA or account recovery              |
| Unit, HTTP and production-build verification                                         | Move `pilot.upticklocal.com` or add `demo.`/`www.` hostnames |

Nothing below claims an external system was commissioned. Where a gate depends on a
provider, a person or a hosted credential, it is reported as still open.

**The public marketing site (`upticklocal.com`) was explicitly dropped from scope for
this pass** and no work was done on it.

---

## 2. What changed

### 2.1 P0 — hosted schema drift can no longer reach a member as a raw error

The failure on record was `relation "location_outages" does not exist` appearing in a
normal runtime route, because the deployed code expected migrations through 034 while
the hosted database stopped at 021. `migrate()` only runs automatically for the local
embedded database; a hosted database is migrated deliberately, so drift was silent
until a query happened to touch a missing table.

The fix does **not** route around missing tables. A hosted connection is now wrapped by
a guard (`src/lib/schema-guard.ts`, wired in `src/lib/db.ts`) that compares the
migration ledger with this release's manifest on first use and, on drift, **refuses to
serve** with a 503 naming the gap, the range of unapplied migrations and the exact
command. The migration runner itself is exempt (`UPTICK_MIGRATING=true`), or it could
never be the thing that closes the gap.

Proven twice:

- `tests/schema-guard.test.ts` — 6 tests, including the exact 021→034 condition, an
  entirely unmigrated database, and the guarantee that a non-relation error (for
  example a dropped connection) is never swallowed as "drift".
- Against a **real PostgreSQL 16.13 cluster** brought to migration 021: the raw driver
  raises `42P01 relation "location_outages" does not exist`, and the guarded
  application instead returns HTTP 503 with the remedy. See §5.

The same drift is reported as a first-class readiness gate, so an operator sees it
before a member does.

### 2.2 Operator — Local Network Command Centre

`/operator/pilot` was a page whose first screenful was a "Create a four-week pilot run"
form, even when a pilot was already live. It is now a command centre
(`src/components/command-centre.tsx`, `src/lib/command-centre.ts`) ordered the way an
operator actually thinks:

1. **Is anything wrong right now?** — one line naming the single most blocking thing.
2. **What is this week's shape?** — members, issued, redemptions, at-risk. Every tile
   carries its basis; none is a score.
3. **Where is it happening and what broke?** — a real Market Cell map projected from
   recorded latitude/longitude, with each destination's worst true state (active, low
   supply, not ready, outage) and the sentence explaining it.
4. **Can we open enrollment?** — the seven readiness gates in compact form.
5. **What do I do next?** — "This week's focus", the existing truthful `constraints`
   list, now structured by category and urgency and routed to the surface that fixes it.

`constraints` changed from `string[]` to a typed `PilotConstraint[]` so the same
sentences can be grouped and ranked without being summarised or scored.

**Four-week backing** compares each week's usable supply with the members _actually
admitted_, not the original target — the number that matters once a cohort is frozen.

### 2.3 Operator — release readiness as a dependency map

Readiness was a checklist. It is now a seven-gate dependency graph
(`src/lib/operator-readiness.ts`, `src/components/readiness-map.tsx`) rendered at the
top of `/operator/pilot/settings`: **software → database → {identity, messaging, market
cell} → support → real enrollment**.

Each gate carries the five things needed to act: the specific untrue thing, the
consequence of leaving it, the owner, the exact next action, and the evidence with its
expiry. The surface names the **earliest unmet gate** as the only one worth starting on,
because a later gate cannot go green while an earlier one is open.

Real enrollment is modelled as `closed` — deliberately held shut — rather than `blocked`,
so a held-closed launch is never confused with a broken one.

### 2.4 Operator — store operations made workable

The four-week rehearsal (§4) exposed `/operator/pilot/fulfillment` as a wall of six
stacked forms plus an unpaginated 64-row ledger: **8160px tall**. Restructured into live
work first (report a problem → make it good), destination setup behind a disclosure, then
publish, then a ledger summarised by state with the full table on request. Now **2994px**,
a 63% reduction, with no capability removed.

### 2.5 Operator — messaging and support console

`/operator/network/messaging` now leads with the two questions that matter
(`src/components/messaging-console.tsx`): _can we send?_ and _is anyone stuck?_ It shows
provider and sender state, both message classes stated as what they do to a member, the
health of both **signed callbacks** (the half of messaging that fails silently), the
support queue with its oldest wait, and recent delivery outcomes.

An **unknown** delivery outcome is rendered as unknown and labelled "do not resend
blindly" — never as success, and never with a retry affordance.

### 2.6 Merchant — dramatically simpler

`/merchant` previously landed on the growth-programs workspace. It now lands on an
overview (`src/lib/merchant-overview.ts`, `src/components/merchant-overview.tsx`)
answering, in order: what are we accomplishing, what do I provide, what is Uptick doing,
what happened, what next. The deeper workspace is one click away and unchanged.

Truthfulness is the point of this surface. It reports exactly two provable facts — a
benefit was issued, and a benefit was handed over at this counter — and says so on the
page. No impressions, no reach, no visits, no "new customers".

One defect was found and fixed here during review: an incident that already had a live
make-good was being counted both as "made good" and as "still being resolved".

### 2.7 Member — the weekly Uptick as a moment

The member home (`src/components/member-home.tsx`) is now app-like: a sticky header, a
five-tab bottom bar, and a cinematic reveal card — a drawn scene, the benefit in large
serif, the store, distance and window, and exactly one action.

Every other member state reuses the same card shape so a waitlist, a pause, a
pre-release wait or an unavailable neighbourhood still feels like somewhere Uptick is
looking after you. **No member state is a dead end**; each carries a next action.

Deliberate decisions:

- **No fabricated name.** Uptick stores no member name, so the greeting is "Good
  morning." rather than inventing one.
- **Illustration, not photography.** Uptick never shows a picture of a store it cannot
  vouch for, and a drawn scene never delays first paint.
- **State-aware subtitle** — a redeemed week says "You picked this one up. Nice.", not
  "Your weekly Uptick is here."
- Nothing was added that the brief excluded: no points, streaks, scratch cards,
  mystery discounts or coupon browsing.

The join page keeps its reviewed consent copy **verbatim and in one place**; only the
surrounding hierarchy and its illustrated close changed. Splitting consent across steps
was deliberately not attempted.

### 2.8 Design system

`:root` was retuned from the cool marine base to a warm evergreen one — same token
names, new values — so the whole product inherits the warmth without every rule being
rewritten. Added a shared primitive layer (`src/app/uptick-system.css`,
`src/components/system.tsx`): cards, status dots and pills, stat tiles with mandatory
basis, constraint rows, week switcher, toggles, notices, empty states, a drawn
storefront scene, and motion reserved for moments that genuinely changed something.
All motion honours `prefers-reduced-motion`. Leftover cool-palette literals in
`member.css`, `merchant-growth.css` and `network-operations.css` were replaced with
tokens so there are no longer two competing palettes.

---

## 3. Verification

| Check                                     | Result                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm test`                                | **305 / 305 pass**, 0 fail, 0 skipped (299 before this pass, +6 new schema-guard tests)    |
| `npm run typecheck`                       | pass                                                                                       |
| `npm run lint`                            | pass, 0 errors, 0 warnings                                                                 |
| `npm run build` (Next 16.3.4, webpack)    | pass                                                                                       |
| `npx playwright test` (HTTP/security e2e) | **13 / 13 pass**                                                                           |
| Responsive browser sweep                  | **33 / 33 pass, zero horizontal overflow**                                                 |
| Schema guard vs. real PostgreSQL 16.13    | **pass** — symptom reproduced, guard fired, 021→034 upgrade applied, guard stood down (§5) |

`npm run format:check` reports one pre-existing warning on
`docs/demo/screenshots/cloud-refresh/mobile-checks.json` (a missing trailing newline).
It predates this pass, CI does not run `format:check`, and the file is dated recorded
evidence, so it was deliberately left untouched.

### Responsive sweep

Member at **320 / 360 / 390 / 430**; operator at **1280 / 1440 / 1728**; merchant at
**834 / 1180 / 1440**. Every surface returned 200 with `scrollWidth == clientWidth`.

---

## 4. Four-week rehearsal

A full pilot was driven end to end on local storage through the same domain functions
the operator UI calls (`scripts/seed-rehearsal.ts`), then inspected in the browser:

- 8 supplies given exact terms, an approved independent fallback and destination
  readiness
- a four-week run created, all four weeks backed at two destinations
- three accountable partner distribution commitments
- 64 members joined through the real join path and were admitted
- 64 assignments recommended across 2 destinations, then released
- 57 passes claimed, **35 redeemed** at the staffed counter through the real Tap path
- 2 fulfilment incidents, one recovered with the approved same-counter substitute
- 1 whole-location outage

Every step of the required rehearsal is reachable from the operator UI with **no SQL
and no terminal**: `run-create`, `run-state` (enrolling → live → complete, including
cohort freeze), `supply-commit`, `supply-amend` (future-week amendment), `configure_supply`,
`save_fallback`, `save_readiness`, `admit`, `recommend_assignments`, `review_suitability`,
`release_week`, `report_incident`, `issue_recovery` (including supersession),
`open_location_outage`, `close_location_outage`, `member-service` (withdrawal and
dispositions), `partner-plan` / `partner-complete`, `economic-entry` / `economic-reverse`,
`labor-entry`.

The usability defect found during this rehearsal (§2.4) was fixed.

---

## 5. Schema guard against real PostgreSQL

A disposable PostgreSQL **16.13** cluster (loopback only, `fsync=on`) was brought to
migration **021** — the hosted condition on record — with this release expecting **034**:

```
1. Database at 21 applied migrations; this release expects 34.
2. Unguarded driver error: 42P01 relation "location_outages" does not exist
3. Guarded response (HTTP 503):
   This deployment expects 34 database migrations but the connected database has 21.
   13 migrations are not applied (022_suppression_reconciliation.sql through
   034_callback_commissioning_scope.sql). Apply the forward migrations with
   "npm run db:migrate" against this database, then reload. No data is changed until
   that runs, and nothing here works around the missing tables.
```

Then the forward upgrade was applied to the same cluster and the guard stood down:

```
$ npm run db:migrate          → Database migrations applied.   (13 migrations, 021 → 034)
$ select count(*) from schema_migrations                       → 34
4. After migrating forward the guard stands down: location_outages is queryable ({"n":0}).
```

This is the original production symptom reproduced, the same call now answering with
cause, consequence and remedy, and the 021 → 034 forward-only upgrade path exercised on
real PostgreSQL. Full transcript:
[`docs/verification/frontier/2026-09-16/schema-drift-proof.txt`](verification/frontier/2026-09-16/schema-drift-proof.txt).

---

## 6. Verdicts

Each verdict states what it is actually based on. A surface is not green because it
renders, and enrollment is not green because software works.

| Area                         | Verdict               | Basis                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DEMO READINESS**           | **GREEN**             | Unchanged by this pass. `pilot.upticklocal.com` still serves the isolated cloud demo (`body class="demo-mode"`), confirmed by fetch. Demo isolation tests still pass inside the 305.                                                                                                                                            |
| **MEMBER EXPERIENCE**        | **GREEN**             | Reveal, saved, redeemed, paused, waitlisted, admitted-waiting and no-place states all built and browser-verified at 320/360/390/430 with zero overflow. No dead ends. Not green _as a live service_: no real member has ever received a real message.                                                                           |
| **MERCHANT EXPERIENCE**      | **GREEN**             | Overview built and verified at 834/1180/1440 against a populated pilot. Reports only provable facts; a double-counting defect was found and fixed.                                                                                                                                                                              |
| **OPERATOR EXPERIENCE**      | **GREEN**             | Command centre, readiness map, messaging console and restructured store operations verified at 1280/1440/1728 against a populated live pilot, and exercised through a full four-week rehearsal.                                                                                                                                 |
| **SOFTWARE / DATABASE**      | **GREEN**             | 305/305 tests, typecheck, lint, production build and 13/13 HTTP security checks pass. Source migrations 001–034 intact; no applied migration was edited. The drift class of failure is now guarded and proven against real PostgreSQL.                                                                                          |
| **TWILIO**                   | **RED**               | Unchanged and **unverifiable from here** — no `TWILIO_*` credentials existed in this environment, so no account state was discovered. No Brand, Campaign, sender association or handset delivery was demonstrated. The console now surfaces provider, sender and both signed-callback states truthfully once credentials exist. |
| **HOSTED AUTH**              | **RED**               | Unchanged and unverifiable from here — no Supabase credentials. Zero of seven hosted commissioning checks are verified. MFA, recovery, lost-factor and tenant-boundary journeys remain external.                                                                                                                                |
| **SUPPORT**                  | **YELLOW**            | The queue, aging, origin and backup-owner surfaces are built and verified against real records, and HELP/inbound handling is covered by the suite. Coverage itself is unverified evidence, and no real member has ever contacted support.                                                                                       |
| **PUBLIC-POLICY DEPENDENCY** | **RED**               | Explicitly out of scope for this pass at the founder's direction. The prepared policy-alignment bundle in `docs/public-site/` remains unpublished.                                                                                                                                                                              |
| **MARKET CELL**              | **RED**               | Unchanged. The connected hosted database still has no real Market Cell, pilot run or member. The rehearsal above is `internal`-classified local data, by design.                                                                                                                                                                |
| **REAL ENROLLMENT**          | **RED — keep closed** | Blocked by messaging, hosted identity, market cell and public policy. `PILOT_ENROLLMENT_ENABLED` stays `false`. Software completeness does not substitute for a provider, a person or a store.                                                                                                                                  |

---

## 7. Exact next actions

These are in dependency order. The first one unblocks the most.

1. **Apply migrations 022–034 to the hosted database.** Take a backup, then run
   `npm run db:migrate` with the hosted `DATABASE_URL`. Forward-only; no applied file
   was edited. The guard will stop refusing as soon as the ledger matches, and the
   `location_outages` runtime error disappears with it. _Owner: deployment owner._
2. **Deploy this release and record CI evidence against its commit**, so every later
   piece of evidence is tied to known code. _Owner: release engineer._
3. **Commission hosted Auth**: primary and backup operator, MFA enrolment and
   challenge, lost-factor recovery, password reset, session revocation, merchant tenant
   restriction. Record each in Settings. _Owner: operator owner._
4. **Twilio**, in this order and only with explicit authorisation for anything that
   incurs a fee or submits for review: confirm the existing approved Brand (do not
   create a second), create the dedicated membership Messaging Service, submit the
   truthful mixed-membership Campaign, associate the dedicated 10DLC number, point both
   webhooks at the **normal** runtime only, then run one internal commissioning message
   to a named allowlisted handset and confirm both signed callbacks. _Owner: messaging lead._
5. **Create the real Market Cell** with its locations, four weeks of approved supply,
   fallback and destination readiness — through the operator UI, which the rehearsal
   proved is sufficient. _Owner: operator owner._
6. **Decide the hostname split** (`upticklocal.com` public, `demo.` isolated demo,
   `pilot.` normal application). This pass did not move anything: the demo keeps
   `pilot.upticklocal.com` until its replacement hostname is serving.
7. Only then is opening enrollment a decision rather than a blocker.

---

## 8. What was deliberately not built

- The public marketing site — dropped from scope by the founder for this pass.
- A multi-step join flow that splits consent across screens. The consent copy is
  reviewed and is presented in one place at the point of submission.
- Operator-facing toggles for real SMS delivery. Turning on delivery is a deployment
  decision with a provider behind it, so the console reports the switches rather than
  offering to flip them.
- Any composite health score. Every state shown names its underlying constraint.
- A mascot. The design system is built to support a character later (illustration
  language, script accent, microcopy voice) without one being forced into any screen now.
- Everything in the deferred list: restaurant marketplace, points, wallet, native app,
  paid membership, POS integration, CPG dashboard, partner portal, ML allocation,
  auction, settlement, broad screen CMS.

## 9. Unresolved risks

- **Nothing external is commissioned.** The largest risk is treating this pass's green
  software verdicts as readiness to enrol real people. They are not.
- **The hosted migration is still unrun**, and it is the one step that touches existing
  production data. Back up first; the guard makes a half-migrated state loud rather than
  silent, but it cannot undo a bad apply.
- **Destination readiness expires on a 72-hour stock window.** A real pilot will hit this
  between weeks; the command centre surfaces it, but it needs a human habit behind it.
- The rehearsal is `internal`-classified synthetic data. It proves the machinery, not
  that a real store will hand over a real coffee.
