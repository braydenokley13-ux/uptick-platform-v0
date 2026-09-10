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
  const support = process.env.SUPPORT_EMAIL;
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
            Pilot policy draft — requires business details and legal review
            before real customer launch. Messaging remains gated until approved.
          </div>
        )}
        {policy === "privacy" && (
          <>
            <p>
              Uptick operates a local offer platform on behalf of participating
              businesses. This page explains the information used to deliver a
              requested offer and manage optional text subscriptions.
            </p>
            <h2>What we collect</h2>
            <p>
              Your mobile phone number, the offer you request, the public source
              associated with the offer, claim and redemption records, consent
              choices, and message delivery status. We use limited request
              information to protect the service from abuse. We do not need your
              name, precise location, receipt photos, or contact list.
            </p>
            <h2>How information is used</h2>
            <p>
              We deliver the pass you request, record its redemption, honor your
              messaging preferences, help with problems, and report observed
              offer activity. Marketing subscriptions are separate from
              requesting a pass.
            </p>
            <h2>Who can access it</h2>
            <p>
              Uptick’s authorized operators and service providers process
              information to operate the platform. A merchant’s normal dashboard
              masks phone numbers. An authorized merchant export contains only
              that merchant’s currently consented contacts and supporting
              consent and suppression evidence. Merchants do not receive another
              merchant’s customer relationships.
            </p>
            <h2>Text message consent</h2>
            <p>
              Consent to a merchant’s Weekly Drop and consent to Uptick network
              offers are separate choices. We do not sell or share your mobile
              opt-in information for third parties’ independent marketing.
              Twilio processes messaging data to send texts and report status.
            </p>
            <h2>Retention and your choices</h2>
            <p>
              Offer, redemption, and consent history are retained for operating
              records and dispute handling. The production retention schedule
              and deletion procedure require review before launch. You can
              change subscriptions through your private pass or reply STOP to
              stop messages from the sender.
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
              Uptick connects customers with offers from participating local
              businesses. The merchant provides the goods or services and checks
              the qualifying purchase. Uptick provides the claim, pass, and
              messaging experience.
            </p>
            <h2>Your offer</h2>
            <p>
              The qualification, free reward, location, quantity rule, and
              expiration shown on your pass are the terms of that offer. One
              entitlement is issued per phone number and offer. Keep your pass
              link private: anyone with it may be able to use it.
            </p>
            <h2>At the counter</h2>
            <p>
              Make the required purchase, show the cashier your receipt, and tap
              Redeem with the cashier watching. A completed redemption closes
              the pass. It cannot be reused or reset by the customer.
            </p>
            <h2>Availability and changes</h2>
            <p>
              New claims may be paused. Pausing an offer normally preserves
              already-issued valid passes. Offers limited by completed
              redemptions do not reserve inventory when claimed; that limit is
              shown on the offer and pass. Contact support if a merchant cannot
              honor an issued offer.
            </p>
            <h2>No marketing requirement</h2>
            <p>
              You can request a pass without joining any promotional
              subscription. Optional marketing consent is not a condition of
              purchase.
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
              Messages identify the participating merchant “via Uptick.” A US
              sender number does not display an arbitrary brand name; look for
              that identification in the message body.
            </p>
            <h2>Your requested pass</h2>
            <p>
              When you choose to text yourself an offer pass, you request a
              service message with a private link. Message and data rates may
              apply. Delivery depends on your carrier and cannot be guaranteed.
            </p>
            <h2>Weekly Drop and network offers</h2>
            <p>
              Merchant Weekly Drop subscriptions are optional and limited to at
              most one promotional Drop per week for that merchant in V0. Uptick
              network offers are a separate optional subscription, up to one
              promotional text per week. The V0 network broadcast feature is not
              enabled.
            </p>
            <h2>Stop, start, and help</h2>
            <p>
              Reply STOP to stop texts from the sending program. This stops
              requested-pass texts as well as promotional texts from that
              sender. Reply START to remove the sender block; then choose any
              merchant subscriptions again through a private pass. Reply HELP
              for the configured support response.
            </p>
            <p>
              You can unsubscribe from an individual merchant’s Weekly Drop
              using “Your Drops & preferences” on your private pass. That
              controls this merchant subscription; it does not undo a
              sender-level STOP.
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
        {support ? (
          <p>
            <a href={`mailto:${support}`}>{support}</a>
            {process.env.BUSINESS_LEGAL_NAME && (
              <> · {process.env.BUSINESS_LEGAL_NAME}</>
            )}
          </p>
        ) : (
          <p>
            The verified support address and legal business identity have not
            been configured for this local pilot. Real messaging is not ready to
            launch.
          </p>
        )}
        <p>
          <Link href="/privacy">Privacy</Link> ·{" "}
          <Link href="/terms">Terms</Link> · <Link href="/sms">SMS & help</Link>
        </p>
      </main>
      <Footer />
    </div>
  );
}
