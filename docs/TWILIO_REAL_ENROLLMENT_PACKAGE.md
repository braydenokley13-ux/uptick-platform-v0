# Uptick Local real-enrollment Twilio package

**Prepared:** September 15, 2026
**Provider basis:** current official Twilio documentation checked on September 15, 2026
**Status:** reviewable draft; **do not submit and do not enable real SMS yet**

This package describes one messaging relationship:

> **Uptick Local sends messages to Uptick Local members. Participating merchants fulfill benefits. They do not receive the member's phone number or Uptick Local SMS consent for their own marketing.**

It separates two permissions:

1. A person enters their own phone number and asks Uptick Local for one secure access link. This is a requested informational transaction. It does not create recurring promotional consent.
2. A person separately checks an optional, initially unchecked promotional SMS box and confirms that choice through the private access page. This is the only web flow that creates recurring promotional consent.

A member-requested phone-number correction is a separate service workflow. After support verifies the member's correction request, Uptick sends a short-lived verification link to the proposed new number. Confirming that link proves control of the proposed number; it does not subscribe the member to promotional texts.

## 1. Current recommendation

### Registration owner

Register the real Uptick operating entity as a **Direct Brand** if that entity owns the Twilio account, collects the consent, sends the messages, and operates support. Uptick is not registering each participating merchant as the sender in this program.

Use an ISV/reseller structure only if the real commercial arrangement is different and Uptick is actually registering downstream customers that send their own messages. Do not describe participating merchants as message senders merely because they fulfill a benefit.

### Brand and use case

- Preferred pilot path for a legal entity with an EIN and fewer than 2,000 T-Mobile message segments per day: **Low-Volume Standard Brand** with the **`LOW_VOLUME` (Low Volume Mixed)** Campaign use case.
- If Uptick registers a Standard Brand instead: use **`MIXED`**, because one sender carries requested access, optional promotional benefit notices, and customer-care replies.
- If the registrant is legally a sole proprietor: Twilio limits the Campaign to **`SOLE_PROPRIETOR`**. Confirm this from the real business facts before using it.
- Do not register this as only `ACCOUNT_NOTIFICATION` or only `CUSTOMER_CARE`; the weekly benefit message is promotional.
- A separate `MARKETING` Campaign is an alternative only if Uptick also provisions a separate sender and Campaign for requested access/support. The current application deliberately uses one dedicated membership Messaging Service, so Low Volume Mixed/Mixed is the truthful fit.

Twilio describes `LOW_VOLUME` as a lower-throughput Campaign covering multiple use cases and `MIXED` as a Campaign covering multiple use cases. Twilio classifies promotional offers as `MARKETING`. See [A2P 10DLC required business information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info) and the [A2P 10DLC overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc).

## 2. Implemented controls and exact external proof still required

The repository behavior below is covered by automated tests. It is not evidence that a hosted page, Twilio account, Campaign, sender, webhook, or carrier path has been commissioned. This package claims no real sender, approved Brand or A2P Campaign, provider receipt, status callback, or handset receipt.

