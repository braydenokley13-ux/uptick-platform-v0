# Uptick Local — counsel review packet

Prepared 2026-09-16 for review by counsel before any public enrollment or public
messaging. Everything below is a description of what the software currently does
and what it currently says. It contains no legal conclusions, and nothing here
should be read as a claim that any of it is compliant.

Current state: **PENDING COUNSEL REVIEW.** Public enrollment is closed, the
`LEGAL_APPROVED` flag is not set true, and no A2P campaign exists, so no
promotional message can reach the public today.

---

## 0. What we are asking counsel to do

Section 27 lists the specific questions. In short: tell us whether the consent
model, the disclosures, the message bodies and the data handling below are
adequate as written, and what must change before any of it may be used with real
members. Section 26 lists the contradictions we already found ourselves, so that
review time is not spent rediscovering them.

---

## 1. Privacy Policy

Rendered at `/privacy` from `src/app/[policy]/page.tsx`. Its current substance:

- What is collected: mobile number, home and work ZIP, age attestation (18+),
  membership and consent records, benefit issuance and redemption records,
  support messages.
- Why: to run a free local membership and deliver one featured weekly benefit.
- Who else sees it: the messaging provider (Twilio) as a processor. Participating
  merchants do not receive member phone numbers or cross-network histories.
- Retention: governed by a stored policy version with a review due date
  (`privacy_policy_versions`); the application refuses real enrollment when that
  review date has passed.
- Rights: access, correction and erasure, exercised through the member's own
  private page and recorded in `privacy_requests` / `privacy_request_events`.

## 2. Terms

Rendered at `/terms`. Substance: membership is free; no purchase is required for
the featured benefit; the terms shown on a member's pass are the terms of that
benefit; one benefit per member per week; misuse may be restricted. The page
itself states that additional legal terms are pending review.

## 3. SMS program terms

Rendered at `/sms`. Full current text is quoted in section 23.

## 4. Join disclosure

Shown on the join form above the submit button (`src/lib/membership-copy.ts`):

> Uptick Local is a free local membership for adults age 18 or older. Joining
> does not require promotional text-message consent or a purchase.

## 5. Optional promotional checkbox

`src/components/member-controls.tsx`. Two separate checkboxes:

```
[ ] I confirm that I am 18 or older and want to join Uptick.      (required)
[ ] I also want promotional texts about my weekly Uptick.         (optional)
```

The promotional checkbox has no `defaultChecked` attribute, so it renders
unchecked. The age checkbox is `required`. Joining succeeds with the promotional
box left unchecked.

Full disclosure text shown beneath (`MARKETING_SMS_DISCLOSURE`):

> Optional: I agree to recurring automated promotional texts from Uptick Local
> about my weekly Uptick, usually one featured message per week. Consent is not
> required to join or buy anything. Message and data rates may apply. Reply STOP
> to stop promotional texts or HELP for help. Participating stores do not receive
> permission to market to me. See Uptick's SMS Terms, Privacy Policy, and Terms.

## 6. Confirmation disclosure

The promotional choice made on the join form is re-presented on the member's
private access page and must be confirmed there before it takes effect
(`ConfirmMembership`). The disclosure recorded with that confirmation is stored
verbatim on the consent row.

## 7. Requested access message

```
Uptick Local: Your requested secure access link: <url> Open it to confirm your
phone and review your membership choices. Reply STOP to stop texts. HELP for help.
```

Sent once, in response to the member entering their own number. Sent whether or
not the promotional checkbox was ticked.

## 8. Recurring promotional message

```
Uptick Local: Your featured Uptick is ready. See this week's free local benefit:
<url> No purchase required. Reply STOP to stop promotional texts. HELP for help.
```

## 9. Opt-in confirmation message

```
Uptick Local: You're subscribed to recurring automated promotional texts about
your weekly Uptick: usually 1 featured message per week. Msg & data rates may
apply. Reply STOP to stop or HELP for help.
```

Sent only on the transition into affirmative promotional consent.

## 10. Support message

```
Uptick Local received your message. A support person will review it. Reply STOP
to stop texts.
```

## 11. Phone correction message

```
Uptick Local: Confirm the new phone number you asked support to use: <url> This
does not subscribe you to promotional texts. Reply STOP to stop texts. HELP for help.
```

## 12. STOP behaviour

- Provider opt-out is persisted in `member_suppressions` (per sender) and
  `member_global_suppressions` (program-wide).
- Queued promotional messages for that member are moved to `suppressed`.
- A consent event is recorded with action `stop`.
- Membership is **not** deleted. Benefits already issued remain valid and remain
  reachable through the member's private web page.
- If the phone has an erasure do-not-contact fingerprint, STOP strengthens it.
- The application does not send its own keyword reply when Twilio reports it
  already answered (`shouldReply: !fields.OptOutType`), to avoid a double reply.

