import Link from "next/link";
import {
  ArrowRight,
  Check,
  Coffee,
  ScanLine,
  HeartHandshake,
  ShieldCheck,
} from "lucide-react";
import { Brand } from "@/components/ui";
import { cloudDemoMode } from "@/lib/cloud-demo-guard";
import "./demo/studio.css";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
export default async function Home() {
  if (cloudDemoMode())
    return (
      <main id="main" className="demo-studio demo-landing">
        <div className="demo-top">
          <Brand />
          <Link className="button secondary" href="/demo">
            Open demo <ArrowRight size={16} />
          </Link>
        </div>
        <section className="demo-landing-hero">
          <header>
            <span className="demo-kicker">
              <ShieldCheck size={15} /> THE UPTICK INTERACTIVE DEMO
            </span>
            <h1>
              Local benefits.
              <br />
              Real connections.
              <br />
              <span>See it all happen.</span>
            </h1>
            <p>
              A worthwhile weekly benefit. A welcoming neighborhood store. A
              system that follows through, even when something goes wrong.
            </p>
            <Link className="button demo-primary" href="/demo">
              Open demo <ArrowRight size={18} />
            </Link>
            <p className="fine">
              Founder access required · No real texts or commitments
            </p>
          </header>
          <div
            className="demo-preview"
            aria-label="Illustration of the sample benefit journey"
          >
            <div className="demo-preview-bar">
              <span>
                <i />
                <i />
                <i />
              </span>
              <small>YOUR UPTICK · SAMPLE PREVIEW</small>
            </div>
            <div className="demo-preview-content">
              <span className="demo-kicker">A LITTLE GOOD, CLOSE BY</span>
              <h2>
                Something to
                <br />
                look forward to.
              </h2>
              <div className="demo-benefit-preview">
                <span className="demo-coffee">
                  <Coffee size={44} strokeWidth={1.5} />
                </span>
                <span className="badge mint">Weekly benefit</span>
                <h3>One free 12 oz coffee</h3>
                <p>Sample Fuel & Market</p>
                <div>
                  <Check size={15} /> No purchase required
                </div>
              </div>
              <div className="demo-preview-check">
                <ShieldCheck size={20} />
                <span>
                  Backed benefit. Clear next steps.
                  <small>Fictional sample, ready to explore.</small>
                </span>
              </div>
            </div>
          </div>
        </section>
        <section className="demo-value-grid" aria-label="What you can explore">
          <article>
            <Coffee size={23} />
            <span>01 · THE MEMBER</span>
            <h2>A better week starts here.</h2>
            <p>
              Enter as a sample member, discover a backed benefit, and claim
              your pass.
            </p>
          </article>
          <article>
            <ScanLine size={23} />
            <span>02 · THE STORE</span>
            <h2>Simple at the counter.</h2>
            <p>
              Use the staff QR, record a digital redemption, and see the saved
              result.
            </p>
          </article>
          <article>
            <HeartHandshake size={23} />
            <span>03 · THE FOLLOW-THROUGH</span>
            <h2>Make things right.</h2>
            <p>
              Report a sample stockout and provide a backed recovery. Reset and
              repeat.
            </p>
          </article>
        </section>
        <footer className="demo-landing-footer">
          <span>UPTICK LOCAL</span>
          <p>
            Sample data is a demonstration, not traction. Digital redemption is
            not proof of physical fulfillment.
          </p>
          <Link href="/demo">
            Let’s take a look <ArrowRight size={16} />
          </Link>
        </footer>
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