| Area                     | Implemented in this repository                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Exact external proof still required                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal Brand identity     | Every membership template identifies “Uptick Local.” Public policy source has placeholders for final operating-entity facts.                                                                                                                                                                                                                                                                                                                                                                                                              | Supply `[[LEGAL BUSINESS NAME]]`, business form, EIN evidence, notice address, authorized representative, and approved support details. Confirm that “Uptick Local” is the registrant's real DBA/Brand tied to that entity and is visible on the submitted website.                                                                                               |
| Public policy pages      | The Privacy, Terms, and SMS page source separates requested access from optional promotional consent. It includes mobile-data non-sharing, frequency, rates, STOP, START, HELP, and merchant separation.                                                                                                                                                                                                                                                                                                                                  | Deploy the final legal identity and support details. Verify `https://upticklocal.com/privacy`, `/terms`, and `/sms` return the final text to an anonymous browser with HTTP 200, and preserve dated captures. No hosted-page proof was collected in this code-only review.                                                                                        |
| Two-screen opt-in        | `/join` uses a separate promotional checkbox that starts unchecked. The private access page repeats the choice and disclosure, and the member can continue with it off. A returning member can opt in only after a fresh access request carried the explicit choice and the private page confirms it.                                                                                                                                                                                                                                     | Publish redacted screenshots of the complete initial and returning-member flows at `[[PUBLIC EVIDENCE URL]]`. Include checkbox-off completion, checkbox-on confirmation, the disclosed text, visible policy links, and a redacted private token.                                                                                                                  |
| Web opt-in confirmation  | A false-to-true promotional-consent transition queues one `opt_in_confirmation` bound to that immutable consent row. Decline, replay, and repeated “on” saves do not duplicate it. A later opt-out/STOP suppresses a queued confirmation; a fresh web re-opt-in can create a new one. It observes quiet hours and does not occupy the weekly Drop slot.                                                                                                                                                                                   | Add the exact confirmation template as a Campaign sample. In an authorized internal carrier test, prove one handset receipt after a fresh opt-in, no message after decline/replay/repeated “on”/START, suppression after STOP, and one new confirmation after a fresh web re-opt-in.                                                                              |
| Advanced Opt-Out replies | `OptOutType=STOP`, `START`, and `HELP` are recorded without an application reply; the route returns empty TwiML. Ordinary inbound support text gets one application acknowledgement.                                                                                                                                                                                                                                                                                                                                                      | Configure the listed keywords and responses on the dedicated Messaging Service before enabling Advanced Opt-Out. Preserve Console screenshots and real webhook/TwiML evidence showing one provider reply and no duplicate application reply.                                                                                                                      |
| STOP and START state     | STOP records a consent withdrawal and suppresses all queued promotional messages while preserving membership and issued benefits. START clears application suppression but does not restore promotional consent.                                                                                                                                                                                                                                                                                                                          | Prove Twilio's provider block, configured STOP/START replies, application reconciliation, and the effect on requested-access delivery with the real dedicated sender. Prove that only a later affirmative web choice restores recurring consent.                                                                                                                  |
| Phone-number correction  | An operator can prepare a correction only from a verified, member-requested privacy correction. The encrypted, one-use challenge goes only to the proposed new number, expires after 15 minutes, and does not create promotional consent. Support can apply the correction only within 24 hours of confirmation. Applying it revokes prior sessions and access credentials, rotates private pass credentials without changing benefit history, suppresses queued messages to the prior recipient, and records promotional consent as off. | Align the public SMS sample and policy explanation with this flow. In an authorized carrier test, prove delivery only to the proposed number, expiry and replay rejection, operator application within 24 hours, old-session/access revocation, preserved benefit history, and fresh web opt-in before any later promotional message.                             |
| Delivery-class gates     | Real access and promotional messages share the production-only `PRODUCTION_DELIVERY_ENABLED` kill switch. Requested access and phone-correction verification require `MEMBER_ACCESS_SMS_ENABLED`; opt-in confirmations and weekly notices require `MEMBER_PROMOTIONAL_SMS_ENABLED`. Staging additionally limits real delivery to `INTERNAL_TEST_NUMBERS`.                                                                                                                                                                                 | Record the configuration owner and approval sequence. Exercise each class independently in staging, then use a bounded production test window with public enrollment closed, a reviewed queue, and authorized recipients. Close the applicable flag immediately on failure; retain configuration and test evidence.                                               |
| HELP and free text       | HELP and ordinary messages enter `member_support_requests`, and operators have a protected support queue.                                                                                                                                                                                                                                                                                                                                                                                                                                 | Name `[[PRIMARY SUPPORT OWNER]]`, `[[BACKUP SUPPORT OWNER]]`, coverage hours, response target, and tested support email. Prove the queue is monitored during the pilot.                                                                                                                                                                                           |
| Status callbacks         | The app supplies a per-message HTTPS callback, validates the Twilio signature and account with the SDK, deduplicates states, and prevents an older callback from downgrading a newer state. Successful inbound and status-callback health is current only for seven days and only while its hashed release, Twilio account, canonical origin, environment, and active sender identity/service/number remain unchanged.                                                                                                                    | Commission both callback kinds on the exact production release, account, origin, environment, Messaging Service, and sender. Preserve signed callback evidence and Message SIDs. Re-run both after any scoped value changes and at least every seven days while commissioning remains active. Do not call API acceptance “delivered,” or carrier delivery “read.” |
| Unknown submission       | A timeout or interruption becomes `unknown` and is not automatically retried.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Name the operator and write the runbook for matching an uncertain attempt in Twilio logs/API and closing the record. Exercise it once without blindly resending.                                                                                                                                                                                                  |

Twilio's current Campaign rejection guidance expressly requires a voluntary choice, an unchecked checkbox when a checkbox is used, and a path that allows the person to continue without promotional messaging consent. See [Campaign rejection 30931](https://www.twilio.com/docs/api/errors/30931) and [Campaign rejection 30923](https://www.twilio.com/docs/api/errors/30923).

## 3. Exact A2P Campaign package

Copy this section only after every bracketed field is resolved and the blockers above are closed. The submission must describe the behavior that is actually live on the submitted URLs.

### Business and account fields

