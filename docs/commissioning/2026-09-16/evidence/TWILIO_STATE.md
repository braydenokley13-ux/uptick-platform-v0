# Twilio state — 2026-09-16 (read-only inventory)

Nothing in this account was created, modified or deleted. The rejected campaign
was not resubmitted and no replacement campaign was created.

Account SID AC<redacted — see release-evidence directory> (CLI profile "uptick-local")
CLI twilio-cli/6.2.4

## Brand — APPROVED

SID BN7289830871d782bb38b08eaa2a283b44
Type STANDARD
Status APPROVED
identityStatus VERIFIED
TCR ID BL1EFQE
Customer profile BUa554a9772b71cf67d484c0e7eb72727e
A2P profile BU86768fd7ece526e3da70f5af7428ffaf
failureReason null
errors null
skipAutomaticSecVet true
Created 2026-09-02, last updated 2026-09-10.

## Campaign — NONE EXISTS

twilio api:messaging:v1:services:us-app-to-person:list
--messaging-service-sid MGad1b0b78971cab175b42420c8f8f1be1

returns an empty list: exit status 0, zero bytes of output, no error. There is
no A2P 10DLC campaign on the messaging service.

The messaging service still reports `usAppToPersonRegistered: true` while its
`usecase` is `undeclared`. Those two facts and an empty campaign list are
consistent with a campaign that existed, was rejected, and was removed — which
matches the known 30882 rejection history. This is an inference from the
current state, not a retrieved rejection record: the rejection reason itself is
no longer readable through the API, because the object carrying it is gone.

## Messaging Service

SID MGad1b0b78971cab175b42420c8f8f1be1
usecase undeclared
usAppToPersonRegistered true (stale relative to the empty campaign list)
inboundRequestUrl null
statusCallback null
useInboundWebhookOnNumber true
stickySender true, smartEncoding true, validityPeriod 36000

## Sender

Phone +19144915169
SID PNfeae8468f358cafa8dfde80a3d99c18e
Capabilities SMS, MMS, voice
status in-use
smsUrl "" (empty)
statusCallback null

## What this means

1. Real A2P 10DLC traffic to US mobile numbers cannot be sent. An approved Brand
   without a campaign is not a sending permission — carriers filter unregistered
   traffic. This blocks real SMS to internal testers too, not only to the public:
   the constraint is at the carrier, and an internal tester's handset is behind
   the same carrier filter as anyone else's.

2. Even if a campaign existed, inbound would not reach the application.
   `useInboundWebhookOnNumber` is true, which routes inbound to the number's own
   `smsUrl` — and that field is empty. STOP, START and HELP would be handled by
   Twilio's own defaults and the application would never see them. Nothing would
   be written to member_inbound_events, member_suppressions or
   member_global_suppressions.

3. No status callback is configured on either the service or the number, so
   delivery outcomes cannot be recorded. member_callback_health has nothing to
   observe, and the readiness gate that requires a current signed status callback
   cannot be satisfied by provider traffic.

## The exact remaining provider steps (not taken here)

These were deliberately left undone. Steps 2 and 3 are configuration changes to
a live provider resource and step 1 is explicitly withheld pending authorization.

1. Create an A2P 10DLC campaign against brand BN7289830871d782bb38b08eaa2a283b44
   with a use case and sample messages that address the prior 30882 rejection.
   REQUIRES EXPLICIT AUTHORIZATION — the campaign was rejected before, and both
   resubmitting it and creating a replacement to sidestep the rejection are
   outside what this campaign was permitted to do. Counsel review of the message
   flow and consent language should precede it.

2. Set the inbound webhook. Either set the number's smsUrl to
   <APP_URL>/api/member-twilio/inbound, or set the Messaging Service
   inboundRequestUrl and turn useInboundWebhookOnNumber off. Point it at the
   normal application, never at the demo host.

3. Set the status callback to <APP_URL>/api/member-twilio/status.

4. Decide on Advanced Opt-Out. The application already declines to send its own
   keyword reply when Twilio reports it handled one (`shouldReply:
!fields.OptOutType`), so both can coexist without double-replying — but which
   one owns the wording is a compliance decision, not a technical one.
