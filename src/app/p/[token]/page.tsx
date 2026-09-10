import Link from "next/link";
import { getDb } from "@/lib/db";
import { getPass, passState, getClaimChoices } from "@/lib/domain";
import {
  Brand,
  Badge,
  Footer,
  Steps,
  Location,
  SuccessIcon,
} from "@/components/ui";
import { PassActions } from "@/components/forms";
export const dynamic = "force-dynamic";
export default async function PassPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = await getDb();
  let claim;
  try {
    claim = await getPass(db, token);
  } catch {
    return (
      <div className="customer-page">
        <header className="customer-header">
          <Brand />
        </header>
        <main className="policy-page" id="main">
          <h1>Let’s find your pass.</h1>
          <p>
            This private link isn’t valid. Open the complete pass link from your
            Uptick text.
          </p>
          <Link className="text-link" href="/sms">
            Get help →
          </Link>
        </main>
        <Footer />
      </div>
    );
  }
  const state = passState(claim),
    o = claim.snapshot;
  const requestedChoices = await getClaimChoices(db, claim.id);
  const subs = await db.query<{ scope: string; state: string }>(
    "select scope,state from subscriptions where customer_id=$1 and scope in ($2,'network')",
    [claim.customer_id, claim.organization_id],
  );
  return (
    <div className="customer-page">
      <header className="customer-header">
        <Brand />
        <span className="eyebrow">A LITTLE SOMETHING, ON THE HOUSE.</span>
      </header>
      {o.is_demo && (
        <div className="demo-notice">
          LOCAL TEST PASS · NO REAL PURCHASE OR FREE ITEM
        </div>
      )}
      <main id="main" className="pass-wrap">
        <article className={`pass-card state-${state}`}>
          <div className="pass-top">
            <p className="eyebrow">
              {claim.broadcast_id ? "YOUR WEEKLY DROP" : "YOUR UPTICK PASS"}
            </p>
            <div>
              <strong>{o.merchant}</strong>
              <Badge
                tone={
                  ["active", "redeemed"].includes(state) ? "mint" : "neutral"
                }
              >
                {state === "redeemed"
                  ? "Redeemed"
                  : state === "upcoming"
                    ? "Starts soon"
                    : state === "invalidated"
                      ? "Unavailable"
                      : state}
              </Badge>
            </div>
          </div>
          <div className="pass-body">
            <p className="eyebrow">SOMETHING GOOD IS YOURS</p>
            <h1>
              <em>{o.reward.replace(/^Get a /, "").replace(/^Get /, "")}.</em>
            </h1>
            <p className="qualification">{o.qualification}.</p>
            <Location address={o.address} />
            {state === "redeemed" ? (
              <div className="redeemed-banner" role="status">
                <SuccessIcon />
                <h2>
                  Enjoy your{" "}
                  {o.reward.toLowerCase().includes("coffee")
                    ? "coffee"
                    : "free extra"}
                  .
                </h2>
                <p>
                  Redeemed ·{" "}
                  {new Date(claim.redeemed_at!).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                    timeZone: o.timezone,
                  })}
                </p>
                <p className="eyebrow">
                  THIS PASS IS CLOSED · ONE REDEMPTION RECORDED
                </p>
              </div>
            ) : (
              <>
                <div className="ticket-divider" />
                {state === "active" ? (
                  <Steps />
                ) : (
                  <div className="empty">
                    <h3>
                      {state === "expired"
                        ? "This offer has ended."
                        : state === "upcoming"
                          ? "Something to look forward to."
                          : "This pass is unavailable."}
                    </h3>
                    <p>
                      {state === "upcoming"
                        ? `Available from ${new Date(o.starts_at).toLocaleString("en-US", { timeZone: o.timezone })}.`
                        : "Check your latest Uptick text for another offer, or visit support."}
                    </p>
                  </div>
                )}
              </>
            )}
            <div className="pass-details">
              <div>
                <span>Valid through</span>
                <strong>
                  {new Date(o.expires_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: o.timezone,
                  })}
                </strong>
              </div>
              <div>
                <span>Pass reference</span>
                <strong>UP-{claim.id.slice(-6).toUpperCase()}</strong>
              </div>
              <details>
                <summary>Offer terms</summary>
                <p>{o.terms}</p>
                {o.limit_mode === "redemption" && (
                  <p>
                    First {o.quantity} completed redemptions only. This pass
                    does not reserve an item.
                  </p>
                )}
                <p>Local time: {o.timezone}</p>
              </details>
            </div>
            <div style={{ marginTop: 24 }}>
              <PassActions
                requestedChoices={requestedChoices}
                token={token}
                state={state}
                opened={!!claim.opened_at}
                merchant={o.merchant}
                subscribed={subs.some(
                  (x) =>
                    x.scope === claim.organization_id &&
                    x.state === "subscribed",
                )}
                networkSubscribed={subs.some(
                  (x) => x.scope === "network" && x.state === "subscribed",
                )}
              />
            </div>
          </div>
        </article>
        <div className="pass-links">
          <Link href={`/p/${token}/preferences`}>Your Drops & preferences</Link>
          <Link href="/sms">Help with your pass</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
