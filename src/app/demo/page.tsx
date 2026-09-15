import Link from "next/link";
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
export default async function DemoStudio() {
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
      <main id="main" className="demo-studio">
        <header>
          <p className="eyebrow">UPTICK · PRIVATE CLOUD REHEARSAL</p>
          <h1>
            Your demo.
            <br />
            <em>Ready in the browser.</em>
          </h1>
          <p>
            Use your founder access key. This separate sample environment sends
            no real SMS and creates no real members or commitments.
          </p>
        </header>
        <CloudDemoUnlock />
        <p>
          One browser rehearsal at a time. Your session lasts eight hours. Use
          fictional sample information only.
        </p>
      </main>
    );
  }
  const { counts, qr } = snapshot;
  const staffPath = `/tap/${qr.public_token}`;
  const svg = await QRCode.toString(`${appUrl()}${staffPath}`, {
    type: "svg",
    margin: 2,
  });
  return (
    <main id="main" className="demo-studio">
      <header>
        <p className="eyebrow">UPTICK · FOUNDER REHEARSAL</p>
        <h1>
          A little good.
          <br />
          <em>The whole journey.</em>
        </h1>
        <p>
          This is the real application with a separate{" "}
          {cloudDemoMode() ? "cloud" : "local"} sample database. No real
          members, messages, stock or commercial commitments are created.
        </p>
      </header>
      <section className="demo-scenes" aria-label="Demo steps">
        <article>
          <span className="eyebrow">1 · MEMBER ENTRY</span>
          <h2>Start with a member</h2>
          <p>
            The sample number and ZIP are filled in. Confirm the adult checkbox,
            request your simulated access link, then open it. Promotional texts
            are optional.
          </p>
          <DemoButton action="member">Open member journey</DemoButton>
          <p className="fine">Sample: (202) 555-0123 · ZIP 10583</p>
        </article>
        <article>
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
        <article>
          <span className="eyebrow">3 · STAFF QR</span>
          <h2>Record redemption</h2>
          <p>
            On the claimed pass, choose “Use this pass at Uptick Tap”. Return
            here, open the sample staff QR in this same browser, and confirm.
            The button follows the QR’s exact destination. On one laptop, it
            stands in for scanning at a counter.
          </p>
          <div className="demo-qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <Link className="button" href={staffPath}>
            Open staff QR destination
          </Link>
          <p className="fine">
            Digital redemption records credential use. It does not prove a
            purchase or physical handoff.
          </p>
        </article>
        <article>
          <span className="eyebrow">4 · RESULTS</span>
          <h2>See the saved result</h2>
          <p>The merchant and operator views use these same sample records.</p>
          <DemoButton action="merchant">Open merchant view</DemoButton>
          <DemoButton action="operator">Open operator view</DemoButton>
        </article>
        <article>
          <span className="eyebrow">5 · FULFILLMENT FAILURE</span>
          <h2>The coffee ran out</h2>
          <p>
            Record a sample stockout before physical handoff. The original
            digital evidence stays intact.
          </p>
          <DemoButton action="stockout">Report sample stockout</DemoButton>
        </article>
        <article>
          <span className="eyebrow">6 · BACKED RECOVERY</span>
          <h2>Make the member whole</h2>
          <p>
            Issue one sealed bottle of water from separate sample fallback
            stock. Reopen the member’s pass and the staff QR to record recovery.
          </p>
          <DemoButton action="recovery">Issue sample recovery</DemoButton>
          <Link href="/your-uptick">Return to the member’s pass →</Link>
        </article>
      </section>
      <section className="demo-ledger">
        <h2>Saved sample evidence</h2>
        <dl>
          {Object.entries(counts).map(([label, count]) => (
            <div key={label}>
              <dt>{label.replaceAll("_", " ")}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
        <p>
          A recovery serves the original obligation. It is not another paid
          placement or another member.
        </p>
      </section>
      <section>
        <h2>Start over</h2>
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
      </section>
    </main>
  );
}
