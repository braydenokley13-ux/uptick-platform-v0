"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  MapPin,
  Share2,
  Smartphone,
} from "lucide-react";
import {
  MARKETING_SMS_DISCLOSURE,
  MEMBERSHIP_TERMS,
} from "@/lib/membership-copy";
import { navigationOptions } from "@/lib/location-intelligence";
type Result = {
  ok?: boolean;
  error?: string;
  message?: string;
  redirect?: string;
  privateUrl?: string;
  development?: boolean;
  url?: string;
  codes?: string[];
};
async function action(body: object): Promise<Result> {
  let response: Response;
  try {
    response = await fetch("/api/member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw Error(
      "The connection was interrupted. Check the current page before trying again; your request may already have completed.",
    );
  }
  let result: Result;
  try {
    result = await response.json();
  } catch {
    throw Error(
      "The server returned an unreadable response. Check the current page before trying again; your request may already have completed.",
    );
  }
  if (!response.ok) throw Error(result.error || "Please try again.");
  return result;
}
export function JoinUptick({
  sourceToken,
  referralToken,
  demo = false,
}: {
  sourceToken?: string;
  referralToken?: string;
  demo?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Result | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      setResult(
        await action({
          action: "join",
          phone: form.get("phone"),
          homeZip: form.get("homeZip"),
          workZip: form.get("workZip") || "",
          consentRequested: form.get("consent") === "on",
          ageAttested: form.get("adult") === "on",
          sourceToken,
          referralToken,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }
  if (result)
    return (
      <div className="member-sent" role="status">
        <span className="member-round-icon">
          <Smartphone size={25} />
        </span>
        <p className="eyebrow">ONE SMALL STEP</p>
        <h2>
          {result.development
            ? "Your local test is ready."
            : "Check your texts."}
        </h2>
        <p>
          {result.development
            ? "No text was sent. Use this private link to test the same membership flow."
            : "When your text arrives, open its private Uptick link. Confirm your membership there to see your local Drop."}
        </p>
        {result.privateUrl && (
          <Link className="button" href={result.privateUrl}>
            Open my Uptick <ArrowRight size={16} />
          </Link>
        )}
        <p className="fine">
          Keep your private link to yourself. It opens your membership.
        </p>
        <button className="text-link" onClick={() => setResult(null)}>
          Use a different number
        </button>
      </div>
    );
  return (
    <form onSubmit={submit} className="member-join-form">
      <label>
        Mobile number
        <div className="phone-entry">
          <span>US +1</span>
          <input
            required
            name="phone"
            type="tel"
            autoComplete="tel-national"
            inputMode="tel"
            placeholder="(201) 555-0123"
            defaultValue={demo ? "2025550123" : ""}
            readOnly={demo}
          />
        </div>
      </label>
      <div className="member-zip-row">
        <label>
          Home ZIP
          <input
            name="homeZip"
            required
            inputMode="numeric"
            autoComplete="postal-code"
            pattern="[0-9]{5}"
            maxLength={5}
            placeholder="10583"
            defaultValue={demo ? "10583" : ""}
          />
        </label>
        <label>
          Work ZIP <small>optional</small>
          <input
            name="workZip"
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            placeholder="Nearby too?"
          />
        </label>
      </div>
      <label className="member-consent">
        <input name="adult" type="checkbox" required />
        <span>I confirm that I am 18 or older and want to join Uptick.</span>
      </label>
      <p className="member-disclosure">{MEMBERSHIP_TERMS}</p>
      <label className="member-consent">
        <input name="consent" type="checkbox" />
        <span>I also want promotional texts about my weekly Uptick.</span>
      </label>
      <button disabled={busy} className="button member-full">
        {busy ? "Saving your invitation…" : "Join Uptick — it’s free"}
        <ArrowUpRight size={17} />
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="member-disclosure">
        {MARKETING_SMS_DISCLOSURE} <Link href="/sms">SMS terms</Link> ·{" "}
        <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
      </p>
    </form>
  );
}
export function ConfirmMembership({
  token,
  requested,
  disclosure,
}: {
  token: string;
  requested: boolean;
  disclosure: string;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(requested),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="member-confirm">
      {requested && (
        <>
          <label className="member-consent">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              Yes, send me optional promotional texts about my weekly Uptick.
            </span>
          </label>
          <p className="member-disclosure">{disclosure}</p>
        </>
      )}
      <button
        className="button member-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await action({
              action: "confirm",
              token,
              acceptMarketing: accepted,
            });
            router.push("/your-uptick");
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Try again.");
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Opening your Uptick…"
          : requested
            ? "Join & open my Uptick"
            : "Join & open my Uptick"}
        <ArrowRight size={17} />
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function ClaimUptick({
  supplyId,
  disabled = false,
}: {
  supplyId: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        className="button member-full"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await action({ action: "claim", supplyId });
            if (result.redirect) window.location.assign(result.redirect);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Try again.");
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Saving your pass…"
          : disabled
            ? "Currently unavailable"
            : "Claim this Uptick"}
        <ArrowRight size={16} />
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function MemberViewEvent({
  supplyId,
  children,
}: {
  supplyId: string;
  children: React.ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void action({ action: "view", supplyId }).catch(() => {});
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [supplyId]);
  return <div ref={element}>{children}</div>;
}
export function PairUptick({ token }: { token: string }) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        className="button member-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await action({ action: "pair", token });
            setMessage(result.message || "Ready.");
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Smartphone size={17} />
        {busy ? "Getting ready…" : "Use this pass at Uptick Tap"}
      </button>
      {message && (
        <p className="member-inline-result" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function InviteMember({ supplyId }: { supplyId?: string }) {
  const [url, setUrl] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="member-share">
      <button
        className="text-link"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await action({ action: "share", supplyId });
            if (result.url)
              setUrl(new URL(result.url, window.location.origin).href);
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Share2 size={15} />
        {supplyId ? "Share this Uptick" : "Invite someone to Uptick"}
        <ArrowUpRight size={14} />
      </button>
      {url && (
        <div className="member-share-result">
          <label>
            Your invitation link
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setMessage("Invitation link copied.");
              } catch {
                setMessage("Select and copy your invitation link above.");
              }
            }}
          >
            Copy link
          </button>
          <p className="fine">
            Your own pass stays private. Friends join Uptick and claim from
            available local inventory.
          </p>
        </div>
      )}
      {message && (
        <p role="status" className="fine">
          {message}
        </p>
      )}
    </div>
  );
}
export function MemberPreferences({
  homeZip,
  workZip,
  subscribed,
}: {
  homeZip: string;
  workZip: string | null;
  subscribed: boolean;
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="member-join-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        try {
          const r = await action({
            action: "preferences",
            homeZip: form.get("homeZip"),
            workZip: form.get("workZip") || "",
            subscribed: form.get("subscribed") === "on",
          });
          setMessage(r.message || "Saved.");
        } catch (e) {
          setMessage(e instanceof Error ? e.message : "Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="member-zip-row">
        <label>
          Home ZIP
          <input
            name="homeZip"
            defaultValue={homeZip}
            pattern="[0-9]{5}"
            maxLength={5}
            required
            inputMode="numeric"
          />
        </label>
        <label>
          Work ZIP <small>optional</small>
          <input
            name="workZip"
            defaultValue={workZip || ""}
            pattern="[0-9]{5}"
            maxLength={5}
            inputMode="numeric"
          />
        </label>
      </div>
      <label className="member-consent">
        <input name="subscribed" type="checkbox" defaultChecked={subscribed} />
        <span>Send me optional promotional Uptick texts.</span>
      </label>
      <p className="member-disclosure">{MARKETING_SMS_DISCLOSURE}</p>
      <button disabled={busy} className="button">
        {busy ? "Saving…" : "Save my preferences"}
        <Check size={16} />
      </button>
      {message && (
        <p role="status" className="member-inline-result">
          {message}
        </p>
      )}
      <p className="fine">
        Turning texts off keeps already-issued passes valid. Carrier STOP
        settings are separate; reply START to your Uptick number before
        requesting texts again.
      </p>
    </form>
  );
}

export function RecoverMemberAccess() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="member-fine-details">
      <summary>Lost access? Use a recovery code</summary>
      <form
        className="member-join-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            const result = await action({
              action: "recover",
              phone: form.get("phone"),
              code: form.get("code"),
            });
            if (result.redirect) {
              router.push(result.redirect);
              router.refresh();
            }
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Mobile number
          <input name="phone" type="tel" autoComplete="tel" required />
        </label>
        <label>
          One-use recovery code
          <input
            name="code"
            autoComplete="off"
            placeholder="ABCDE-FGHIJ-KLMNO-PQRST"
            required
          />
        </label>
        <button className="button secondary" disabled={busy}>
          {busy ? "Checking…" : "Recover Your Uptick"}
        </button>
        {message && <p role="alert">{message}</p>}
      </form>
    </details>
  );
}

