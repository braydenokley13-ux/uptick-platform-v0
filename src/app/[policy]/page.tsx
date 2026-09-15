import { notFound } from "next/navigation";
import Link from "next/link";
import { Brand, Footer } from "@/components/ui";
export default async function Policy({
  params,
}: {
  params: Promise<{ policy: string }>;
}) {
  const { policy } = await params;
  if (!["privacy", "terms", "sms"].includes(policy)) notFound();
  const approved = process.env.LEGAL_APPROVED === "true";
  const support = process.env.SUPPORT_EMAIL?.trim() || "iwhite@upticklocal.com";
  return (
    <div className="customer-page">
      <header className="customer-header">
        <Brand />
      </header>
      <main id="main" className="policy-page">
        <p className="eyebrow">UPTICK LOCAL · CUSTOMER TRUST</p>
        <h1>
          {policy === "privacy"
            ? "Your privacy matters."
            : policy === "terms"
              ? "Simple offers. Clear terms."
              : "Texts, passes & getting help."}
        </h1>
        {!approved && (
          <div className="policy-notice">
            Pilot enrollment is unavailable until the operating legal identity,
            notice address, launch process, and required review are finalized.
          </div>
        )}
        {policy === "privacy" && (
          <>
            <p>
              Uptick operates a bounded local membership pilot. This page
              explains the information used to admit adult members, issue a
              backed featured benefit, support fulfillment, send a requested
              access text, and manage separately chosen promotional messages.
            </p>
            <h2>What we collect</h2>
            <p>
              Membership and admission status, the benefit issued to you, the
              public source associated with the membership, claim and redemption
              records, consent choices, and message delivery status for
              requested access or optional promotional SMS. We use limited
              request information to protect the service from abuse. We do not
              need your name, precise location, receipt photos, or contact list.
            </p>
            <h2>How information is used</h2>
            <p>
              We issue the featured benefit through the private member web
              experience, record its redemption, honor optional messaging
              preferences, help with problems, and report observed fulfillment
              activity.
            </p>
            <h2>Who can access it</h2>
            <p>
              Uptick’s authorized operators and service providers process
              information to operate the platform. A participating location sees
              only the limited information needed to fulfill a current benefit
              and its own operational results. It does not receive phone
              numbers, SMS consent, acquisition history, or cross-location
              member history. There is no merchant member-history export.
            </p>
            <h2>Text message consent</h2>
            <p>
              Entering your own mobile number and submitting an access request
              asks Uptick Local to send one secure access link. That requested
              informational message does not create recurring promotional
              consent. Recurring automated Uptick Local promotional texts are a
              separate, optional choice presented with an unchecked checkbox.
            </p>
            <p>
              Mobile numbers and messaging opt-in or consent data are not shared
              with third parties or affiliates for marketing or promotional
              purposes. Twilio processes messaging data to send Uptick Local
              texts and report status.
            </p>
            <p>
              Message frequency varies. A published weekly release may create
              one featured-benefit notice, and service, transactional, or
              support activity may create additional messages. Message and data
              rates may apply.
            </p>
            <h2>Retention and your choices</h2>
            <p>
              Offer, redemption, and consent history are retained for operating
              records and dispute handling. The production retention schedule
              and deletion procedure require review before launch. You can reply
              STOP to end Uptick Local texts. STOP preserves membership and
              already issued benefits. START only asks the carrier to remove its
              sender block; it does not create consent or enroll you.
            </p>
            <h2>Privacy requests</h2>
            <p>
              Use the support contact below to request access, correction, or
              deletion. Verification may be needed to protect the accountless
              pass system.
            </p>
          </>
        )}
        {policy === "terms" && (
          <>
            <p>
              Uptick Local is a bounded free pilot for admitted adults. Each
              published weekly release provides one featured benefit backed by
              approved supply. The fulfilling location provides the item or
              perk; Uptick provides the member access, claim, redemption, and
              optional messaging experience.
            </p>
            <p>
              The pilot targets 150 admitted members and has a hard cap of 200.
              There is no fixed membership fee.
            </p>
            <h2>Your offer</h2>
            <p>
              The item or perk, location, quantity rule, and expiration shown on
              your pass are the terms of that benefit. No purchase or member
              payment is required. One backed entitlement is issued per eligible
              admitted member for a published weekly release. Keep your pass
              link private: anyone with it may be able to use it.
            </p>
            <h2>At the counter</h2>
            <p>
              Follow the displayed instructions and redeem with staff as
              directed. A completed redemption closes the pass. It cannot be
              reused or reset by the member.
            </p>
            <h2>Availability and changes</h2>
            <p>
              New releases may be paused. Pausing a release preserves
              already-issued valid benefits. Each issued benefit is backed by
              approved supply; opening or claiming it does not consume another
              unit. Contact support if a location cannot honor an issued benefit
              so the recorded recovery process can be used.
            </p>
            <h2>Requested access and optional promotional SMS</h2>
            <p>
              Submitting your own mobile number asks Uptick Local to send one
              secure access link. That requested message is separate from
              recurring automated promotional texts. The promotional choice is
              optional and unchecked; declining it does not block membership or
              an already issued benefit. No purchase is required to join or use
              the featured benefit.
            </p>
            <p>
              Promotional message frequency varies. A published weekly release
              may create one featured-benefit notice, and service,
              transactional, or support activity may create additional messages.
              Message and data rates may apply. Reply STOP to stop texts or HELP
              for help.
            </p>
            <h2>Using the service</h2>
            <p>
              Do not share or sell private passes, automate abusive requests,
              interfere with the service, or attempt to redeem an offer more
              than once. Uptick may restrict misuse. Additional legal terms,
              business identification, governing law, and dispute procedures
              require review before production launch.
            </p>
          </>
        )}
        {policy === "sms" && (
          <>
            <p>
              Uptick Local sends messages to Uptick Local members. A
              participating merchant may fulfill a benefit, but it does not
              become the sender or receive the member’s phone number or Uptick
              Local SMS consent for its own marketing.
            </p>
            <h2>Your requested access link</h2>
            <p>
              Entering your own mobile number and submitting an access request
              asks Uptick Local to send one secure access link. This is a
              requested informational message. It does not create recurring
              promotional consent, and Uptick sends it even when the optional
              promotional checkbox remains unchecked. Message and data rates may
              apply. Delivery depends on your carrier and cannot be guaranteed.
            </p>
            <h2>Optional promotional messages</h2>
            <p>
              Members who separately select the optional, initially unchecked
              promotional checkbox and confirm that choice on the private access
              page may receive recurring automated promotional texts. Message
              frequency varies. A published weekly release may create one
              featured-benefit notice, and service, transactional, or support
              activity may create additional messages. Message and data rates
              may apply.
            </p>
            <h2>Stop, start, and help</h2>
            <p>
              Reply STOP to stop Uptick Local texts. STOP preserves membership
              and already issued benefits, which remain available through the
              private web experience. Reply START to ask the carrier to remove
              its sender block. START does not provide SMS consent, enroll a
              member, or restore any promotional choice. Reply HELP for help or
              contact the support address below.
            </p>
            <p>
              Uptick does not offer keyword opt-in. Texting START or another
              keyword does not subscribe you to recurring promotional texts;
              that choice must be made through the private Uptick web flow.
            </p>
            <p>
              A participating merchant does not receive member phone numbers or
              Uptick Local SMS consent, and it does not operate an Uptick member
              list.
            </p>
            <h2>Didn’t get your text?</h2>
            <p>
              Check that you entered the right number, allow a few moments for
              delivery, and check whether you previously replied STOP. Contact
              Uptick with your phone number through the verified support
              channel. Never post your full private pass link publicly.
            </p>
            <h2>Pass expired or redeemed accidentally?</h2>
            <p>
              Keep the pass reference and contact support. Operators can inspect
              its history. The application does not automatically reverse a
              redemption or invent a replacement promise.
            </p>
          </>
        )}
        <h2>Contact</h2>
        <p>
          <a href={`mailto:${support}`}>{support}</a>
          {process.env.BUSINESS_LEGAL_NAME && (
            <> · {process.env.BUSINESS_LEGAL_NAME}</>
          )}
        </p>
        <p>
          <Link href="/privacy">Privacy</Link> ·{" "}
          <Link href="/terms">Terms</Link> · <Link href="/sms">SMS & help</Link>
        </p>
      </main>
      <Footer />
    </div>
  );
}
