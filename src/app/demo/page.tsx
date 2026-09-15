import Link from "next/link";
import {
  ArrowRight,
  ShieldCheck,
  Play,
  Coffee,
  ScanLine,
  ChartNoAxesCombined,
  CircleAlert,
  HeartHandshake,
  Check,
  LockKeyhole,
} from "lucide-react";
import { Brand } from "@/components/ui";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import {
  sampleDemoMode as demoMode,
  assertSampleDemoStorage as assertDemoStorage,
} from "@/lib/demo-guard";
import { getDb } from "@/lib/db";
import { demoSnapshot } from "@/lib/demo-studio";
import { DemoButton, CloudDemoUnlock } from "@/components/demo-controls";
import { cloudDemoMode } from "@/lib/cloud-demo-guard";
import { RequestError } from "@/lib/http";
import { appUrl } from "@/lib/config";
import "./studio.css";
export const dynamic = "force-dynamic";
export default async function DemoStudio({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  if (!demoMode()) notFound();
  assertDemoStorage();
  let snapshot;
  try {
    snapshot = await demoSnapshot(await getDb());
  } catch (error) {
    if (
      !cloudDemoMode() ||
      !(error instanceof RequestError) ||
      error.status !== 401
    )
      throw error;
    return (
      <main id="main" className="demo-studio demo-locked">
        <div className="demo-top">
          <Brand />
          <Link href="/">
            Back to overview <ArrowRight size={16} />
          </Link>
        </div>
        <div className="demo-unlock-layout">
          <header>
            <span className="demo-kicker">
              <ShieldCheck size={15} /> PRIVATE FOUNDER DEMO
            </span>
            <h1>
              Your next great demo
              <br />
              <span>starts here.</span>
            </h1>
            <p>
              Explore Uptick as a member, a store, and an operator. One
              connected journey, using the real application.
            </p>
            <div className="demo-assurances">
              <span>
                <Check size={17} /> Fictional members & benefits
              </span>
              <span>
                <Check size={17} /> No real SMS or commitments
              </span>
              <span>
                <Check size={17} /> Reset from your browser
              </span>
            </div>
          </header>
          <section className="demo-access-card">
            <span className="demo-icon">
              <LockKeyhole size={24} />
            </span>
            <h2>Welcome to your rehearsal</h2>
            <p>Enter your founder access key to open the sample workspace.</p>
            <CloudDemoUnlock />
            <p className="fine">
              One browser rehearsal at a time. Your session lasts eight hours.
              Use fictional sample information only.
            </p>
          </section>
        </div>
      </main>
    );
  }
  const { counts, qr } = snapshot;
  const query = await searchParams;
  const suggestedStep = counts.recoveries
    ? 6
    : counts.incidents
      ? 6
      : counts.redemptions
        ? 4
        : counts.claims
          ? 3
          : 1;
  const requestedStep = Number(query.step);
  const step =
    Number.isInteger(requestedStep) && requestedStep >= 1 && requestedStep <= 6
      ? requestedStep
      : suggestedStep;
  const stepNames = [
    "Member entry",
    "Claim benefit",
    "Staff QR",
    "See results",
    "Report an issue",
    "Recovery",
  ];
  const staffPath = `/tap/${qr.public_token}`;
  const svg = await QRCode.toString(`${appUrl()}${staffPath}`, {
    type: "svg",
    margin: 2,
  });
  return (
    <main id="main" className="demo-studio">
      <div className="demo-top">
        <Brand />
        <span className="demo-session">
          <span className="status-dot" /> Sample workspace
        </span>
      </div>
      <header className="demo-heading">
        <div>
          <span className="demo-kicker">
            <Play size={14} /> DEMO STUDIO
          </span>
          <h1>
            Your Uptick <span>walkthrough.</span>
          </h1>
          <p>
            One step at a time, in this browser. Come back here whenever you
            need the next step.
          </p>
        </div>
        <div className="demo-safety">
          <ShieldCheck size={26} />
          <strong>A safe place to explore</strong>
          <p>
            Real application. Separate {cloudDemoMode() ? "cloud" : "local"}{" "}
            sample records. No real SMS, members, stock obligations, or
            commitments.
          </p>
        </div>
      </header>
      <details className="demo-evidence-disclosure">
        <summary>View saved sample activity</summary>
        <section className="demo-summary" aria-label="Saved sample activity">
          {[
            ["Claims", counts.claims],
            ["Digital redemptions", counts.redemptions],
            ["Reported issues", counts.incidents],
            ["Recoveries issued", counts.recoveries],
            ["Recoveries redeemed", counts.recovery_redemptions],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>Sample activity</small>
            </div>
          ))}
        </section>
      </details>
      <nav className="demo-step-nav" aria-label="Demo journey">
        {stepNames.map((name, index) => (
          <Link
            href={`/demo?step=${index + 1}`}
            key={name}
            aria-current={step === index + 1 ? "step" : undefined}
          >
            <span>{index + 1}</span>
            <strong>{name}</strong>
          </Link>
        ))}
      </nav>
      <div className="demo-guided-heading">
        <span className="eyebrow">STEP {step} OF 6</span>
        <span>{stepNames[step - 1]}</span>
      </div>
      <section className="demo-scenes demo-guided" aria-label="Demo steps">
        {step === 1 && (
          <article id="step-1">
            <div className="demo-card-top">
              <span className="demo-icon">
                <Play size={23} />
              </span>
              <span className="demo-step-number">01</span>
            </div>
            <span className="eyebrow">1 · MEMBER ENTRY</span>
            <h2>Start with a member</h2>
            <p>
              The sample number and ZIP are filled in. Confirm the adult
              checkbox, request your simulated access link, then open it.
              Promotional texts are optional.
            </p>
            <DemoButton action="member">Open member journey</DemoButton>
            <p className="fine">Sample: (202) 555-0123 · ZIP 10583</p>
          </article>
        )}
        {step === 2 && (
          <article id="step-2">
            <div className="demo-card-top">
              <span className="demo-icon">
                <Coffee size={23} />
              </span>
              <span className="demo-step-number">02</span>
            </div>
            <span className="eyebrow">2 · BACKED BENEFIT</span>
            <h2>Claim this week’s coffee</h2>
            <p>
              One 12 oz coffee, with no purchase or member payment. Open Your
              Uptick and claim it to prepare the pass.
            </p>
            <Link className="button" href="/your-uptick">
              Open Your Uptick
            </Link>
          </article>
        )}
        {step === 3 && (
          <article id="step-3">
            <div className="demo-card-top">
              <span className="demo-icon">
                <ScanLine size={23} />
              </span>
              <span className="demo-step-number">03</span>
            </div>
            <span className="eyebrow">3 · STAFF QR</span>
            <h2>Record redemption</h2>
            <p>
              On the claimed pass, choose “Use this pass at Uptick Tap”. Return
              here, open the sample staff QR in this same browser, and confirm.
              The button follows the QR’s exact destination. On one laptop, it
              stands in for scanning at a counter.
            </p>
            <div
              className="demo-qr"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <Link className="button" href={staffPath}>
              Open staff QR destination
            </Link>
            <p className="fine">
              Digital redemption records credential use. It does not prove a
              purchase or physical handoff.
            </p>
          </article>
        )}
        {step === 4 && (
          <article id="step-4">
            <div className="demo-card-top">
              <span className="demo-icon">
                <ChartNoAxesCombined size={23} />
              </span>
              <span className="demo-step-number">04</span>
            </div>
            <span className="eyebrow">4 · RESULTS</span>
            <h2>See the saved result</h2>
            <p>
              The merchant and operator views use these same sample records.
            </p>
            <DemoButton action="merchant">Open merchant view</DemoButton>
            <DemoButton action="operator">Open operator view</DemoButton>
          </article>
        )}
        {step === 5 && (
          <article id="step-5">
            <div className="demo-card-top">
              <span className="demo-icon">
                <CircleAlert size={23} />
              </span>
              <span className="demo-step-number">05</span>
            </div>
            <span className="eyebrow">5 · FULFILLMENT FAILURE</span>
            <h2>The coffee ran out</h2>
            <p>
              Record a sample stockout before physical handoff. The original
              digital evidence stays intact.
            </p>
            <DemoButton action="stockout">Report sample stockout</DemoButton>
          </article>
        )}
        {step === 6 && (
          <article id="step-6">
            <div className="demo-card-top">
              <span className="demo-icon">
                <HeartHandshake size={23} />
              </span>
              <span className="demo-step-number">06</span>
            </div>
            <span className="eyebrow">6 · BACKED RECOVERY</span>
            <h2>Make the member whole</h2>
            <p>
              Issue one sealed bottle of water from separate sample fallback
              stock. Reopen the member’s pass and the staff QR to record
              recovery.
            </p>
            {counts.recovery_redemptions > 0 ? (
              <p className="demo-complete">
                <Check size={18} /> Recovery recorded. You’ve completed the
                journey.
              </p>
            ) : counts.recoveries > 0 ? (
              <p className="demo-complete">
                <Check size={18} /> Recovery issued. Open the member’s pass,
                prepare it for Uptick Tap, then return to step 3 to record it.
              </p>
            ) : (
              <DemoButton action="recovery">Issue sample recovery</DemoButton>
            )}
            <Link className="text-link" href="/your-uptick">
              Return to the member’s pass <ArrowRight size={15} />
            </Link>
          </article>
        )}
      </section>
      <div className="demo-step-footer">
        {step > 1 ? (
          <Link href={`/demo?step=${step - 1}`} className="text-link">
            ← Previous step
          </Link>
        ) : (
          <span />
        )}
        {step < 6 ? (
          <Link href={`/demo?step=${step + 1}`} className="button secondary">
            Next: {stepNames[step]} <ArrowRight size={16} />
          </Link>
        ) : (
          <Link href="/demo?step=1" className="text-link">
            Back to the beginning <ArrowRight size={16} />
          </Link>
        )}
      </div>
      <details className="demo-reset" open={counts.recovery_redemptions > 0}>
        <summary>Reset or finish this demo</summary>
        <h2>A fresh start, whenever you need it.</h2>
        {cloudDemoMode() ? (
          <>
            <p>
              Reset this sample rehearsal to clear its activity and prepare the
              current four weeks. Old sample passes and QR codes stop working.
            </p>
            <DemoButton action="reset" endpoint="/api/demo/cloud">
              Reset my rehearsal
            </DemoButton>
            <DemoButton action="end" endpoint="/api/demo/cloud">
              End rehearsal & lock
            </DemoButton>
            <p>
              One browser session at a time. End this rehearsal before opening
              it in another browser. No terminal commands are needed.
            </p>
          </>
        ) : (
          <>
            <ol>
              <li>
                Go to the terminal running the demo and press{" "}
                <strong>Control-C</strong>.
              </li>
              <li>
                Run <code>npm run demo:reset</code>.
              </li>
              <li>
                Run <code>npm run demo</code> and return here.
              </li>
            </ol>
            <p>
              Reset only removes this demo’s database and signing keys. Old demo
              links stop working.
            </p>
          </>
        )}
      </details>
    </main>
  );
}