export function MemberAccountControls() {
  const router = useRouter();
  const [codes, setCodes] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{
    kind: "error" | "status";
    text: string;
  } | null>(null);
  const [operation, setOperation] = useState<
    "withdrawal" | "recovery-codes" | "signout" | null
  >(null);
  const busy = operation !== null;
  const withdrawalKey = useRef<string | null>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (feedback?.kind === "error") errorMessage.current?.focus();
  }, [feedback]);

  return (
    <section className="member-share" aria-busy={busy}>
      <details className="member-fine-details">
        <summary>Withdraw from future weekly benefits</summary>
        <p>
          Withdrawal stops future weekly releases for you. Already-issued
          benefits, their recovery, and support remain available. Turning
          promotional texts off is a separate choice above.
        </p>
        <form
          className="member-join-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const requestKey = withdrawalKey.current || crypto.randomUUID();
            withdrawalKey.current = requestKey;
            setOperation("withdrawal");
            setFeedback(null);
            try {
              const result = await action({
                action: "withdraw",
                reason: form.get("reason"),
                requestKey,
              });
              withdrawalKey.current = null;
              setFeedback({
                kind: "status",
                text: result.message || "Withdrawal recorded.",
              });
              router.refresh();
            } catch (error) {
              setFeedback({
                kind: "error",
                text:
                  error instanceof Error ? error.message : "Please try again.",
              });
            } finally {
              setOperation(null);
            }
          }}
        >
          <label>
            Note for Uptick support
            <textarea
              name="reason"
              minLength={10}
              maxLength={1500}
              required
              disabled={busy}
              defaultValue="I choose to stop receiving future weekly benefits."
              onChange={() => {
                withdrawalKey.current = null;
              }}
            />
          </label>
          <label className="member-consent">
            <input
              type="checkbox"
              required
              disabled={busy}
              onChange={() => {
                withdrawalKey.current = null;
              }}
            />
            <span>I want to withdraw from future weekly releases.</span>
          </label>
          <button type="submit" className="button secondary" disabled={busy}>
            {operation === "withdrawal"
              ? "Recording withdrawal…"
              : "Confirm withdrawal"}
          </button>
        </form>
      </details>
      <h2>Keep access without SMS</h2>
      <p>
        Create one-use recovery codes, print or save them somewhere private, and
        use one with your current phone number if this browser session is lost.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setOperation("recovery-codes");
          setFeedback(null);
          try {
            const result = await action({ action: "recovery-codes" });
            setCodes(result.codes || []);
            setFeedback({
              kind: "status",
              text: "These codes replace any older unused codes. Each works once.",
            });
          } catch (error) {
            setFeedback({
              kind: "error",
              text: error instanceof Error ? error.message : "Try again.",
            });
          } finally {
            setOperation(null);
          }
        }}
      >
        {operation === "recovery-codes"
          ? "Creating…"
          : "Create new recovery codes"}
      </button>
      {codes.length > 0 && (
        <div className="member-share-result">
          <ol>
            {codes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => window.print()}
          >
            Print these codes
          </button>
        </div>
      )}
      {feedback?.kind === "status" && <p role="status">{feedback.text}</p>}
      {feedback?.kind === "error" && (
        <p ref={errorMessage} tabIndex={-1} role="alert" className="form-error">
          {feedback.text}
        </p>
      )}
      <button
        type="button"
        className="text-link"
        disabled={busy}
        onClick={async () => {
          setOperation("signout");
          setFeedback(null);
          try {
            const result = await action({ action: "signout" });
            router.push(result.redirect || "/join");
            router.refresh();
          } catch (error) {
            setFeedback({
              kind: "error",
              text: error instanceof Error ? error.message : "Try again.",
            });
          } finally {
            setOperation(null);
          }
        }}
      >
        {operation === "signout" ? "Signing out…" : "Sign out of this browser"}
      </button>
    </section>
  );
}