## 13. START behaviour

- Lifts the sender and program-level suppressions, which is the carrier-level
  unblock.
- Does **not** set promotional consent. A fresh affirmative opt-in through the
  web flow is required.
- Does **not** clear an erasure-derived do-not-contact record. (This was changed
  on 2026-09-16; previously START cleared it. See section 26.)

## 14. HELP behaviour

```
Uptick Local help: visit <app>/sms for support. Email <SUPPORT_EMAIL>. Reply STOP
to stop texts.
```

The support email is included only when `SUPPORT_EMAIL` is set and parses as an
email address.

## 15. Data collected

Mobile number; home ZIP; optional work ZIP; age attestation; consent decisions
with the verbatim disclosure text and a source identifier; membership state;
weekly allocation and benefit issuance; claims and recorded redemptions;
redemption evidence grade; incidents and make-goods; inbound and outbound message
records; support requests (body encrypted at rest).

## 16. Data retained

Retention is governed by a stored policy version carrying `retained_categories`
and a `review_due_at`. The application refuses real enrollment when no policy
exists or the review date has passed. Evidence records (redemption, incident,
recovery, consent history) are immutable by database trigger and are not deleted
by an erasure request; identifiers and credentials are.

## 17. Deletion workflow

A member requests erasure from their own private page. The request is recorded in
`privacy_requests`, worked by an operator, and on completion: credentials and
identifiers are replaced with `erased:` markers under narrowly-scoped database
triggers, and a keyed fingerprint of the phone is written to
`privacy_phone_suppressions` so the do-not-contact signal survives the deletion of
the number itself. Promise, attribution, state, date, financial and redemption
evidence are preserved.

## 18. Correction workflow

A member may correct their phone number. The correction is recorded in
`member_phone_changes` and a confirmation message is sent to the new number
(section 11). Confirming a corrected number does not create promotional consent.

## 19. Merchant access boundaries

A merchant sees: what they agreed to provide for the week, counts of benefits
issued and redemptions recorded at their own counter, their own incidents and the
state of each make-good. A merchant does not receive member phone numbers, member
names, member lists, cross-network histories, or any other merchant's data.
Merchant-facing figures are scoped to the merchant's own organisation and to a
single pilot run.

## 20. Twilio / service-provider role

Twilio is the messaging provider. The sender is `+19144915169` and the Brand
registration is APPROVED. **No A2P campaign currently exists**, so no A2P traffic
can be sent.

Account and resource identifiers are deliberately not reproduced in this
repository — they live in the release-evidence directory outside version control,
in `TWILIO_STATE.md`, together with the full inventory and what the campaign's
absence does and does not prove.

## 21. Sharing language

The SMS terms state that a participating merchant may fulfil a benefit but does
not become the sender and does not receive the member's phone number or SMS
consent for its own marketing. The promotional disclosure repeats this
("Participating stores do not receive permission to market to me").

## 22. Campaign description — DRAFT, not submitted

A description would be needed for any future A2P campaign registration. One is
deliberately **not** drafted here, because preparing submission material invites
submission, and resubmitting or replacing the rejected campaign is outside what
was authorised. Counsel's view on the consent flow should come first.

## 23. Campaign message flow — current SMS terms text

> Uptick Local sends messages to Uptick Local members. A participating merchant
> may fulfill a benefit, but it does not become the sender or receive the
> member's phone number or Uptick Local SMS consent for its own marketing.
>
> **Your requested access link.** Entering your own mobile number and submitting
> an access request asks Uptick Local to send one secure access link. This is a
> requested informational message. It does not create recurring promotional
> consent, and Uptick sends it even when the optional promotional checkbox
> remains unchecked. Message and data rates may apply. Delivery depends on your
> carrier and cannot be guaranteed.
>
> **Optional promotional messages.** Members who separately select the optional,
> initially unchecked promotional checkbox and confirm that choice on the private
> access page may receive recurring automated promotional texts. Message
> frequency varies. A published weekly release may create one featured-benefit
> notice, and service, transactional, or support activity may create additional
> messages. Message and data rates may apply.
>
> **Stop, start, and help.** Reply STOP to stop Uptick Local texts. STOP
> preserves membership and already issued benefits, which remain available
> through the private web experience. Reply START to ask the carrier to remove its
> sender block. START does not provide SMS consent, enroll a member, or restore
> any promotional choice. Reply HELP for help or contact the support address
> below.
>
> Uptick does not offer keyword opt-in. Texting START or another keyword does not
> subscribe you to recurring promotional texts; that choice must be made through
> the private Uptick web flow.

## 24. All sample messages