| Console field                 | Value                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Paid Twilio account           | `[[TWILIO ACCOUNT SID / ACCOUNT OWNER]]`                                                                                          |
| Primary Compliance Profile    | `[[APPROVED PROFILE SID OR CONSOLE RECORD]]`                                                                                      |
| Customer type                 | `Direct Brand` unless the real arrangement requires documented ISV treatment                                                      |
| Brand type                    | `[[LOW-VOLUME STANDARD / STANDARD / SOLE PROPRIETOR]]`                                                                            |
| Exact legal business name     | `[[MATCH CP 575 OR IRS 147C LETTER]]`                                                                                             |
| Legal structure               | `[[CO-OPERATIVE / CORPORATION / LIMITED LIABILITY CORPORATION / NON-PROFIT CORPORATION / PARTNERSHIP]]` for a Standard/LVS entity |
| Industry                      | `[[CONSUMER / ONLINE / RETAIL / TECHNOLOGY / OTHER ACCURATE TWILIO VALUE]]`                                                       |
| Registration identifier       | `EIN` for the expected US entity path                                                                                             |
| Registration number           | `[[EIN IN 00-0000000 FORMAT]]`                                                                                                    |
| Website                       | `https://upticklocal.com` after legal identity is published                                                                       |
| Social profiles               | `[[REAL BUSINESS SOCIAL URLS, IF USED]]`                                                                                          |
| Business identity             | `direct_customer`                                                                                                                 |
| Region of operation           | `USA_AND_CANADA` if that remains factually correct                                                                                |
| Company type                  | `[[private / public / non-profit / government]]`                                                                                  |
| Stock exchange/ticker         | `NONE` / blank unless applicable                                                                                                  |
| Authorized representative     | `[[FIRST NAME]] [[LAST NAME]]`                                                                                                    |
| Representative title/position | `[[EXACT JOB TITLE]]` / `[[TWILIO POSITION VALUE]]`                                                                               |
| Representative phone          | `[[E.164 PHONE]]`                                                                                                                 |
| Representative email          | `[[NON-DISPOSABLE BUSINESS EMAIL]]`                                                                                               |
| Brand contact email           | `[[INDIVIDUAL BUSINESS-DOMAIN EMAIL ABLE TO COMPLETE TCR 2FA]]`                                                                   |
| Business address              | `[[CUSTOMER NAME, STREET, SUITE, CITY, STATE, ZIP, US]]`                                                                          |

Twilio lists these business fields and says the US legal name must match the EIN record. The website must be functional, related to the business name, public, and not redirect to an unrelated brand. See [Gather the Required Business Information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info).

### Campaign identifiers and selection fields

| Campaign field             | Exact value                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Messaging Service          | `[[DEDICATED UPTICK MEMBERSHIP MG SID]]`                                                                                                                       |
| Phone number               | `[[DEDICATED APPROVED US +1 10DLC NUMBER]]`                                                                                                                    |
| Use case                   | `LOW_VOLUME` for a Low-Volume Standard Brand; `MIXED` for a Standard Brand; `SOLE_PROPRIETOR` only for a Sole Proprietor Brand                                 |
| `has_embedded_links`       | `true`                                                                                                                                                         |
| Embedded URL domain/sample | `https://pilot.upticklocal.com/u/[secure-token]`, `https://pilot.upticklocal.com/phone-change/[secure-token]`, and `https://pilot.upticklocal.com/your-uptick` |
| `has_embedded_phone`       | `false` while support is email/web only; change to `true` and show the exact number in samples if a support phone is added                                     |
| `subscriber_opt_in`        | `true`                                                                                                                                                         |
| `age_gated`                | `true` because membership requires an 18+ attestation                                                                                                          |
| `direct_lending`           | `false`                                                                                                                                                        |
| Privacy Policy URL         | `https://upticklocal.com/privacy` after the blocker above is fixed                                                                                             |
| Terms and Conditions URL   | `https://upticklocal.com/terms` after final legal review                                                                                                       |
| SMS program URL            | `https://upticklocal.com/sms`                                                                                                                                  |
| Public opt-in/evidence URL | `[[PUBLIC JOIN URL OR PUBLICLY ACCESSIBLE REDACTED SCREENSHOT URL]]`                                                                                           |
| Keyword opt-in offered     | `No`                                                                                                                                                           |
| Opt-in keywords            | Leave blank. `START` clears provider blocking but is not Campaign consent.                                                                                     |
| A2P `opt_in_message`       | Leave blank because users cannot subscribe by texting a keyword.                                                                                               |
| Opt-out/help handling      | Twilio Advanced Opt-Out on the dedicated Messaging Service                                                                                                     |

