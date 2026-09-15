"use client";
import {
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  LoaderCircle,
  Check,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
import type { Offer } from "@/lib/domain";
import { disclosure } from "@/lib/consent-copy";
export async function command(data: object) {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await res.json().catch(() => {
    throw Error("The service is temporarily unavailable. Please try again.");
  });
  if (!res.ok) throw Error(result.error || "Please try again.");
  return result;
}
export function ActionButton({
  action,
  data = {},
  children,
  secondary = false,
}: {
  action: string;
  data?: object;
  children: ReactNode;
  secondary?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const router = useRouter();
  return (
    <div className="action-wrap">
      <button
        disabled={busy}
        className={`button ${secondary ? "secondary" : ""}`}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await command({ action, ...data });
            if (r.redirect) router.push(r.redirect);
            else {
              setDone(r.message || "Saved");
              router.refresh();
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <LoaderCircle size={16} className="spin" /> : null}
        {children}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="success-text">
          {done}
        </p>
      )}
    </div>
  );
}
export function LoginForm({ local }: { local: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await command({
        action: "login",
        email: f.get("email"),
        password: f.get("password"),
      });
      router.push(r.redirect);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form onSubmit={submit} className="stack-form">
        <label>
          Email address
          <input
            required
            type="email"
            name="email"
            autoComplete="username"
            placeholder="you@yourbusiness.com"
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            name="password"
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="button full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
          <ArrowRight size={17} />
        </button>
      </form>
      {!local && (
        <p>
          <Link href="/account/recovery">Forgot your password?</Link> ·{" "}
          <Link href="/account/security">Account security</Link>
        </p>
      )}
      {local && (
        <div className="local-access">
          <p className="eyebrow">LOCAL DEVELOPMENT · SAMPLE BUSINESSES</p>
          <p>Explore the working pilot with a local identity.</p>
          <div className="button-row">
            <ActionButton action="login" data={{ mode: "merchant" }}>
              Merchant view
            </ActionButton>
            <ActionButton action="login" data={{ mode: "operator" }} secondary>
              Operator view
            </ActionButton>
          </div>
        </div>
      )}
    </>
  );
}
export function ClaimForm({
  sourceToken,
  merchant,
  disclosures,
}: {
  sourceToken: string;
  merchant: string;
  disclosures: { fulfillment: string; merchant: string; network: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    development: boolean;
    passUrl?: string;
  } | null>(null);
  const visited = useRef<string | null>(null);
  useEffect(() => {
    if (visited.current !== sourceToken) {
      visited.current = sourceToken;
      command({ action: "visit", sourceToken }).catch(() => {});
    }
  }, [sourceToken]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      setResult(
        await command({
          action: "claim",
          sourceToken,
          phone: f.get("phone"),
          merchantConsent: f.get("merchant") === "on",
          networkConsent: f.get("network") === "on",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (result)
    return (
      <div className="claim-success" role="status">
        <span className="success-icon">
          <Check size={28} />
        </span>
        <h2>
          {result.development ? "Your pass is ready." : "Check your texts."}
        </h2>
        <p>
          {result.development
            ? "Local development: this pass is saved in the database. No SMS was sent."
            : "Your pass request is saved. Use the private link in your text when it arrives. Carrier delivery can take a moment."}
        </p>
        {result.passUrl && (
          <button
            className="button full"
            onClick={() => router.push(result.passUrl!)}
          >
            Open development pass
            <ArrowRight size={18} />
          </button>
        )}
        <p className="fine">
          Keep your pass link private. It’s your offer to redeem.
        </p>
      </div>
    );
  return (
    <form onSubmit={submit} className="claim-form">
      <label>
        YOUR MOBILE NUMBER
        <div className="phone-input">
          <span>US +1</span>
          <input
            name="phone"
            required
            type="tel"
            autoComplete="tel-national"
            inputMode="tel"
            placeholder="(201) 555-0123"
            maxLength={24}
            aria-label="Your mobile number"
          />
        </div>
      </label>
      <p className="fine">{disclosures.fulfillment}</p>
      <details className="optional-consent">
        <summary>
          Make it a weekly thing <span>OPTIONAL</span>
        </summary>
        <label className="check-row">
          <input name="merchant" type="checkbox" />
          <span>
            <strong>{merchant}’s Weekly Drop</strong>
            <small>{disclosures.merchant}</small>
          </span>
        </label>
        <label className="check-row">
          <input name="network" type="checkbox" />
          <span>
            <strong>More good things nearby</strong>
            <small>{disclosures.network}</small>
          </span>
        </label>
      </details>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="button full" disabled={busy}>
        {busy ? "Saving your pass…" : "Text me my pass"}
        {busy ? (
          <LoaderCircle size={18} className="spin" />
        ) : (
          <ArrowRight size={18} />
        )}
      </button>
      <p className="trust-line">
        <ShieldCheck size={14} />
        Your offer never requires marketing opt-in.
      </p>
    </form>
  );
}
export function PassActions({
  token,
  state,
  opened,
  merchant,
  subscribed,
  networkSubscribed,
  requestedChoices,
}: {
  token: string;
  state: string;
  opened: boolean;
  merchant: string;
  subscribed: boolean;
  networkSubscribed: boolean;
  requestedChoices: { merchant: boolean; network: boolean };
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function perform(action: string) {
    setBusy(true);
    setError("");
    try {
      await command({ action, token });
      setConfirm(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {state === "active" &&
        (!opened ? (
          <OpenPass
            token={token}
            merchant={merchant}
            requestedMerchant={requestedChoices.merchant && !subscribed}
            requestedNetwork={requestedChoices.network && !networkSubscribed}
          />
        ) : (
          <div className="pass-actions">
            {confirm ? (
              <div
                className="confirm-box"
                role="group"
                aria-label="Confirm redemption"
              >
                <h3>Is the cashier watching?</h3>
                <p>
                  This closes your pass. Redeem only after your receipt has been
                  checked.
                </p>
                <button
                  autoFocus
                  className="button full"
                  disabled={busy}
                  onClick={() => perform("redeem")}
                >
                  {busy ? "Recording redemption…" : "Yes, redeem my offer"}
                  <Check size={18} />
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  Not yet — keep my pass
                </button>
              </div>
            ) : (
              <>
                <button
                  className="button full"
                  onClick={() => setConfirm(true)}
                >
                  Redeem with the cashier
                  <ArrowRight size={18} />
                </button>
                <p className="fine center">
                  Only tap when you’re at the counter.
                </p>
              </>
            )}
          </div>
        ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {state === "redeemed" && (
        <div className="post-redeem">
          <p className="eyebrow">LET’S DO THIS AGAIN</p>
          <h2>
            Next time,
            <br />
            <em>something else is free.</em>
          </h2>
          <p>
            Get {merchant}’s next Weekly Drop. One simple offer, at most once a
            week.
          </p>
          <DropJoin token={token} merchant={merchant} subscribed={subscribed} />
        </div>
      )}
    </>
  );
}
function OpenPass({
  token,
  merchant,
  requestedMerchant,
  requestedNetwork,
}: {
  token: string;
  merchant: string;
  requestedMerchant: boolean;
  requestedNetwork: boolean;
}) {
  const [m, setM] = useState(requestedMerchant),
    [n, setN] = useState(requestedNetwork),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  const hasChoices = requestedMerchant || requestedNetwork;
  return (
    <div className="open-pass">
      {hasChoices && (
        <div className="private-choices">
          <p className="eyebrow">YOUR OPTIONAL CHOICES</p>
          <h3>Keep the good things coming?</h3>
          <p>You can turn these off and still use your pass.</p>
          {requestedMerchant && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={m}
                onChange={(e) => setM(e.target.checked)}
              />
              <span>
                <strong>{merchant}’s Weekly Drop</strong>
                <small>{disclosure("merchant", merchant)}</small>
              </span>
            </label>
          )}
          {requestedNetwork && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={n}
                onChange={(e) => setN(e.target.checked)}
              />
              <span>
                <strong>Uptick Local offers nearby</strong>
                <small>{disclosure("network", merchant)}</small>
              </span>
            </label>
          )}
        </div>
      )}
      <button
        className="button full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await command({
              action: "open-pass",
              token,
              merchant: m,
              network: n,
            });
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Opening your pass…"
          : hasChoices
            ? "Open my pass & save choices"
            : "Open my pass"}
        <ArrowRight size={18} />
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function DropJoin({
  token,
  merchant,
  subscribed,
}: {
  token: string;
  merchant: string;
  subscribed: boolean;
}) {
  const [joined, setJoined] = useState(subscribed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="drop-join">
      {joined ? (
        <p className="joined-state" role="status">
          <Check size={18} />
          You’re on the list. Watch for the next Drop.
        </p>
      ) : (
        <>
          <button
            className="button full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await command({
                  action: "join-drop",
                  token,
                });
                setJoined(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Joining…" : "Get the Weekly Drop"}
            <ArrowRight size={17} />
          </button>
          <p className="join-disclosure">{disclosure("merchant", merchant)}</p>
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
export function PreferenceForm({
  token,
  merchant,
  subscribed,
  networkSubscribed,
}: {
  token: string;
  merchant: string;
  subscribed: boolean;
  networkSubscribed: boolean;
}) {
  const [m, setM] = useState(subscribed);
  const [n, setN] = useState(networkSubscribed);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="preferences"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await command({
            action: "preferences",
            token,
            merchant: m,
            network: n,
          });
          setStatus("Your preferences are saved.");
        } catch (e) {
          setStatus((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="check-row">
        <input
          type="checkbox"
          checked={m}
          onChange={(e) => setM(e.target.checked)}
        />
        <span>
          {merchant}’s Weekly Drop
          <small>{disclosure("merchant", merchant)}</small>
        </span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={n}
          onChange={(e) => setN(e.target.checked)}
        />
        <span>
          Uptick Local offers nearby
          <small>{disclosure("network", merchant)}</small>
        </span>
      </label>
      <button className="button full" disabled={busy}>
        {busy ? "Saving…" : "Save my preferences"}
        <Check size={16} />
      </button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
export function SimpleForm({
  action,
  children,
  button = "Save",
  extra = {},
}: {
  action: string;
  children: ReactNode;
  button?: string;
  extra?: object;
}) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="stack-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setStatus("");
        setError("");
        const form = e.currentTarget;
        const values: Record<string, unknown> = Object.fromEntries(
          new FormData(form),
        );
        for (const input of Array.from(
          form.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
        ))
          values[input.name] = input.checked;
        try {
          const r = await command({ action, ...values, ...extra });
          setStatus(r.message || "Saved");
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : button}
        <ArrowUpRight size={16} />
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="success-text">
          {status}
        </p>
      )}
    </form>
  );
}
export function ReviewActions({ offer }: { offer: Offer }) {
  const [when, setWhen] = useState(() =>
    new Date(Math.max(Date.parse(offer.starts_at), Date.now() + 3600000))
      .toISOString()
      .slice(0, 16),
  );
  return (
    <div className="review-actions">
      <label>
        Send time · UTC
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </label>
      <p className="fine">
        The business uses {offer.timezone}. Promotional sends must fall between
        9 AM and 8 PM there.
      </p>
      <ActionButton
        action="approve"
        data={{ id: offer.id, scheduledAt: when ? `${when}:00.000Z` : "" }}
      >
        Approve & schedule
        <Check size={16} />
      </ActionButton>
    </div>
  );
}