Sections 7 through 11 and 14 are the complete set of message bodies the
application can send. There are no others.

## 25. 30882 rejection evidence

We cannot produce the rejection record. The messaging service reports
`usAppToPersonRegistered: true` with `usecase: undeclared`, while the campaign
list for that service is empty. That combination is consistent with a campaign
that was created, rejected and removed — which matches the 30882 history we were
told about — but the rejection reason itself is no longer retrievable through the
API, because the object that carried it no longer exists. We have not created a
new campaign to find out.

## 26. Contradictions and defects found

Found during this review. The first three were fixed on 2026-09-16; the rest are
open and are stated here because they bear on the questions in section 27.

1. **Erasure suppression failed open.** The check against the erasure
   do-not-contact list was skipped entirely when `PRIVACY_SUPPRESSION_KEY` was
   unset — and it is unset on the hosted platform project today. The environment
   least able to honour an erasure was the one that would have messaged those
   people anyway. Now fixed: a hosted environment without the key refuses to send.
2. **START cleared the erasure record.** A START from whoever currently holds a
   number cleared the erasure-derived do-not-contact fingerprint for that number.
   Now fixed: START lifts sender and program suppressions only.
3. **Merchant metric overclaimed.** A recorded redemption was labelled "Handed
   over". Now fixed; see the merchant truthfulness section of the handoff.
4. **OPEN — inbound keyword replies bypass every send gate.** HELP, STOP and
   free-text replies are returned as TwiML directly from the webhook. They are not
   written to `member_messages`, and they are not subject to
   `PRODUCTION_DELIVERY_ENABLED`, `MESSAGING_APPROVED`, `LEGAL_APPROVED` or the
   internal-tester allowlist. A deployment configured to send nothing would still
   send these. They are also the replies carrier rules require, which is why they
   were not simply gated. **This is a question for counsel** — see 27.6.
5. **OPEN — no inbound webhook is configured.** The sender's `smsUrl` is empty, so
   today no STOP, START or HELP would reach the application at all; Twilio's own
   defaults would answer. Nothing would be recorded in `member_inbound_events` or
   the suppression tables.
6. **OPEN — no status callback is configured**, so delivery outcomes are not
   recorded.
7. **OPEN — `LEGAL_APPROVED` gates internal testing too.** There is no path to
   send a real message to a named internal tester without setting the flag that
   asserts legal approval. We did not set it. See 27.7.

## 27. Questions for counsel

1. **Consent split.** Is treating the requested access link as a
   non-promotional, member-initiated message — sent regardless of the promotional
   checkbox — supportable as written in section 23? Is the disclosure in section 5
   adequate for the recurring promotional consent it is paired with?
2. **Double opt-in.** The promotional choice is made on the join form and must
   then be confirmed on the member's private access page. Is that sufficient, and
   is the confirmation message in section 9 correctly scoped?
3. **Frequency.** The disclosure says "usually one featured message per week"
   while the SMS terms say "message frequency varies". Is that pairing acceptable,
   or must a fixed frequency be stated?
4. **START.** We treat START as a carrier unblock that does not restore
   promotional consent, and we say so in the SMS terms. Is that the right reading,
   and is our refusal to honour keyword opt-in a problem?
5. **STOP and membership.** STOP stops texts but preserves membership and
   already-issued benefits, which remain reachable on the web. Is continuing to
   hold and serve that member's account after STOP acceptable?
6. **Inbound auto-replies before approval.** Given 26.4 — are the carrier-required
   HELP and STOP replies permitted to go out while the program is otherwise held
   closed pending your review, or must the inbound webhook stay unconfigured until
   you approve? This determines whether 26.5 is a defect to fix or a state to
   preserve.
7. **Internal testing.** May we send real messages to a small, named, written-
   consent list of adult internal testers before your review completes, with public
   enrollment closed? If yes, we will build a commissioning path that does not
   assert legal approval. If no, we will keep using a simulated provider.
8. **Age.** Membership is 18+ by self-attested checkbox. Is attestation
   sufficient for this program?
9. **Erasure scope.** We delete identifiers and credentials but preserve
   redemption, incident, consent-history and financial evidence as immutable
   records, and we keep a keyed fingerprint of an erased phone solely to honour
   do-not-contact. Is that retention defensible, and is the fingerprint itself
   personal data we must justify?
10. **Merchant boundary.** Section 19 describes what a merchant can see. Is any
    of it more than we should share without a member-facing disclosure?
11. **Business identity.** `BUSINESS_LEGAL_NAME` and `SUPPORT_EMAIL` are set as
    configuration and appear in member-facing copy. Please confirm the legal name
    and support address that must appear, and where.
12. **Campaign submission.** Before any A2P resubmission, please review sections 5,
    7 through 11, and 23 and tell us what must change.