As of February 2026, Twilio provides dedicated Privacy Policy and Terms and Conditions URL fields and requires both for new Campaign registration. See [Twilio's compliance-fields announcement](https://www.twilio.com/en-us/changelog/-u-s--a2p-10dlc--campaign-registration---privacy-policy---terms-) and [Campaign rejection 30882](https://www.twilio.com/docs/api/errors/30882).

### Campaign description

Use this exact text:

> Uptick Local sends SMS to adults in its local membership program. A person may enter their own mobile number and expressly request one secure, time-limited access link. That requested informational message does not create recurring promotional consent. A member who asks support to correct their phone number may receive a separate, short-lived verification link at the proposed new number after support verifies the member's correction request; confirming it proves control of the proposed number and does not create promotional consent. Separately, a member may choose an optional, initially unchecked web checkbox and confirm it through the private access page to receive recurring automated promotional notices about an available weekly local benefit. Each new false-to-true web opt-in queues one subscription confirmation, which is separate from the weekly featured message. Members can join, use web access, and redeem an issued benefit without promotional SMS consent. Participating merchants fulfill benefits but do not receive member phone numbers or Uptick Local messaging consent for their own marketing. The same dedicated Uptick Local sender also receives HELP and ordinary support replies. Twilio Advanced Opt-Out handles STOP, START, and HELP keyword responses; Uptick records those events. STOP ends program texts while preserving membership and issued benefits. START removes provider blocking but does not restore promotional consent; a fresh affirmative web opt-in is required.

### Message flow / call to action

Replace the two evidence placeholders, then use this exact text:

> Adults age 18 or older reach the Uptick Local join form at `[[PUBLIC JOIN URL]]`; the complete two-screen flow is also shown at `[[PUBLIC EVIDENCE URL]]`. On the first screen, the person enters a mobile number they are authorized to use, checks the required 18+ membership attestation, and presses “Join Uptick — it's free” to expressly request one secure access text. The page states that Uptick Local will text a one-time private link. This requested informational text is limited to the request and does not enroll the person in recurring promotional messages. A separate promotional SMS checkbox is visible, labeled optional, and unchecked by default. The disclosure identifies Uptick Local, describes recurring automated promotional texts about the weekly Uptick, says they are usually one featured message per week, says consent is not required to join or buy anything, states that message and data rates may apply, explains STOP and HELP, and links the SMS Terms, Privacy Policy, and Terms. The person can submit the join form with the promotional box unchecked. If the person checks it, the private access page repeats the choice and disclosure; the person may uncheck it before pressing “Join & open my Uptick.” Uptick records recurring consent only after that affirmative private-page confirmation and queues one subscription confirmation for each new false-to-true web opt-in. A refresh, replay, repeated “on” save, or START does not generate that confirmation. Uptick does not offer keyword enrollment. Replying START only removes provider suppression and never creates recurring consent. Privacy Policy: `https://upticklocal.com/privacy`. Terms: `https://upticklocal.com/terms`. SMS program: `https://upticklocal.com/sms`.

This text describes both forms of express consent without using the promotional choice as the basis for the requested access message. Twilio requires the message flow to list every opt-in method, provide verifiable web evidence, and link public privacy and terms pages. See [Campaign rejection 30896](https://www.twilio.com/docs/api/errors/30896) and [A2P registration quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart).

### Campaign sample messages

Submit these four templates after verifying that the production application renders the same wording and uses only the declared Uptick domains:

1. **Requested access**

   > Uptick Local: Your requested secure access link: https://pilot.upticklocal.com/u/[secure-token] Open it to confirm your phone and review your membership choices. Reply STOP to stop texts. HELP for help.

2. **Optional weekly promotional notice**

   > Uptick Local: Your featured Uptick is ready. See this week's free local benefit: https://pilot.upticklocal.com/your-uptick No purchase required. Reply STOP to stop promotional texts. HELP for help.

3. **Web opt-in confirmation**

   > Uptick Local: You're subscribed to recurring automated promotional texts about your weekly Uptick: usually 1 featured message per week. Msg & data rates may apply. Reply STOP to stop or HELP for help.

4. **Requested phone-number correction verification**

   > Uptick Local: Confirm the new phone number you asked support to use: https://pilot.upticklocal.com/phone-change/[secure-token] This does not subscribe you to promotional texts. Reply STOP to stop texts. HELP for help.

These correspond to the current `memberMessageText` templates. The bracketed token is variable content; never submit or publish a real private token. Twilio requires two to five representative samples, Brand identification in every sample, square brackets for variables, and samples of links if links are sent.

### Requested phone-number correction behavior

1. The signed-in member files a privacy correction request; an operator verifies the original member through the approved account process.
2. The operator records that the change was requested by the member and supplies the proposed new number. The software rejects the account's current number and a number already owned by another account.
3. Uptick creates one encrypted verification challenge and queues the fourth sample only to the proposed new number. The link expires after 15 minutes. This `phone_change` message uses the requested-access delivery class, including `MEMBER_ACCESS_SMS_ENABLED`, and does not use the weekly promotional slot.
4. The proposed number confirms the one-use link. A replay or expired link is rejected.
5. Support applies the correction only while that confirmation is less than 24 hours old and after rechecking that no other account owns the number.
6. Application rotates private pass credentials, revokes existing member sessions, recovery codes, and access links, suppresses queued messages addressed under the old account context, and turns promotional consent off. Issued-benefit identity, state, dates, attribution, and evidence remain historical facts.
7. The member uses a fresh access flow for the new number. Promotional messaging remains off until a fresh affirmative web opt-in.

This is the implemented workflow, not carrier proof. The public-policy working tree now contains this phone-correction sample and explanation together with the other three current samples. Those copy changes have not been published. Deploy and anonymously verify the public page before using it or its screenshots as Campaign evidence.

### Web opt-in confirmation behavior

Current A2P guidance requires `opt_in_message` when a consumer can subscribe by texting a keyword. Uptick does not offer keyword subscription, so the A2P `opt_in_message` field should remain blank. Current A2P guidance does not make a separate SMS confirmation a required field for this documented two-screen web opt-in.

The application now queues the exact third sample above immediately after a newly recorded affirmative web opt-in. Its ledger row is bound to the specific affirmative consent record. It has no access credential, allocation, or week key, so it neither exposes a private link nor consumes the one-Drop-message-per-week slot.

The confirmation is governed by the same current-consent check, quiet hours, sender suppression, program-wide STOP suppression, environment checks, and promotional delivery gate as the weekly promotional notice. Decline, replay, refresh, repeated “on” preferences, and START do not queue it. A later opt-out suppresses a still-queued confirmation. After START clears the provider/application block, only a fresh affirmative web opt-in can create a new confirmation and restore promotional eligibility. These are repository-level facts; the Campaign sample and controlled carrier proof remain required before real delivery is enabled.

## 4. Advanced Opt-Out configuration

Configure these values on the dedicated Uptick Local membership Messaging Service **before enabling Advanced Opt-Out**. Twilio says Advanced Opt-Out is disabled by default, applies to all senders in the service after enablement, and can be disabled only by contacting Twilio Support.

### Keywords and Twilio-managed responses

**Opt-out keywords**

`STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT`

**Opt-out response**

> Uptick Local: You have opted out. No more Uptick Local texts will be sent. Your membership and already issued benefits stay active online.

**Opt-in/unblock keywords**

`START, UNSTOP`

**Opt-in/unblock response**

> Uptick Local: Carrier blocking is removed. Promotional texts remain off until you opt in again in Your Uptick preferences. Reply HELP for help.

**Help keywords**

`HELP, INFO`

**Help response**

> Uptick Local help: visit https://upticklocal.com/sms or email [[TESTED SUPPORT EMAIL]]. Reply STOP to stop texts.

The actual support address must replace the bracket before this is configured. Avoid personal information in provider-managed replies.

### Application response rule

When Twilio sends `OptOutType=STOP`, `START`, or `HELP`, the application should:

1. authenticate the webhook;
2. record the inbound event and update applicable application consent/suppression state;
3. queue HELP for monitored support when needed; and
4. return empty TwiML (`<Response/>`) without another `<Message>`.

For ordinary inbound text without `OptOutType`, the application may store it in the support queue and send one acknowledgement:

> Uptick Local received your message. A support person will review it. Reply STOP to stop texts.

Twilio says the presence of `OptOutType` means Advanced Opt-Out has already matched and replied, and recommends that the application not send another message. See [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).

## 5. Policy and screenshot evidence

### Read-only comparison with the public-policy scratch repository

The September 15 review of `/private/tmp/upticklocal-policy-work` found that its Privacy, Terms, Membership, and SMS concepts remain consistent with the application: requested access is separate from optional promotional consent; START does not create consent; STOP preserves membership and issued benefits; service messages may be sent when requested; members should report a changed number; and merchants do not receive Uptick consent or phone lists.

The public-policy working tree now shows the exact four current application templates with safe placeholder links and explains the 15-minute proposed-number verification, one-use confirmation, 24-hour support application window, prior-access revocation, preserved benefit history, and fresh web opt-in requirement. No remaining copy contradiction was found in that working tree.

The synchronization is a local branch change, not public evidence. The public repository must still be reviewed, deployed, and anonymously verified before its SMS page or screenshots are used in a Campaign submission. No public deployment or Campaign submission occurred during this review.

### Prepared local development captures

The offline rehearsal provides [entry with promotional consent off](demo/screenshots/final/03-entry-form-mobile.png), [simulated access result](demo/screenshots/final/04-simulated-access-mobile.png) and [deliberate membership confirmation](demo/screenshots/final/05-confirm-membership-mobile.png). Desktop counterparts are in the same folder. These are clearly marked sample application captures, use a fictional number, omit browser address bars and are usable for internal copy review. They prove the local flow, not a published consent URL or Twilio approval.

The final canonical-domain screenshots below must be captured after the approved copy is published. Do not submit these localhost rehearsal images as evidence that a live site or sender has been commissioned.

### Required public pages

Before submission, verify all pages return HTTP 200 without login, download, cookie challenge, or redirect to an unrelated domain:

- `https://upticklocal.com`
- `https://upticklocal.com/privacy`
- `https://upticklocal.com/terms`
- `https://upticklocal.com/sms`
- `[[PUBLIC JOIN OR EVIDENCE URL]]`

The Privacy Policy must directly say all three of the following:

1. mobile numbers and messaging opt-in/consent data are not shared with third parties or affiliates for marketing or promotional purposes;
2. “Message frequency varies. A published weekly release may create one featured-benefit notice, and service, transactional, or support activity may create additional messages.”; and
3. “Message and data rates may apply.”

Twilio says a website used for opt-in must provide a public Privacy Policy and Terms, and its reviewers reject a privacy policy that is login-gated, lacks mobile-number non-sharing, or omits frequency/rates disclosures. See [required Campaign information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info) and [Campaign rejection 30908](https://www.twilio.com/docs/api/errors/30908).

### Screenshot set

Capture these after the text and host are final. Use a clean browser window and a test number; redact the number and every private token before hosting evidence.

1. Public business home page with Uptick Local identity and visible domain.
2. First join screen with the empty phone field, required 18+ checkbox, optional promotional checkbox visibly unchecked, full disclosure, and working Privacy/Terms/SMS links.
3. First join screen with promotional checkbox still unchecked immediately before submission, proving the member can continue without it.
4. Request result explaining the one-time access text.
5. Private confirmation screen with the promotional choice and full disclosure; replace the address-bar token with `[REDACTED PRIVATE TOKEN]`.
6. Private confirmation screen with promotional choice off immediately before “Join & open my Uptick.”
7. Public Privacy Policy section containing non-sharing, message frequency, and rates language.
8. Public Terms SMS section containing frequency, rates, STOP, START, HELP, sender identity, and merchant separation.
9. Public SMS program page containing program name, sender, purpose, frequency, rates, STOP, HELP, support contact, policy links, and all four current sample templates, including phone correction.

The public evidence URL must remain available during vetting. Twilio accepts a publicly accessible screenshot URL when the actual opt-in is not public or is gated.

## 6. Callback, delivery, and uncertainty rules

### Webhook endpoints

- Messaging Service inbound webhook, HTTP POST: `https://pilot.upticklocal.com/api/member-twilio/inbound`
- Per-message status callback, HTTP POST: `https://pilot.upticklocal.com/api/member-twilio/status?message=[internal-message-id]`

Keep the canonical HTTPS host and complete query string exact. Twilio signs the URL and all form parameters. The receiver must use Twilio's SDK validator and accept new form parameters because Twilio can add them without notice. See [Secure webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

### Current callback-health evidence scope

Real-enrollment readiness requires a successful authenticated callback for both `inbound` and `status`. Each success is bound to a non-secret hash of:

- the deployed `VERCEL_GIT_COMMIT_SHA`;
- the configured `TWILIO_ACCOUNT_SID`;
- the canonical `APP_URL` used for signature validation;
- `UPTICK_ENV`; and
- the active sender record: internal sender ID, Messaging Service SID, and sending number.

A callback-health success is current for less than seven days. A release, account, origin, environment, active sender, Messaging Service, or sending-number change makes the old success non-current immediately. Both callback kinds must be exercised again on the changed scope. Failed callbacks increment aggregate health counts only after webhook authentication succeeds; a bad signature does not create commissioning evidence. Callback health contains counts, timestamps, a bounded failure code, and the scope hash, not message bodies, phone numbers, or private tokens.

This callback health is only one release gate. The separately recorded Messaging checks are also tied to the current release SHA, schema fingerprint, active sender, the same messaging scope, and a future review date. The operator must record real evidence for `brand_campaign`, `access_receipt`, `promotion_receipt` when promotional delivery is enabled, and `keywords_support`; a local test result cannot satisfy those checks.

### Status meanings

| State                                                     | Safe operator statement                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API returned a valid Message SID / `accepted` or `queued` | “Twilio accepted the request.” This is not carrier delivery.                                                                                           |
| `sent`                                                    | “The upstream carrier accepted the message.” This is not proof the handset displayed it.                                                               |
| `delivered`                                               | “Twilio received delivery confirmation from the upstream carrier and, where available, the destination handset.” This is not proof the person read it. |
| `undelivered` / `failed`                                  | “Twilio reports that delivery did not complete.” Preserve the error code for review.                                                                   |
| local `unknown`                                           | “The provider outcome is uncertain.” Do not retry automatically.                                                                                       |

Twilio warns that status callbacks can arrive out of order because of network latency. The current application stores immutable events, deduplicates a repeated provider-SID/state pair, and moves the visible state only forward. See [Track outbound message status](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status) and the [Messages resource status definitions](https://www.twilio.com/docs/messaging/api/message-resource).

### Unknown-outcome reconciliation

1. Freeze automatic retries for the local `unknown` row.
2. If a Twilio Message SID was saved, fetch that exact Message resource or locate it in Messaging Logs.
3. Compare destination hint, Messaging Service, creation time, body/template, and callback history without exposing the private link.
4. If no SID was returned because the create request timed out, inspect Twilio Messaging Logs for the bounded time window and destination before deciding that no provider message exists.
5. Record the reconciliation evidence and operator identity. A positive Twilio record updates the local state through a controlled reconciliation path; absence of a record does not by itself prove the carrier never received a message.
6. Escalate any possible duplicate to the support owner. Retry only after the operator establishes that a new message is safe and the user still has a valid request/consent.

## 7. Commissioning checklist

### A. Facts and policy

- [ ] Confirm the legal registrant and whether it is Direct Brand, Standard/Low-Volume Standard, or Sole Proprietor.
- [ ] Match legal name and EIN to the federal tax record.
- [ ] Supply business address and authorized representative.
- [ ] Verify the business-domain Brand contact email can complete TCR 2FA.
- [ ] Publish legal identity and notice address on public policies.
- [ ] Deploy the repository's frequency and rates language to the public Privacy Policy and verify it anonymously.
- [ ] Deploy and verify the repository's aligned SMS, Terms/Privacy, join disclosure, and four message templates on the canonical host.
- [ ] Obtain final legal review for the real jurisdictions and workflow.

### B. Evidence and registration preparation

- [ ] Keep public enrollment closed while collecting redacted evidence.
- [ ] Capture and host the nine screenshots above.
- [ ] Verify every evidence/policy URL in an anonymous browser.
- [ ] Review, deploy, and anonymously verify the synchronized public SMS page and all four current samples before capturing evidence.
- [ ] Create or approve the Twilio Primary Compliance Profile.
- [ ] Register the Brand with only verified external facts.
- [ ] Create a dedicated Uptick Local membership Messaging Service.
- [ ] Buy/select a dedicated US 10DLC sender and add it to that service.
- [ ] Replace every `[[BRACKETED FIELD]]` in this package.
- [ ] Compare the final Campaign description, message flow, samples, URLs, and checkboxes to the deployed application one final time.
- [ ] Obtain explicit user authorization before submitting the Campaign, because submission incurs fees and external review.

### C. Advanced Opt-Out and support

- [ ] Configure all STOP, START, and HELP keywords and responses before enabling Advanced Opt-Out.
- [ ] Confirm the configuration applies only to the intended dedicated membership Messaging Service/sender pool.
- [ ] Prove an `OptOutType` webhook receives one Twilio-managed reply and the application returns empty TwiML without a second reply.
- [ ] Set and test `[[SUPPORT EMAIL]]`.
- [ ] Assign primary and backup support owners, hours, response target, and escalation route.
- [ ] Verify ordinary inbound text creates one support item and one acknowledgement.

### D. Controlled internal carrier test

- [ ] Keep real enrollment closed.
- [ ] Use staging, the dedicated approved Campaign/service/sender, and only explicitly authorized `INTERNAL_TEST_NUMBERS`.
- [ ] Send one requested access message with promotional consent off.
- [ ] Verify API acceptance, signed status callback, actual handset receipt, and private-link behavior as separate facts.
- [ ] Complete the private confirmation with promotional consent off and verify no weekly message eligibility.
- [ ] From a verified member-requested correction, send one phone-change verification only to the authorized proposed number; prove the 15-minute expiry, one-use confirmation, support application within 24 hours, old-access revocation, preserved benefit history, and promotional consent reset.
- [ ] Repeat with promotional consent on and verify the saved disclosure/version/source.
- [ ] Verify the web opt-in confirmation is sent once after a new affirmative choice, is linked to that consent record, and does not count as the weekly message.
- [ ] Verify decline, replay, refresh, and repeated “on” preferences do not send another confirmation.
- [ ] Send one weekly notice and verify the approved sample matches.
- [ ] Test STOP and verify one provider confirmation, provider/application suppression, preserved membership, and preserved issued benefit.
- [ ] Test a requested access attempt while provider-blocked; confirm it is suppressed and does not evade STOP by rotating senders.
- [ ] Test START and verify one provider confirmation, cleared carrier block, and promotional consent still false.
- [ ] Re-opt in through the web UI and verify only that fresh action restores recurring consent.
- [ ] Test HELP and verify one provider response plus a monitored support item.
- [ ] Test ordinary text and verify one application acknowledgement plus a monitored support item.
- [ ] Replay duplicate and out-of-order status callbacks and verify one monotonic final state.
- [ ] Exercise an uncertain provider create outcome and reconcile it without blind retry.
- [ ] Record Twilio Campaign ID, Brand SID, Messaging Service SID, sender number, approval state, test date, tester, Message SIDs, callback evidence, handset receipt evidence, and any incident.

### E. Production gate

- [ ] Campaign status is verified and the 10DLC number is registered to the approved Campaign/Messaging Service.
- [ ] Policy and signup URLs still match the approved evidence.
- [ ] Support coverage is active.
- [ ] `UPTICK_ENV=production`, `SMS_TRANSPORT=twilio`, production secrets, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and the canonical HTTPS `APP_URL` are configured for the exact deployed release.
- [ ] `MESSAGING_APPROVED` and `LEGAL_APPROVED` reflect completed external reviews rather than operator intent.
- [ ] A named operator reviews the real-recipient scope before the bounded `PRODUCTION_DELIVERY_ENABLED=true` commissioning window. Keep public enrollment closed, verify the queue, and turn the global switch off immediately if the test fails.
- [ ] Set `MEMBER_ACCESS_SMS_ENABLED=true` only for the authorized requested-access and phone-correction test window; retain it only after both paths pass.
- [ ] Set `MEMBER_PROMOTIONAL_SMS_ENABLED=true` only for the authorized opt-in confirmation, weekly notice, STOP, START, HELP, quiet-hours, and fresh re-opt-in test window; retain it only after every applicable path passes.
- [ ] Record current inbound and status callback successes for the exact release, account, origin, environment, Messaging Service, and sender; repeat them after any scoped change and before either success reaches seven days old.
- [ ] Open enrollment only after the provider, legal, support, supply, and operator gates are all complete.

## 8. Official Twilio sources

- [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy) — consent, proof, message-subject limits, sender identity, initial-message opt-out language, and revocation.
- [A2P 10DLC overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc) — registration scope, customer/Brand types, and use-case categories.
- [Gather the Required Business Information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info) — exact Brand fields, Campaign fields, URL requirements, message-flow limits, samples, and keyword fields.
- [A2P registration quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart) — Console prerequisites, verifiable opt-in, sample-message review, and sender association.
- [Direct Standard and Low-Volume Standard registration](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/direct-standard-onboarding) — direct-customer registration sequence and review.
- [A2P UsAppToPerson resource](https://www.twilio.com/docs/messaging/api/usapptoperson-resource) — Campaign field meanings and limits. The API itself is for ISV onboarding; Direct Brands should use the Console flow.
- [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out) — keyword configuration, provider blocking, `OptOutType`, and avoiding duplicate application replies.
- [Secure webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security) — HTTPS, signature validation, exact URLs, and evolving parameter sets.
- [Track outbound message status](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status) — status callbacks and out-of-order delivery.
- [Messages resource](https://www.twilio.com/docs/messaging/api/message-resource) — accepted, queued, sent, delivered, undelivered, and failed meanings.
- [Campaign rejection 30896](https://www.twilio.com/docs/api/errors/30896), [30908](https://www.twilio.com/docs/api/errors/30908), [30923](https://www.twilio.com/docs/api/errors/30923), [30925](https://www.twilio.com/docs/api/errors/30925), and [30931](https://www.twilio.com/docs/api/errors/30931) — current opt-in, privacy, service-separation, unchecked-consent, and voluntary-choice review rules.

No SMS was sent, no Twilio setting was changed, and no Brand or Campaign was submitted while preparing this package. No real sender, A2P approval, provider receipt, callback receipt, or handset receipt is claimed.
