"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Search, Printer, Check } from "lucide-react";
import type { customerTimeline } from "@/lib/operator";
async function operatorCommand(data: object) {
  const response = await fetch("/api/operator-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Please try again.");
  return result;
}
export function OperatorForm({
  action,
  extra = {},
  children,
  button = "Save",
}: {
  action: string;
  extra?: object;
  children: ReactNode;
  button?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const router = useRouter();
  return (
    <form
      className="stack-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        setError("");
        setStatus("");
        try {
          const result = await operatorCommand({ action, ...values, ...extra });
          if (result.redirect) router.push(result.redirect);
          setStatus(result.message || "Saved.");
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
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="success-text" role="status">
          {status}
        </p>
      )}
    </form>
  );
}
export function PrintButton() {
  return (
    <button
      className="button secondary op-no-print"
      onClick={() => window.print()}
    >
      Print pilot sheet
      <Printer size={16} />
    </button>
  );
}
type Timeline = NonNullable<Awaited<ReturnType<typeof customerTimeline>>>;
export function CustomerLookup({
  businesses,
  initialOrganization = "",
  initialReference = "",
}: {
  businesses: { id: string; name: string }[];
  initialOrganization?: string;
  initialReference?: string;
}) {
  const [organizationId, setOrg] = useState(
      initialOrganization || businesses[0]?.id || "",
    ),
    [query, setQuery] = useState(initialReference),
    [result, setResult] = useState<Timeline | null>(null),
    [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <form
        className="op-search panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setResult(null);
          setSearched(false);
          try {
            const r = await operatorCommand({
              action: "customer-lookup",
              organizationId,
              query,
            });
            setResult(r.result);
            setSearched(true);
            setQuery("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Business
          <select
            required
            disabled={busy}
            value={organizationId}
            onChange={(e) => {
              setOrg(e.target.value);
              setResult(null);
              setSearched(false);
            }}
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phone, UP code, claim, message or private pass reference
          <input
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            placeholder="For example, UP-A1B2C3"
            maxLength={500}
          />
        </label>
        <button className="button" disabled={busy}>
          {busy ? "Looking up…" : "Find customer"}
          <Search size={16} />
        </button>
        <p className="fine">
          The lookup stays within one business. Results hide the phone number
          and private pass link.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
      {searched && !result && (
        <div className="panel op-empty">
          <h3>No matching relationship</h3>
          <p>
            Check the reference and selected business. Customers who have not
            claimed an offer do not have a journey here.
          </p>
        </div>
      )}
      {result && (
        <div className="op-two-col">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">CUSTOMER × MERCHANT</p>
                <h2>••• ••• {result.customer.phone_suffix}</h2>
              </div>
              <span className="badge mint">
                {result.claims.length} saved passes
              </span>
            </div>
            <div className="op-timeline">
              {result.events.map((event) => (
                <article key={event.id}>
                  <span className={`op-event-dot ${event.tone}`} />
                  <div>
                    <time>
                      {new Date(event.at).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                    <h3>{event.title}</h3>
                    <p>{event.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <aside className="panel op-support">
            <p className="eyebrow">CURRENT RELATIONSHIP</p>
            <h2>The next useful check.</h2>
            <dl>
              <dt>Weekly Drop</dt>
              <dd>{result.subscriptions[0]?.state || "No subscription"}</dd>
              <dt>Recorded redemptions</dt>
              <dd>
                {result.claims.filter((c) => c.state === "redeemed").length}
              </dd>
            </dl>
            <div className="op-explainer">
              <Check size={19} />
              <p>
                Redemption history is permanent. A mistaken redemption is a
                staff support decision; a second redemption is never silently
                created.
              </p>
            </div>
            <h3>When a text is missing</h3>
            <p>
              Check the message state and callback. “Accepted” confirms the
              provider took the message. “Delivered” is a carrier report, never
              a read receipt.
            </p>
            <h3>When texts are stopped</h3>
            <p>
              The customer must reply START to the same sender. Uptick does not
              override a customer’s STOP.
            </p>
            <p className="fine">
              Anonymous source visits cannot be attached to a person. The
              timeline starts with their accepted claim.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}
