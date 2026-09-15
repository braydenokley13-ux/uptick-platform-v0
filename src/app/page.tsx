import Link from "next/link";
import { cloudDemoMode } from "@/lib/cloud-demo-guard";
import "./demo/studio.css";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
export default async function Home() {
  if (cloudDemoMode())
    return (
      <main id="main" className="demo-studio">
        <header>
          <p className="eyebrow">UPTICK · INTERACTIVE DEMO</p>
          <h1>
            A little good.
            <br />
            <em>See it happen.</em>
          </h1>
          <p>
            Walk through Uptick as a member, a store, and an operator. Claim a
            backed weekly benefit, record a redemption, and put things right
            when fulfillment fails.
          </p>
          <Link className="button" href="/demo">
            Open demo
          </Link>
          <p className="fine">
            Sample data only. No real texts, purchases, or commitments. Founder
            access is required.
          </p>
        </header>
      </main>
    );
  const actor = await getActor();
  redirect(
    actor
      ? actor.role === "operator"
        ? "/operator/network"
        : "/merchant"
      : "/join",
  );
}
