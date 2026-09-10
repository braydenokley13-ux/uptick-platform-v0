"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FlaskConical,
  MessageSquare,
} from "lucide-react";
import type { createInternalTest } from "@/lib/internal-testing";
import { internalTestMessage } from "@/lib/testing-copy";
export type TestingOffer = {
  id: string;
  organizationId: string;
  merchant: string;
  title: string;
  version: number;
  kind: "anchor" | "drop";
  qualification: string;
  reward: string;
  isDemo: boolean;
};
type SafeTest = Awaited<ReturnType<typeof createInternalTest>>;
async function command(body: object) {
  let response: Response;
  try {
    response = await fetch("/api/testing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw Error(
      "The test service could not be reached. Check your connection and try again.",
    );
  }
  const data = await response.json().catch(() => {
    throw Error(
      "The test service is temporarily unavailable. Please try again.",
    );
  });
  if (!data || typeof data !== "object")
    throw Error(
      "The test service is temporarily unavailable. Please try again.",
    );
  if (!response.ok)
    throw Error(data.error || "The test could not be completed.");
  return data;
}
export function InternalTestForm({
  offers,
  allowlistCount,
  development,
}: {
  offers: TestingOffer[];
  allowlistCount: number;
  development: boolean;
}) {
  const [selected, setSelected] = useState(offers[0]?.id || ""),
    [phone, setPhone] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<SafeTest | null>(null),
    [requestKey, setRequestKey] = useState("");
  const router = useRouter();
  const offer = offers.find((o) => o.id === selected);
  const kind = offer?.kind || "anchor";
  function changed() {
    setRequestKey("");
    setSaved(null);
    setError("");
  }
  return (
    <form
      className="test-create-grid"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!offer) return;
        const key = requestKey || crypto.randomUUID();
        setRequestKey(key);
        setBusy(true);
        setError("");
        try {
          const result = await command({
            action: "create",
            organizationId: offer.organizationId,
            offerId: offer.id,
            kind,
            phone,
            requestKey: key,
            confirmed,
          });
          setSaved(result.test);
          router.refresh();
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <section className="panel test-form-fields">
        <p className="eyebrow">01 / CHOOSE THE REHEARSAL</p>
        <h2>Try the exact saved offer.</h2>
        <fieldset disabled={busy || !!saved} className="stack-form">
          <label>
            Merchant and offer
            <select
              required
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                changed();
              }}
            >
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.merchant} · {o.title} · V{o.version}
                  {o.isDemo ? " · local sample" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer experience
            <input
              readOnly
              value={
                kind === "anchor"
                  ? "Requested offer pass"
                  : "Weekly Drop preview"
              }
            />
          </label>
          <label>
            Approved internal mobile number
            <input
              type="tel"
              required
              autoComplete="off"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                changed();
              }}
              placeholder="An approved team number"
              maxLength={40}
            />
          </label>
          <p className="fine">
            {allowlistCount}{" "}
            {allowlistCount === 1 ? "number is" : "numbers are"} configured in
            INTERNAL_TEST_NUMBERS. Only an exact normalized match can receive a
            test.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              This approved tester requested the message and knows it is an
              internal rehearsal.
            </span>
          </label>
          <button
            className="button"
            disabled={!allowlistCount || !offers.length}
          >
            {busy
              ? "Preparing the test…"
              : development
                ? "Create a local test pass"
                : "Send internal test SMS"}
            <FlaskConical size={17} />
          </button>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <div className="test-saved" role="status">
            <span>
              <Check size={18} />
              Test saved · {saved.state.replaceAll("_", " ")}
            </span>
            <p>
              {saved.transport === "development"
                ? "No SMS was sent. Open the internal pass below."
                : saved.state === "unknown"
                  ? "The provider outcome is uncertain. This test will not be automatically resent. Check the provider before creating another."
                  : saved.state === "failed" || saved.state === "suppressed"
                    ? "The message was not delivered. Review its saved status and provider code below."
                    : "Provider acceptance is not delivery. The history below updates when a signed callback arrives."}
            </p>
            <Link
              href={saved.passUrl}
              className="button secondary"
              target="_blank"
              rel="noreferrer"
            >
              Open internal test pass
              <ArrowUpRight size={15} />
            </Link>
            <button
              type="button"
              className="text-link"
              onClick={() => {
                changed();
                setConfirmed(false);
                setPhone("");
              }}
            >
              Start another rehearsal
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </section>
      <aside className="test-sms-preview">
        <p className="eyebrow">
          <MessageSquare size={15} />
          02 / REVIEW THE TEST MESSAGE
        </p>
        <h2>
          A test from the
          <br />
          <em>real saved promise.</em>
        </h2>
        {offer ? (
          <p className="test-sms-bubble">
            {internalTestMessage(
              {
                merchant: offer.merchant,
                qualification: offer.qualification,
                reward: offer.reward,
              },
              kind,
            )}
          </p>
        ) : (
          <p>Create and save an offer in Offer Studio first.</p>
        )}
        <p className="fine">
          The final private /t link replaces the bracketed preview. All messages
          explicitly say INTERNAL TEST. Tests create no customer audience,
          production claim, sale, or real reward.
        </p>
        <div className="test-policy-note">
          <strong>24 hours to rehearse.</strong>
          <p>
            The test pass has its own expiry. The offer’s original dates and
            terms remain visible for review.
          </p>
        </div>
      </aside>
    </form>
  );
}
export function InternalTestPassActions({
  token,
  opened,
  redeemed,
  expired,
}: {
  token: string;
  opened: boolean;
  redeemed: boolean;
  expired: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  async function act(action: "open" | "redeem") {
    setBusy(true);
    setError("");
    try {
      await command({ action, token });
      setConfirm(false);
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (redeemed)
    return (
      <div className="test-pass-success" role="status">
        <Check size={26} />
        <h2>Test redemption recorded.</h2>
        <p>
          One rehearsal completed. No purchase, reward, customer subscription,
          or production metric changed.
        </p>
      </div>
    );
  if (expired)
    return (
      <div className="test-pass-success">
        <h2>This rehearsal has ended.</h2>
        <p>Ask Uptick to create a fresh internal test.</p>
      </div>
    );
  return (
    <div className="test-pass-actions">
      {!opened ? (
        <>
          <p>
            Open the pass to record a deliberate test action. Loading this page
            alone records no phone confirmation.
          </p>
          <button
            className="button full"
            disabled={busy}
            onClick={() => act("open")}
          >
            {busy ? "Opening…" : "Open my test pass"}
            <ArrowRight size={16} />
          </button>
        </>
      ) : confirm ? (
        <div className="confirm-box">
          <h3>Record a test redemption?</h3>
          <p>
            This is a rehearsal. Do not make a purchase or provide a free item.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Go back
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => act("redeem")}
            >
              {busy ? "Recording…" : "Confirm test redemption"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p>
            Rehearse the cashier step. This pass cannot redeem a real offer.
          </p>
          <button className="button full" onClick={() => setConfirm(true)}>
            Test redemption with cashier
            <ArrowRight size={16} />
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
