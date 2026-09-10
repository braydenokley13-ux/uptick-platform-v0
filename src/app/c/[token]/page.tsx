import { getDb } from "@/lib/db";
import { sourceOffer, offerAvailable, disclosure } from "@/lib/domain";
import { Brand, CoffeeArt, Footer, Location } from "@/components/ui";
import { ClaimForm } from "@/components/forms";
import { MapPin } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let result;
  try {
    result = await sourceOffer(await getDb(), token);
  } catch {
    return <Unavailable />;
  }
  const { offer, source } = result;
  if (!offerAvailable(offer)) return <Unavailable />;
  return (
    <div className="customer-page">
      <header className="customer-header">
        <Brand />
        <span className="eyebrow">GOOD THINGS, RIGHT AROUND THE CORNER.</span>
      </header>
      {offer.is_demo && (
        <div className="demo-notice">
          ILLUSTRATIVE LOCAL PILOT · NO REAL OFFER OR SMS DELIVERY
        </div>
      )}
      <main id="main">
        <div className="customer-layout">
          <section className="offer-story">
            <span className="host-pill">
              <MapPin size={12} />
              {source.host ? `Found at ${source.host}` : "A good thing nearby"}
            </span>
            <p className="merchant-name">{offer.merchant}</p>
            <h1>
              {offer.qualification}.<em>{offer.reward}.</em>
            </h1>
            <p className="lead">
              A private pass for your next stop. Show it at the counter after
              your qualifying purchase.
            </p>
            <Location address={offer.address} />
            <CoffeeArt />
          </section>
          <section className="claim-card">
            <h2>Make it yours.</h2>
            <p className="muted">One number. One private pass. That’s it.</p>
            <ClaimForm
              sourceToken={token}
              merchant={offer.merchant}
              disclosures={{
                fulfillment: disclosure("fulfillment", offer.merchant),
                merchant: disclosure("merchant", offer.merchant),
                network: disclosure("network", offer.merchant),
              }}
            />
          </section>
        </div>
        <div className="offer-terms">
          <details>
            <summary>The simple terms</summary>
            <p>{offer.terms}</p>
            <p>
              Expires{" "}
              {new Date(offer.expires_at).toLocaleString("en-US", {
                timeZone: offer.timezone,
                month: "long",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              ({offer.timezone}).{" "}
              {offer.limit_mode === "redemption"
                ? `Limited to the first ${offer.quantity} completed redemptions. Claiming does not reserve inventory.`
                : offer.limit_mode === "claim"
                  ? `Limited to ${offer.quantity} claims. An item is reserved when your claim is accepted.`
                  : "One pass per customer for this offer."}
            </p>
          </details>
        </div>
      </main>
      <Footer />
    </div>
  );
}
function Unavailable() {
  return (
    <div className="customer-page">
      <header className="customer-header">
        <Brand />
      </header>
      <main id="main" className="policy-page">
        <p className="eyebrow">THIS OFFER ISN’T AVAILABLE</p>
        <h1>
          Good things
          <br />
          <em>come and go.</em>
        </h1>
        <p>
          This QR is no longer accepting claims. If you already have a pass,
          open the private link in your text to check its status.
        </p>
      </main>
      <Footer />
    </div>
  );
}
