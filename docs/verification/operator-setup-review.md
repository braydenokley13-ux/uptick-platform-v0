> **Historical record.** This document describes an earlier implementation or review checkpoint. Use [current release truth](../REAL_ENROLLMENT_RELEASE_TRUTH.md) for this candidate’s fixes, evidence, verdicts and remaining gates. Earlier test counts, demo instructions and unresolved-gap statements are not current unless carried forward there.

# Operator setup and member privacy workflow review

Date: 2026-09-15

## Scope and method

This was a read-only source review of the current operator setup, account access,
member privacy and account-correction paths. It used no browser, hosted database,
provider API, real phone number or SMS. No service, UI, schema or migration file
was changed.

The review specifically looked for:

- forms that still make an operator type or recognize a database identifier;
- forms that require raw JSON;
- ordinary operating work that still requires SQL or a terminal;
- a member-visible request, correction and data-access lifecycle; and
- a safe way to change the phone number that identifies a member account.

## Result at a glance

The newly revised pilot forms have removed the main typed-ID problem. The pilot
page now labels admission choices with phone ending, ZIP and classification, and
uses named selectors for programs, supplies, payers, partners, markets and
classification targets
([pilot page](../../src/app/operator/pilot/page.tsx#L37),
[member selector](../../src/app/operator/pilot/page.tsx#L264),
[classification selector](../../src/app/operator/pilot/page.tsx#L999)). The
privacy, support and account-access pages also use a member hint, verified email,
or business name rather than asking for a UUID
([privacy](../../src/app/operator/pilot/privacy/page.tsx#L106),
[support](../../src/app/operator/pilot/support/page.tsx#L106),
[account access](../../src/app/operator/pilot/access/page.tsx#L56)). I found no
operator form that asks someone to paste raw JSON.

Four product gaps remain. The phone-correction gap is the one that must not be
worked around with SQL.

## 1. Phone correction has no safe completion path

**Priority: blocking for any request to change the account phone number.**

The member-facing request type says “Correct my information,” without identifying
which fields can actually be corrected
([member privacy form](../../src/components/member-privacy.tsx#L5)). The operator
completion form accepts only home and work ZIP. Its copy says phone ownership must
be verified through account access before changing a number
([operator correction form](../../src/app/operator/pilot/privacy/page.tsx#L189)).
The server likewise requires `homeZip` and has no new-phone input or phone update
operation
([completion input](../../src/lib/privacy-admin.ts#L297),
[correction branch](../../src/lib/privacy-admin.ts#L330)).

The mentioned account-access flow cannot safely perform the change. It normalizes
the submitted phone, upserts a `customers` row by that phone, and then finds or
creates the member belonging to that customer
([access request](../../src/lib/membership-identity.ts#L131),
[customer/member lookup](../../src/lib/membership-identity.ts#L165)). A new phone
therefore opens the identity attached to the new number; it does not bind the new
number to the requesting member. The database makes phone globally unique
([customer table](../../db/migrations/001_platform.sql#L18)), and saved recovery
codes require the supplied phone to equal the current customer phone
([recovery lookup](../../src/lib/member-session.ts#L102)).

A direct `update customers set phone=...` is unsafe. It would not prove possession
of the new number, would collide if that number already belongs to another
customer, and would leave existing member sessions and recovery codes usable.
Phone-keyed global and sender suppression records also need a deliberate rule;
consent for the old number must never be inferred for the new one.

### Narrow safe fix

Add a dedicated verified phone-change workflow:

1. Start from the current authenticated member and a verified correction request.
2. Send a one-time, short-lived ownership challenge to the proposed new number.
3. On confirmation, lock the member, old customer, and any customer already using
   the new number in one transaction.
4. If the new number is already attached to another customer, stop for documented
   manual identity resolution. Do not merge automatically.
5. Rebind the existing member to the confirmed phone while preserving its member
   ID, admissions, grants, redemptions, incident evidence and consent history.
6. Revoke every member session, access link and unused recovery code, then require
   fresh access on the new number.
7. Carry forward suppression conservatively, record a new consent decision for
   the new destination when appropriate, and never copy promotional opt-in.
8. Audit masked old/new references, the verification method, actor and request ID.
   Do not store either one-time code or a private access URL in audit detail.

Until this exists, change the member and operator copy to say that ZIP correction
is available in the product and phone correction requires a separately verified
support process that cannot yet be completed in the application. Operators should
not be told that ordinary account access completes it.

## 2. One member-specific fulfillment selector still exposes only an ID suffix

**Priority: high for safe operator use.**

The member-specific travel-suitability form lists each choice only as `Member`
plus the final eight characters of `member_id`; it has no disabled placeholder
and therefore submits the first admitted member by default
([fulfillment form](../../src/app/operator/pilot/fulfillment/page.tsx#L86)). Its
data query supplies only `member_id`, admission time and source
([pilot operations query](../../src/lib/pilot-operations.ts#L786)). An operator
must cross-reference an opaque suffix, and a hurried save can attach personal
travel evidence to the wrong member.

### Narrow fix

Extend that protected query with the same safe hints already used by the admission
and privacy selectors: phone ending, home ZIP and classification. Add a disabled
“Choose the member” option and require an explicit selection. Keep the full member
ID as the option value sent to the server; it does not need to be visible or typed.
Also make the suitable/unsuitable choice explicit instead of defaulting to
`Suitable` on this member-specific record.

Grant, incident, recovery and audit identifiers shown elsewhere are different:
they are durable operating references for already-created evidence. They should
remain available where support or reconciliation needs an exact record.

## 3. Members cannot see request status or receive the access export in-product

**Priority: high for a complete member privacy workflow.**

The member component can only create a request and show a transient success string
([member request submit](../../src/components/member-privacy.tsx#L7)). The
Preferences page passes it no existing request data and renders no queued,
verified, completed or rejected history
([member Preferences page](../../src/app/your-uptick/page.tsx#L94)). The API reply
only says that support will verify it
([member API](../../src/app/api/member/route.ts#L237)). A refresh therefore leaves
the member with no request reference, status, completion summary or corrected
field confirmation.

For an access request, only an operator may call the export endpoint. The operator
button downloads `uptick-member-data.json`
([privacy export route](../../src/app/api/privacy/route.ts#L22),
[operator download](../../src/app/operator/pilot/privacy/page.tsx#L167)). The JSON
contains the member's phone, ZIPs, consent, support text and operating history
([export assembly](../../src/lib/privacy-admin.ts#L198)). JSON is useful as a
portable machine-readable copy, but it is not a complete member delivery flow.
The current product makes an operator handle the member's unencrypted export and
move it through an unspecified channel.

### Narrow fix

Return a safe member-visible request summary from `memberHome`: request type,
created time, state, resolved time and a non-identifying completion summary. For a
verified access request, provide a short-lived, member-session-bound download from
Preferences and retain the existing operator/export audit event. Offer a simple
human-readable page in addition to the JSON attachment. Do not put private access
tokens in the export, browser URL, audit detail or completion copy.

## 4. Dependency independence is represented by operator-invented keys

**Priority: medium; it can block correct supply commissioning.**

Exact supply setup requires a “Primary dependency key,” and fallback setup
requires an “Independent dependency key”
([primary form](../../src/components/pilot-promise-controls.tsx#L187),
[fallback form](../../src/components/pilot-promise-controls.tsx#L251)). The server
only rejects exact string equality
([fallback validation](../../src/lib/pilot-promise.ts#L247)). As a result,
`coffee-machine` and `coffee_machine` pass as independent even if both items depend
on the same broken machine. The field is not a database ID, but it behaves like an
opaque identifier carrying a safety decision.

### Narrow fix

Create named dependency records scoped to the destination, with a short operator
description such as “espresso machine,” “walk-in cooler,” or “same morning staff.”
Let both primary and fallback choose those records, and reject a shared dependency
server-side. If a schema change is deliberately deferred, at least show the
primary value beside the fallback field, normalize case/spacing/punctuation, and
require a plain-language explanation of why the fallback remains usable when the
primary dependency fails.

## External setup that remains, distinguished from product faults

### One-time database and first-operator bootstrap

The first installation still requires a deployment owner to configure the
database, run migrations, copy the first Supabase Auth UUID and run
`npm run bootstrap:operator`
([README](../../README.md#L63),
[bootstrap validation](../../scripts/bootstrap-operator.ts#L13)). This is a real
terminal/raw-UUID prerequisite, but it is a one-time trust-root operation rather
than an ordinary operator workflow. There cannot be an authenticated operator UI
before the first operator exists. The script verifies the UUID against
`auth.users`, locks concurrent attempts, audits the membership and refuses to add
a different first operator when one already exists
([bootstrap transaction](../../scripts/bootstrap-operator.ts#L28)). No manual SQL
is documented or required.

After bootstrap, additional access uses verified email and a named business in
the product. One older business-detail summary still prints full Auth user UUIDs
even though it links to the new account-access screen
([business summary](../../src/app/operator/[[...section]]/page.tsx#L1122)). This is
not required input. Replacing it with verified email or a short safe account label
would remove unnecessary internal data from routine screens.

### Deployment-owned gates

Pilot settings reports legal identity, MFA, enrollment and delivery flags directly
from environment variables and offers status only
([settings checks](../../src/app/operator/pilot/settings/page.tsx#L22),
[status rows](../../src/app/operator/pilot/settings/page.tsx#L64)). Real member
enrollment fails closed until those deployment settings and readiness evidence are
present
([enrollment gate](../../src/lib/membership-identity.ts#L75),
[run transition gate](../../src/lib/pilot-operations.ts#L341)). A normal operator
therefore still needs a deployment owner to change hosted configuration; the app
cannot complete commissioning alone.

Keeping secrets and a global production ceiling outside the ordinary operator UI
is a sound boundary. A narrow usability improvement is to give each failed status
an owner and exact remediation surface, and to store auditable in-product
operator approvals underneath the deployment ceiling. The environment flag can
remain the final hard stop.

### Provider and hardware identifiers

The Twilio Messaging Service SID is typed into the sender form only after external
provider registration
([sender form](../../src/app/operator/[[...section]]/page.tsx#L1027)). Secure NFC
requires a physical tag UID and the names of two secret-manager keys
([NFC form](../../src/components/tap-controls.tsx#L231)). These are genuine external
resource identifiers, not hidden application row IDs. They cannot be safely
replaced with application database selectors unless Uptick also manages those
provider and secret-manager inventories. The current UI correctly refuses secret
key bytes and says physical programming/testing is separate.

## Recommended order

1. Make phone correction honest in the UI immediately, then implement the verified
   phone-change transaction before completing any such request.
2. Fix the remaining member-only-ID selector and its unsafe defaults.
3. Add member-visible privacy status and a secure in-product export delivery path.
4. Replace free-form dependency keys with named, validated dependencies.
5. Add remediation ownership to read-only commissioning checks while preserving
   deployment gates, bootstrap controls and durable operational references.
