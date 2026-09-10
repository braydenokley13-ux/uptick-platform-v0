# Twilio setup and pilot decisions

Official documentation reviewed on September 10, 2026. This is an implementation record, not a legal opinion. Registration and policy language must describe the actual businesses and program.

## Required platform constraints

US application-to-person traffic over ten-digit local numbers requires the appropriate A2P Brand and Campaign registration. Twilio distinguishes direct customers from ISVs acting for customers. Uptick and the pilot merchant are separate businesses, so do not assume registering only Uptick’s brand authorizes an independent merchant’s promotional program. Use the customer registration flow appropriate to that relationship and confirm it with Twilio before launch. [A2P overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc), [ISV onboarding](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv).

Low-Volume Standard / mixed-use registration may suit the pilot’s volume and combined requested-pass/promotional use, but eligibility, business identity, campaign use case, and approval must be established with Twilio. Do not substitute a fabricated legal identity, policy URL, or traffic description. [Required business information](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info), [ISV Standard / Low-Volume Standard guide](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api).

Incoming webhooks are authenticated with Twilio’s SDK, using the complete canonical URL (including the status correlation query), all form parameters, the X-Twilio-Signature header, and the account auth token. The route also checks AccountSid. Do not change the callback hostname behind the proxy without updating APP_URL. [Webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

Provider acceptance, sent, and carrier-delivered states are separate. Callbacks may be duplicated or arrive out of order. Uptick stores callback history and prevents lower-ranked statuses from reversing later outcomes. An uncertain create-message response is quarantined for reconciliation, never automatically resent. [Outbound message status](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Advanced Opt-Out supplies `OptOutType` to the configured webhook and can send the relevant keyword response itself. Uptick returns empty TwiML to avoid duplicating it. Configure HELP to name the program and give the real support contact. START removes the provider/sender block; Uptick intentionally requires a new merchant marketing choice rather than silently restoring every subscription. [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).

## Our architectural choices

- One configured Messaging Service/sender for the first merchant. Sender configuration is merchant data, not hardcoded in the transport. Reevaluate the registration and sender relationship before merchant #2; the database currently requires distinct Messaging Service SIDs per merchant to avoid ambiguous STOP routing.
- Message-body identity uses “{merchant} via Uptick.” It does not promise an arbitrary branded US sender name.
- Requested fulfillment, merchant promotion, and network promotion are separate consent purposes with exact disclosure text, version, decision, UI source, phone and timestamp.
- Optional claim-time marketing choices remain pending until the customer explicitly saves the displayed merchant and network choices on their private pass. Opening or redeeming alone grants no marketing permission. GET requests/link previews never confirm possession.
- One promotional merchant Drop per merchant-local calendar week, Monday–Sunday; no second active broadcast for that merchant/week. Requested claim texts and HELP/STOP are outside this cap.
- Promotional dispatch is between 9 AM and 8 PM merchant-local time. This is a conservative V0 product window, not a claim about every recipient’s jurisdiction or local timezone.
- A STOP also prevents service-pass sends from the affected sender. We never switch numbers to bypass suppression. Merchant-specific web unsubscribe controls the merchant subscription separately.
- Network subscription capture exists, but network promotional broadcasting is deferred.

## Exact configuration steps

1. Obtain the real merchant business registration details, Uptick’s platform details, public production privacy/terms/SMS pages, support contact, representative samples and actual opt-in screenshots.
2. Register the appropriate customer Brand/Campaign through the ISV flow. Confirm whether the pilot’s requested offer and optional marketing should share the approved mixed campaign. Wait for approval.
3. Create/configure the Messaging Service and add its approved sender number. Configure Advanced Opt-Out and the support response.
4. In Uptick operator setup, enter the merchant’s `MG…` Messaging Service SID, its `+1…` sender number, and mark approval only after it exists. Account SID and auth token remain server environment secrets.
5. Set inbound webhook to `https://YOUR-CANONICAL-HOST/api/twilio/inbound`, HTTP POST. Ensure MessagingServiceSid/To routes to the configured sender.
6. The application supplies a status callback per message: `https://YOUR-CANONICAL-HOST/api/twilio/status?message={internalMessageId}`. Preserve its query when configuring a proxy. Do not substitute a generic callback without the correlation ID.
7. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SMS_TRANSPORT=twilio`, `MESSAGING_APPROVED=true`, `LEGAL_APPROVED=true`, and HTTPS `APP_URL`. Keep local mode disabled and use real, non-demo business records.
8. With an approved internal test number and controlled real-business offer, verify accepted → sent → delivered, STOP → no attempted sends, START → sender unblock, fresh web opt-in, HELP response, invalid signature rejection, and duplicated callbacks.
9. Run the scheduled Drop test, check delivery status in the operator view and Twilio console, then complete the launch checklist.

No actual carrier messages or registration submissions were made during this build. No credentials, registration approval, support address, legal review, or DNS should be inferred from the local development experience.