export function MemberHelp({
  grantId = null,
  recoveryState = null,
}: {
  grantId?: string | null;
  recoveryState?: string | null;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const incidentKey = useRef<string | null>(null);
  const incidentAvailable = Boolean(grantId);
  return (
    <details className="member-fine-details">
      <summary>Get help with this Uptick</summary>
      <form
        className="member-join-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          setBusy(true);
          try {
            const result = await action({
              action: incidentAvailable ? "incident" : "help",
              grantId: incidentAvailable ? grantId : undefined,
              incidentType: incidentAvailable
                ? form.get("incidentType")
                : undefined,
              idempotencyKey: incidentAvailable
                ? (incidentKey.current ||= crypto.randomUUID())
                : undefined,
              message: form.get("message") || undefined,
            });
            setMessage(result.message || "Your request is queued.");
            incidentKey.current = null;
            formElement.reset();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Uptick attaches your membership and current benefit context. A
          fulfillment report keeps the original pass history and lets support
          attach a capacity-backed recovery to that same pass.
        </p>
        {recoveryState && (
          <p className="fine">
            Recovery status: {recoveryState.replaceAll("_", " ")}.
          </p>
        )}
        {incidentAvailable && (
          <label>
            What failed?
            <select name="incidentType" defaultValue="out_of_stock">
              <option value="out_of_stock">
                Promised item was out of stock
              </option>
              <option value="staff_refusal">Staff could not honor it</option>
              <option value="unexpected_closure">
                The location was unexpectedly closed
              </option>
              <option value="incorrect_terms">
                The counter used different terms
              </option>
              <option value="qr_failure">The QR did not work</option>
              <option value="redemption_failure">
                The screen redeemed, but fulfillment failed
              </option>
              <option value="inventory_mismatch">
                The available item did not match
              </option>
              <option value="other">Something else</option>
            </select>
          </label>
        )}
        <label>
          What happened? <small>optional</small>
          <textarea name="message" maxLength={2000} />
        </label>
        <button className="button secondary" disabled={busy}>
          {busy
            ? "Sending…"
            : incidentAvailable
              ? "Report fulfillment problem"
              : "Send to Uptick support"}
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}

export function NavigationLinks({
  address,
  latitude,
  longitude,
  supplyId,
  passToken,
  available = true,
}: {
  address: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  supplyId?: string;
  passToken?: string;
  available?: boolean;
}) {
  const [error, setError] = useState("");
  if (!available)
    return (
      <p role="status" className="fine">
        This destination is temporarily unavailable. Please do not travel there.
        Your benefit remains recorded; contact Uptick support for recovery.
      </p>
    );
  const links = navigationOptions({ address, latitude, longitude });
  if (!links.length)
    return (
      <p className="fine">
        Directions are unavailable until this location has a recorded address.
      </p>
    );
  return (
    <details className="member-directions">
      <summary>
        <MapPin size={15} /> Get directions <ArrowUpRight size={14} />
      </summary>
      <div>
        {links.map((link) => (
          <a
            key={link.provider}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={async (event) => {
              event.preventDefault();
              setError("");
              try {
                if (passToken)
                  await action({
                    action: "pass-directions",
                    token: passToken,
                    provider: link.provider,
                  });
                else if (supplyId)
                  await action({
                    action: "directions",
                    supplyId,
                    provider: link.provider,
                  });
                window.location.assign(link.url);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Directions are temporarily unavailable.",
                );
              }
            }}
          >
            {link.name}
            {link.action === "search" ? " · find destination" : ""}
            <ArrowUpRight size={14} />
          </a>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <p className="fine">
        Opens your chosen map. Uptick doesn’t track your trip.
      </p>
    </details>
  );
}
