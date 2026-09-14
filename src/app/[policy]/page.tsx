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
              backed featured benefit, support fulfillment, and manage optional
              text messages.
            </p>
            <h2>What we collect</h2>
            <p>
              Membership and admission status, the benefit issued to you, the
              public source associated with the membership, claim and redemption
              records, consent choices, and message delivery status if you opt
              into SMS. We use limited request information to protect the
              service from abuse. We do not need your name, precise location,
              receipt photos, or contact list.
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
              Uptick Local Membership SMS is optional and separate from
              membership access. We do not sell or share your mobile opt-in
              information for third parties’ independent marketing. Twilio
              processes messaging data to send texts and report status.
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
            <h2>No SMS or purchase requirement</h2>
            <p>
              Member access is available through the private web experience.
              Optional Uptick Local SMS is not required for membership, and no
              purchase is required to use the featured benefit.
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
              If you opt into Uptick Local Membership SMS, a message may include
              a private link to your issued benefit. Web access remains
              available without SMS. Message and data rates may apply. Delivery
              depends on your carrier and cannot be guaranteed.
            </p>
            <h2>Featured-benefit and service messages</h2>
            <p>
              Members who opt in may receive a notice when a featured weekly
              benefit is published. Service, transactional, or support activity
              may create additional messages. Message frequency varies. Uptick
              SMS consent does not become consent for a participating merchant.
            </p>
            <h2>Stop, start, and help</h2>
            <p>
              Reply STOP to stop Uptick Local Membership texts. STOP preserves
              membership and already issued benefits, which remain available
              through the private web experience. Reply START to ask the carrier
              to remove its sender block. START does not provide SMS consent,
              enroll a member, or restore any marketing choice. Reply HELP for
              the configured support response.
            </p>
            <p>
              A participating merchant does not receive Uptick membership
              consent or operate a member list through Uptick.
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
