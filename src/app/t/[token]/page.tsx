import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { getDb } from "@/lib/db";
import { getInternalTestPass } from "@/lib/internal-testing";
import { RequestError } from "@/lib/http";
import { Brand, Location, Badge, Footer } from "@/components/ui";
import { InternalTestPassActions } from "@/components/internal-testing-controls";
import "@/components/internal-testing.css";
export const dynamic = "force-dynamic";
export default async function InternalPass({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let run;
  try {
    run = await getInternalTestPass(await getDb(), token);
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    return (
      <div className="customer-page">
        <header className="customer-header">
          <Brand />
        </header>
        <main id="main" className="policy-page">
          <p className="eyebrow">INTERNAL TEST ONLY</p>
          <h1>This test link is not valid.</h1>
          <p>Ask the Uptick operator for the complete private test link.</p>
          <Link className="text-link" href="/sms">
            Help & support →
          </Link>
        </main>
        <Footer />
      </div>
    );
  }
  const snapshot = run.snapshot,
    expired = new Date(run.expires_at) <= new Date();
  return (
    <div className="customer-page internal-test-pass">
      <header className="customer-header">
        <Brand />
        <span className="eyebrow">AN INTERNAL REHEARSAL</span>
      </header>
      <div className="test-pass-banner">
        <FlaskConical size={16} />
        <strong>TEST PASS · NO PURCHASE · NO REAL REWARD</strong>
      </div>
      <main id="main" className="pass-wrap">
        <article className="pass-card">
          <div className="pass-top">
            <p className="eyebrow">
              {run.test_kind === "drop"
                ? "WEEKLY DROP TEST"
                : "REQUESTED PASS TEST"}
            </p>
            <div>
              <strong>{snapshot.merchant}</strong>
              <Badge tone="amber">
                {run.redeemed_at
                  ? "Test redeemed"
                  : expired
                    ? "Test expired"
                    : "Internal test"}
              </Badge>
            </div>
          </div>
          <div className="pass-body">
            <p className="eyebrow">SAVED OFFER · VERSION {run.offer_version}</p>
            <h1>
              <em>{snapshot.reward}</em>
            </h1>
            <p className="qualification">{snapshot.qualification}</p>
            <Location address={snapshot.address} />
            <div className="test-pass-disclaimer">
              <FlaskConical size={20} />
              <p>
                Practice the pass experience with Uptick. This test does not
                entitle anyone to the reward, make a purchase, or change a
                marketing subscription.
              </p>
            </div>
            <InternalTestPassActions
              token={token}
              opened={!!run.opened_at}
              redeemed={!!run.redeemed_at}
              expired={expired}
            />
            <div className="pass-details">
              <div>
                <span>Test available until</span>
                <strong>
                  {new Date(run.expires_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: snapshot.timezone,
                  })}
                </strong>
              </div>
              <div>
                <span>Original offer window</span>
                <strong>
                  {new Date(snapshot.starts_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: snapshot.timezone,
                  })}{" "}
                  →{" "}
                  {new Date(snapshot.expires_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: snapshot.timezone,
                  })}
                </strong>
              </div>
              <details>
                <summary>Review the saved customer terms</summary>
                <p>{snapshot.terms}</p>
                <p>
                  These terms describe the underlying offer. This separate test
                  pass is always a rehearsal.
                </p>
              </details>
            </div>
          </div>
        </article>
        <p className="test-pass-footer">
          Uptick internal testing. Every recorded test action stays outside
          merchant production results.
        </p>
      </main>
      <Footer />
    </div>
  );
}
