"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  MapPin,
  Share2,
  Smartphone,
} from "lucide-react";
import { MEMBERSHIP_DISCLOSURE } from "@/lib/membership-copy";
import { navigationOptions } from "@/lib/location-intelligence";
type Result = {
  ok?: boolean;
  error?: string;
  message?: string;
  redirect?: string;
  privateUrl?: string;
  development?: boolean;
  url?: string;
};
async function action(body: object): Promise<Result> {
  const response = await fetch("/api/member", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let result: Result;
  try {
    result = await response.json();
  } catch {
    throw Error("The connection was interrupted. Please try again.");
  }
  if (!response.ok) throw Error(result.error || "Please try again.");
  return result;
}
export function JoinUptick({
  sourceToken,
  referralToken,
}: {
  sourceToken?: string;
  referralToken?: string;
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
        <input name="consent" type="checkbox" required />
        <span>I want to join Uptick and get my weekly Drop by text.</span>
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
        {MEMBERSHIP_DISCLOSURE} <Link href="/sms">SMS terms</Link> ·{" "}
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
              Yes, join Uptick’s free membership and send my weekly Drop by
              text.
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
              acceptMembership: accepted,
            });
            window.location.reload();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Try again.");
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Opening your Uptick…"
          : requested
            ? "Confirm & open my Uptick"
            : "Open my Uptick"}
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
  token,
  supplyId,
  disabled = false,
}: {
  token: string;
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
            const result = await action({ action: "claim", token, supplyId });
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
  token,
  supplyId,
  children,
}: {
  token: string;
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
          void action({ action: "view", token, supplyId }).catch(() => {});
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [token, supplyId]);
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
export function InviteMember({
  token,
  supplyId,
}: {
  token: string;
  supplyId?: string;
}) {
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
            const result = await action({ action: "share", token, supplyId });
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
  token,
  homeZip,
  workZip,
  subscribed,
}: {
  token: string;
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
            token,
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
        <span>Keep my Uptick membership texts on.</span>
      </label>
      <p className="member-disclosure">{MEMBERSHIP_DISCLOSURE}</p>
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
export function NavigationLinks({
  address,
  latitude,
  longitude,
  token,
  supplyId,
  passToken,
}: {
  address: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  token?: string;
  supplyId?: string;
  passToken?: string;
}) {
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
            onClick={() => {
              if (passToken)
                void action({
                  action: "pass-directions",
                  token: passToken,
                  provider: link.provider,
                }).catch(() => {});
              else if (token && supplyId)
                void action({
                  action: "directions",
                  token,
                  supplyId,
                  provider: link.provider,
                }).catch(() => {});
            }}
          >
            {link.name}
            {link.action === "search" ? " · find destination" : ""}
            <ArrowUpRight size={14} />
          </a>
        ))}
      </div>
      <p className="fine">
        Opens your chosen map. Uptick doesn’t track your trip.
      </p>
    </details>
  );
}
