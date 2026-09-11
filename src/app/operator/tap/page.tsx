import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/config";
import type { TapPoint, TapCredential } from "@/lib/tap";
import { Shell } from "@/components/shell";
import { Badge, Empty, PageHeading } from "@/components/ui";
import {
  TapCreatePoint,
  TapPointControls,
  type TapLocationOption,
} from "@/components/tap-controls";
import { PrintButton } from "@/components/operator-controls";
import "@/components/tap.css";
export const dynamic = "force-dynamic";
export default async function OperatorTap() {
  const actor = await requireActor(true),
    db = await getDb();
  const [points, credentials, locations, history] = await Promise.all([
    db.query<
      TapPoint & { merchant: string; address: string; is_demo: boolean }
    >(
      "select p.*,g.name merchant,g.is_demo,l.address from redemption_points p join organizations g on g.id=p.organization_id join locations l on l.id=p.location_id order by p.created_at desc",
    ),
    // Public identifiers and provisioning references are safe for authorized operators.
    // Actual keys are never selected, rendered, logged, or accepted by this page.
    db.query<TapCredential & { last_validated_at: string | null }>(
      "select id,point_id,public_token,credential_type,state,version,uid,profile,meta_key_ref,file_key_ref,last_counter,last_validated_at from redemption_credentials where state='active' order by created_at desc",
    ),
    db.query<TapLocationOption>(
      "select l.id,l.organization_id,l.name,g.name merchant from locations l join organizations g on g.id=l.organization_id where 'merchant'=any(g.capabilities) order by g.name,l.name",
    ),
    db.query<{
      id: string;
      scenario: string;
      outcome: string;
      created_at: string;
      point_name: string;
    }>(
      "select e.id,e.scenario,e.outcome,e.created_at,p.name point_name from tap_test_events e join redemption_points p on p.id=e.point_id order by e.created_at desc limit 10",
    ),
  ]);
  const qrImages = await Promise.all(
    points.map(async (p) => {
      const credential = credentials.find(
        (c) => c.point_id === p.id && c.credential_type === "qr",
      );
      return credential
        ? {
            pointId: p.id,
            url: `${appUrl()}/tap/${credential.public_token}`,
            image: await QRCode.toDataURL(
              `${appUrl()}/tap/${credential.public_token}`,
              {
                width: 400,
                margin: 2,
                color: { dark: "#163c3d", light: "#ffffff" },
              },
            ),
          }
        : null;
    }),
  );
  return (
    <Shell actor={actor} active="tap" name="Network operations">
      <PageHeading
        eyebrow="THE IN-STORE MOMENT"
        title={
          <>
            One counter.
            <br />
            <em>Every Uptick Drop.</em>
          </>
        }
        description="Permanent location credentials connect a private member pass to the right store. QR is the fallback. Secure NFC adds authenticated tag evidence."
        action={<PrintButton />}
      />
      <div className="tap-operator-grid">
        <section aria-label="Redemption points">
          {!points.length && (
            <Empty title="Start with the counter.">
              Create a permanent redemption point for a participating store. Its
              QR works across future Drops.
            </Empty>
          )}
          {points.map((point) => {
            const qr = qrImages.find((image) => image?.pointId === point.id),
              secure = credentials.find(
                (c) =>
                  c.point_id === point.id && c.credential_type === "secure_nfc",
              );
            return (
              <article className="tap-point-card" key={point.id}>
                <p className="eyebrow">
                  {point.merchant}
                  {point.is_demo ? " · SAMPLE" : ""}
                </p>
                <h2>{point.name}</h2>
                <p>{point.address}</p>
                <div className="tap-action-row">
                  <Badge tone={point.state === "active" ? "mint" : "neutral"}>
                    {point.state}
                  </Badge>
                  <Badge>
                    {point.exposure === "staff"
                      ? "Staff presents Tap"
                      : "Public Tap"}
                  </Badge>
                </div>
                {qr && (
                  <div className="tap-qr-row">
                    <Image
                      src={qr.image}
                      width={200}
                      height={200}
                      alt={`Permanent Uptick redemption QR for ${point.merchant}, ${point.name}`}
                      unoptimized
                    />
                    <div>
                      <strong>Tap or scan to redeem.</strong>
                      <p>
                        {point.exposure === "staff"
                          ? "Keep this sign at the counter. Present it after checking the offer’s qualifying condition."
                          : "Place this sign at the approved public redemption point."}
                      </p>
                      <Link href={qr.url} className="text-link">
                        Open location QR →
                      </Link>
                      <a
                        href={qr.image}
                        download={`uptick-tap-${point.id}.png`}
                        className="text-link"
                      >
                        Download QR image
                      </a>
                    </div>
                  </div>
                )}
                {secure ? (
                  <div className="tap-software-note">
                    <strong>
                      Secure NFC configured · Version {secure.version}
                    </strong>
                    <p>
                      UID {secure.uid}
                      <br />
                      Profile: encrypted PICC + empty MAC input
                    </p>
                    <p>
                      {secure.last_validated_at
                        ? `Last accepted authentication: ${new Date(secure.last_validated_at).toLocaleString("en-US")}; counter ${secure.last_counter}.`
                        : "No live tag authentication has been recorded."}
                    </p>
                    <p>Programmed URL template:</p>
                    <code style={{ overflowWrap: "anywhere" }}>
                      {appUrl()}/tap/{secure.public_token}?e={"<32-hex-PICC>"}
                      &amp;c={"<16-hex-MAC>"}
                    </code>
                  </div>
                ) : (
                  <p className="fine-print">
                    QR available. Secure NFC has not been provisioned for this
                    point.
                  </p>
                )}
                <TapPointControls pointId={point.id} state={point.state} />
              </article>
            );
          })}
        </section>
        <aside>
          <article className="tap-point-card">
            <p className="eyebrow">ADD A LOCATION POINT</p>
            <h2>Set up the counter.</h2>
            <TapCreatePoint locations={locations} />
          </article>
          <article className="tap-point-card">
            <p className="eyebrow">WHAT THE EVIDENCE MEANS</p>
            <h2>Say exactly what happened.</h2>
            <ol className="redeem-steps">
              <li>
                <span>0</span>
                <div>
                  <strong>Self-confirmation or exception</strong>
                  <p>
                    Member confirmation or an operator’s documented exception.
                  </p>
                </div>
              </li>
              <li>
                <span>1</span>
                <div>
                  <strong>Location QR</strong>
                  <p>
                    The pass used a store credential. A static QR can be copied.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Secure location credential</strong>
                  <p>
                    The server authenticated the NFC tag and rejected reused
                    counters.
                  </p>
                </div>
              </li>
            </ol>
            <p className="fine-print">
              Staff-gated access is recorded separately. It describes the
              operating policy, not proof that a cashier checked the purchase.
              No method here digitally verifies a transaction.
            </p>
          </article>
          <article className="tap-point-card">
            <p className="eyebrow">FOR THE CASHIER</p>
            <h2>Check. Present. Confirm.</h2>
            <ol>
              <li>
                Read the current Drop’s qualifying condition and staff
                instructions.
              </li>
              <li>Check the qualifying receipt or item when required.</li>
              <li>Present the Uptick Tap sign.</li>
              <li>
                Wait for the green UPTICK REDEEMED screen, including this store
                and time.
              </li>
              <li>Give the listed reward once.</li>
            </ol>
            <p className="fine-print">
              If NFC fails, use the permanent QR. If both fail, contact the
              Uptick operator. An override requires a recorded reason.
            </p>
          </article>
          <div className="tap-software-note">
            <strong>Software is ready for a hardware pilot.</strong>
            <p>
              The NFC adapter passes published NXP and NIST reference vectors.
              Physical tag programming, phone compatibility, counter behavior,
              tamper response, installation and cashier training still need real
              hardware validation.
            </p>
            <a
              href="https://www.nxp.com/docs/en/application-note/AN12196.pdf"
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              NXP provisioning reference ↗
            </a>
          </div>
          {history.length > 0 && (
            <article className="tap-point-card" style={{ marginTop: 20 }}>
              <p className="eyebrow">ISOLATED SOFTWARE REHEARSALS</p>
              <ul className="tap-history-list">
                {history.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {event.point_name} · {event.scenario.replaceAll("_", " ")}
                    </strong>
                    <br />
                    {event.outcome.replaceAll("_", " ")}
                    <time dateTime={event.created_at}>
                      {new Date(event.created_at).toLocaleString("en-US")}
                    </time>
                  </li>
                ))}
              </ul>
              <p className="fine-print">
                These rows do not enter production member, redemption or
                verification metrics.
              </p>
            </article>
          )}
        </aside>
      </div>
    </Shell>
  );
}
