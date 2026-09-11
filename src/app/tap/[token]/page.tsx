import Link from "next/link";
import { cookies } from "next/headers";
import { Radio } from "lucide-react";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/security";
import { RequestError } from "@/lib/http";
import { tapLanding, tapPassView } from "@/lib/tap";
import { Badge, Brand, Footer, Location } from "@/components/ui";
import { TapRedeemButton } from "@/components/tap-controls";
import { TapReceipt } from "@/components/tap-receipt";
import "@/components/tap.css";
export const dynamic = "force-dynamic";
export default async function TapPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params,
    query = await searchParams,
    db = await getDb();
  let point;
  try {
    point = await tapLanding(db, token);
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    return (
      <div className="customer-page">
        <header className="customer-header">
          <Brand />
        </header>
        <main className="policy-page" id="main">
          <p className="eyebrow">UPTICK TAP</p>
          <h1>Let’s find the right sign.</h1>
          <p>{error.message}</p>
          <Link href="/sms" className="text-link">
            Get help →
          </Link>
        </main>
        <Footer />
      </div>
    );
  }
  const encrypted = (await cookies()).get("uptick-active-pass")?.value;
  let selected: Awaited<ReturnType<typeof tapPassView>> | null = null;
  if (encrypted) {
    try {
      selected = await tapPassView(db, decrypt(encrypted), point);
    } catch {
      /* An expired or invalid pairing simply asks for the private pass again. */
    }
  }
  const claim = selected?.claim;
  const nfc =
    typeof query.e === "string" && typeof query.c === "string"
      ? { encryptedPicc: query.e, mac: query.c }
      : undefined;
  const secureReady = point.credential_type !== "secure_nfc" || !!nfc;
  return (
    <div className="customer-page">
      <header className="customer-header">
        <Brand />
        <Badge tone="mint">UPTICK TAP</Badge>
      </header>
      {point.is_demo && (
        <div className="demo-notice">
          LOCAL SAMPLE · NO REAL PURCHASE OR REWARD
        </div>
      )}
      <main className="pass-wrap" id="main">
        <article className="pass-card">
          <div className="pass-top">
            <p className="eyebrow">YOUR NEXT GOOD STOP</p>
            <div>
              <strong>{point.merchant}</strong>
              <Badge>{point.name}</Badge>
            </div>
          </div>
          <div className="pass-body">
            <div className="tap-arrival">
              <Radio size={36} />
              <div>
                <h1 style={{ fontSize: 34, margin: 0 }}>
                  You’re at Uptick Tap.
                </h1>
                <p>
                  {point.exposure === "staff"
                    ? "The cashier’s redemption point."
                    : "Your store’s redemption point."}
                </p>
              </div>
            </div>
            <Location address={point.address} />
            {!claim ? (
              <>
                <h2>Open your private pass first.</h2>
                <p>
                  Open the pass in your latest Uptick text on this phone, choose
                  it for your visit, then tap or scan this sign again.
                </p>
                <Link href="/join" className="button secondary">
                  Find Uptick membership
                </Link>
              </>
            ) : !selected?.matches ? (
              <>
                <h2>Your selected pass is for another store.</h2>
                <p>
                  Open the correct pass from your Uptick membership before
                  scanning this sign again.
                </p>
                <p className="fine-print">
                  Your current pass: {claim.snapshot.merchant} ·{" "}
                  {claim.snapshot.address}
                </p>
              </>
            ) : selected.state === "redeemed" ? (
              <TapReceipt
                record={{
                  reward: claim.snapshot.reward,
                  merchant: claim.snapshot.merchant,
                  redeemedAt: claim.redeemed_at
                    ? new Date(claim.redeemed_at).toISOString()
                    : null,
                  timezone: claim.snapshot.timezone,
                  evidence: selected.evidence,
                }}
              />
            ) : selected.state !== "active" ? (
              <>
                <h2>This pass is {selected.state}.</h2>
                <p>
                  Open your Uptick membership for the current availability and
                  offer dates.
                </p>
              </>
            ) : selected.blockedReason ? (
              <>
                <h2>This pass isn’t ready here.</h2>
                <p>{selected.blockedReason}</p>
              </>
            ) : !secureReady ? (
              <>
                <h2>Tap the secure sign again.</h2>
                <p>
                  This link is missing the tag’s fresh authentication. Touch
                  your phone to the NFC sign, or scan the separate printed QR
                  fallback.
                </p>
              </>
            ) : (
              <>
                <p className="eyebrow">YOUR SELECTED DROP</p>
                <h2>{claim.snapshot.reward}</h2>
                <p>{claim.snapshot.qualification}</p>
                {point.exposure === "staff" && (
                  <p className="fine-print">
                    Let the cashier check the qualifying condition before you
                    confirm. Uptick records use of this counter’s credential; it
                    does not digitally verify a purchase.
                  </p>
                )}
                <TapRedeemButton key={claim.id} pointToken={token} nfc={nfc} />
              </>
            )}
          </div>
        </article>
        <div className="pass-links">
          <Link href="/sms">Help with your pass</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
