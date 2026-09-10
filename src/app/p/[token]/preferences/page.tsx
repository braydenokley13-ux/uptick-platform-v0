import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getPass, type Claim } from "@/lib/domain";
import { Brand, Badge, Footer } from "@/components/ui";
import { PreferenceForm } from "@/components/forms";
export const dynamic = "force-dynamic";
export default async function Preferences({
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
    notFound();
  }
  const subs = await db.query<{ scope: string; state: string }>(
    "select scope,state from subscriptions where customer_id=$1 and scope in ($2,'network')",
    [claim.customer_id, claim.organization_id],
  );
  // The capability grants continuity only within this one merchant relationship. No private credentials are rendered.
  const history = await db.query<Claim>(
    "select id,state,snapshot,created_at,redeemed_at from claims where customer_id=$1 and organization_id=$2 order by created_at desc",
    [claim.customer_id, claim.organization_id],
  );
  return (
    <div className="customer-page">
      <header className="customer-header">
        <Brand />
      </header>
      <main id="main" className="pass-wrap">
        <div className="panel detail-panel">
          <p className="eyebrow">YOUR DROPS</p>
          <h1 style={{ fontSize: 31, marginTop: 15 }}>
            {claim.snapshot.merchant}
          </h1>
          <p>A little continuity. No account needed.</p>
          <PreferenceForm
            token={token}
            merchant={claim.snapshot.merchant}
            subscribed={subs.some(
              (x) =>
                x.scope === claim.organization_id && x.state === "subscribed",
            )}
            networkSubscribed={subs.some(
              (x) => x.scope === "network" && x.state === "subscribed",
            )}
          />
        </div>
        <section className="panel detail-panel">
          <h2>Your offer history</h2>
          {history.map((c) => (
            <div className="history-row" key={c.id}>
              <div>
                <strong>{c.snapshot.reward}</strong>
                <p>{c.snapshot.qualification}</p>
                <p>
                  {new Date(c.created_at).toLocaleDateString("en-US", {
                    timeZone: c.snapshot.timezone,
                  })}{" "}
                  · UP-{c.id.slice(-6).toUpperCase()}
                </p>
              </div>
              <Badge tone={c.state === "redeemed" ? "mint" : "neutral"}>
                {c.state === "active" &&
                new Date(c.snapshot.expires_at) < new Date()
                  ? "expired"
                  : c.state}
              </Badge>
            </div>
          ))}
          <p className="fine">
            Open each active pass from its own private SMS link.
          </p>
        </section>
        <div className="pass-links">
          <Link href={`/p/${token}`}>← Back to this pass</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
