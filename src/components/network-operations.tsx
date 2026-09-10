"use client";

import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { NetworkMemberSupport } from "@/lib/network-operations";
import {
  recordedCoordinates,
  recordedLocationUrl,
} from "@/lib/location-intelligence";
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  MapPin,
  Store,
  Users,
} from "lucide-react";

async function networkCommand(values: object) {
  let response: Response;
  try {
    response = await fetch("/api/network-ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
  } catch {
    throw Error(
      "The network workspace could not be reached. Please try again.",
    );
  }
  const result = await response.json().catch(() => {
    throw Error("The service is temporarily unavailable. Please try again.");
  });
  if (!response.ok)
    throw Error(result.error || "The change could not be saved.");
  return result;
}

export function NetworkForm({
  action,
  extra = {},
  button = "Save changes",
  children,
  quiet = false,
}: {
  action: string;
  extra?: object;
  button?: string;
  children?: ReactNode;
  quiet?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const router = useRouter();
  const statusId = useId();
  return (
    <form
      className="network-form"
      aria-describedby={statusId}
      onSubmit={async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true);
        setError("");
        setStatus("");
        try {
          const result = await networkCommand({ action, ...values, ...extra });
          setStatus(
            result.message || "Saved. The workspace now reflects this change.",
          );
          if (result.redirect) router.push(result.redirect);
          router.refresh();
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>{children}</fieldset>
      <button className={`button ${quiet ? "secondary" : ""}`} disabled={busy}>
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <ArrowUpRight size={16} />
        )}
        {busy ? "Saving…" : button}
      </button>
      <div id={statusId}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="success-text" role="status">
            <Check size={14} />
            {status}
          </p>
        )}
      </div>
    </form>
  );
}

export function NetworkMemberLookup() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<NetworkMemberSupport | null>(null);
  const at = (value: string) =>
    new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  return (
    <section className="panel network-panel" style={{ marginTop: 24 }}>
      <p className="eyebrow">PROTECTED MEMBER SUPPORT · ALL MARKETS</p>
      <h2>Find the person behind a question.</h2>
      <p>
        Enter the member’s exact US phone number to inspect their recorded
        journey, including a signup with no claim yet. Every lookup is audited.
        Private links and complete phone numbers are excluded from results.
      </p>
      <form
        className="network-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const phone = new FormData(event.currentTarget).get("phone");
          setBusy(true);
          setError("");
          setStatus("");
          setResult(null);
          try {
            const data = await networkCommand({
              action: "member-lookup",
              phone,
            });
            setResult(data.memberSupport);
            setStatus(data.message);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Member phone number
            <input
              name="phone"
              type="tel"
              required
              autoComplete="off"
              placeholder="(201) 555-0123"
              onChange={() => {
                setResult(null);
                setStatus("");
                setError("");
              }}
            />
          </label>
        </fieldset>
        <button className="button secondary" disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Users size={16} />
          )}
          {busy ? "Finding member…" : "Find member"}
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
      {result && (
        <div style={{ marginTop: 28 }}>
          <div className="network-status-row">
            <strong>
              UL-{result.member.reference} · phone ending{" "}
              {result.member.phone_hint}
            </strong>
            <span className="badge neutral">{result.member.state}</span>
          </div>
          <dl className="network-supply-details">
            <div>
              <dt>Joined / phone possession</dt>
              <dd>
                {at(result.member.created_at)}
                <br />
                {result.member.verified_at
                  ? `Confirmed ${at(result.member.verified_at)}`
                  : "Phone not confirmed"}
              </dd>
            </div>
            <div>
              <dt>Market and explicit ZIPs</dt>
              <dd>
                {result.member.market || "No active market match"}
                <br />
                Home {result.member.home_zip}
                {result.member.work_zip
                  ? ` · Work ${result.member.work_zip}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Acquisition record</dt>
              <dd>
                {result.member.source || "Direct / source not recorded"}
                {result.member.channel ? ` · ${result.member.channel}` : ""}
                <br />
                {result.member.partner || "No acquisition partner"}
              </dd>
            </div>
            <div>
              <dt>Current membership consent</dt>
              <dd>
                {result.consents[0]?.accepted
                  ? "Accepted"
                  : result.consents.length
                    ? "Not subscribed"
                    : "No decision recorded"}
                <br />
                {result.suppressions.some(
                  (entry) => entry.active_sender && entry.suppressed,
                )
                  ? "Active Uptick sender is opted out"
                  : "No active-sender opt-out recorded"}
              </dd>
            </div>
          </dl>
          <div className="network-grid equal">
            <div>
              <h3>Saved weekly choices</h3>
              {result.allocations.length ? (
                result.allocations.map((allocation) => (
                  <div key={allocation.week_key} className="network-issue">
                    <div>
                      <strong>Week of {allocation.week_key}</strong>
                      {allocation.options.map((option) => (
                        <p key={option.rank}>
                          {option.rank === 1
                            ? "Featured"
                            : `Alternative ${option.rank - 1}`}{" "}
                          · {option.title} at {option.merchant} · {option.state}
                        </p>
                      ))}
                      <p>
                        Saved {at(allocation.created_at)} ·{" "}
                        {allocation.algorithm_version}. An allocation does not
                        reserve inventory.
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="network-evidence">
                  No saved allocation. Check phone confirmation, current
                  permission, the market state and available approved supply.
                </p>
              )}
            </div>
            <div>
              <h3>Claims and recorded redemption</h3>
              {result.claims.length ? (
                result.claims.map((claim) => (
                  <div key={claim.reference} className="network-issue">
                    <div>
                      <strong>
                        UP-{claim.reference} · {claim.merchant}
                      </strong>
                      <p>
                        {claim.reward}
                        <br />
                        Claimed {at(claim.created_at)}
                        {claim.redeemed_at
                          ? ` · Redeemed ${at(claim.redeemed_at)}`
                          : " · No redemption recorded"}
                      </p>
                      {claim.verification_method && (
                        <p>
                          {claim.verification_method.replaceAll("_", " ")} ·{" "}
                          {claim.staff_gated
                            ? "staff-controlled point"
                            : "not staff-controlled"}{" "}
                          ·{" "}
                          {claim.transaction_verified
                            ? "transaction verified"
                            : "purchase not verified"}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="network-evidence">
                  No claims yet. Membership signup and phone confirmation do not
                  imply a claim or visit.
                </p>
              )}
            </div>
          </div>
          <div className="network-grid equal">
            <div>
              <h3>Latest delivery outcomes</h3>
              {result.messages.length ? (
                result.messages.map((message, index) => (
                  <div className="network-issue" key={index}>
                    <div>
                      <strong>
                        {message.purpose === "drop"
                          ? "Weekly Uptick"
                          : "Requested access"}{" "}
                        · {message.state.replaceAll("_", " ")}
                      </strong>
                      <p>
                        {at(message.created_at)}
                        {message.suppression_reason
                          ? ` · ${message.suppression_reason}`
                          : ""}
                        {message.error_code
                          ? ` · Provider code ${message.error_code}`
                          : ""}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="network-evidence">
                  No membership delivery record.
                </p>
              )}
            </div>
            <div>
              <h3>Consent evidence</h3>
              {result.consents.length ? (
                result.consents.map((consent, index) => (
                  <details key={index} style={{ marginTop: 16 }}>
                    <summary>
                      {consent.accepted ? "Accepted" : "Declined / withdrawn"} ·{" "}
                      {at(consent.created_at)}
                    </summary>
                    <p className="network-evidence">{consent.disclosure}</p>
                    <p className="fine">
                      {consent.disclosure_version} · {consent.source_ui}
                    </p>
                  </details>
                ))
              ) : (
                <p className="network-evidence">
                  No membership consent event. An access request can exist
                  before a confirmed choice.
                </p>
              )}
            </div>
          </div>
          <details>
            <summary>Latest 20 observed / derived events</summary>
            <div className="network-table-wrap">
              <table className="network-table">
                <thead>
                  <tr>
                    <th>EVENT</th>
                    <th>EVIDENCE</th>
                    <th>TIME</th>
                  </tr>
                </thead>
                <tbody>
                  {result.events.map((event, index) => (
                    <tr key={index}>
                      <td>{event.kind.replaceAll("_", " ")}</td>
                      <td>{event.evidence_class}</td>
                      <td>{at(event.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

export type GeographicNode = {
  id: string;
  name: string;
  kind: "merchant" | "partner";
  latitude: number;
  longitude: number;
  address: string;
  detail: string;
  sample?: boolean;
};

// Only supplied coordinates are plotted. This deliberately has no synthetic roads,
// inferred member positions, travel-time claims, or live-location requests.
export function LocalCoordinateMap({ nodes }: { nodes: GeographicNode[] }) {
  const [selected, setSelected] = useState(nodes[0]?.id || "");
  const valid = nodes.filter((node) => recordedCoordinates(node) !== null);
  const active = valid.find((node) => node.id === selected) || valid[0];
  if (!active)
    return (
      <div className="network-map-empty">
        <MapPin size={25} />
        <h3>Put the real network on the map.</h3>
        <p>
          Add coordinates to merchant locations and acquisition partners. Only
          recorded locations appear here.
        </p>
      </div>
    );
  const south = Math.min(...valid.map((node) => node.latitude));
  const north = Math.max(...valid.map((node) => node.latitude));
  const west = Math.min(...valid.map((node) => node.longitude));
  const east = Math.max(...valid.map((node) => node.longitude));
  const latitudeSpan = Math.max(north - south, 0.01);
  const longitudeSpan = Math.max(east - west, 0.01);
  const centerLatitude = (south + north) / 2;
  const centerLongitude = (west + east) / 2;
  return (
    <div className="network-map-layout">
      <div
        className="network-coordinate-map"
        role="group"
        aria-label="Recorded merchant and acquisition partner coordinates"
      >
        <div className="network-map-north">
          N <span>↑</span>
        </div>
        <span className="network-map-coordinate">
          {centerLatitude.toFixed(4)}° / {centerLongitude.toFixed(4)}°
        </span>
        <span className="network-map-caption">
          RECORDED COORDINATES · NO ROUTE ESTIMATE
        </span>
        {valid.map((node, index) => {
          const x =
            12 +
            ((node.longitude - centerLongitude) / longitudeSpan + 0.5) * 76;
          const y =
            12 + ((centerLatitude - node.latitude) / latitudeSpan + 0.5) * 72;
          return (
            <button
              key={node.id}
              className={`network-map-pin ${node.kind} ${active.id === node.id ? "selected" : ""}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              onClick={() => setSelected(node.id)}
              aria-label={`${node.kind === "merchant" ? "Merchant" : "Acquisition partner"}: ${node.name}`}
              aria-pressed={active.id === node.id}
            >
              <span>{index + 1}</span>
              {node.kind === "merchant" ? (
                <Store size={18} />
              ) : (
                <Users size={18} />
              )}
            </button>
          );
        })}
      </div>
      <aside className="network-map-detail">
        <p className="eyebrow">
          {active.kind === "merchant"
            ? "REDEMPTION DESTINATION"
            : "ACQUISITION PARTNER"}
        </p>
        <h3>{active.name}</h3>
        <p>{active.address || "Address not recorded"}</p>
        <p className="network-map-evidence">{active.detail}</p>
        {active.sample && (
          <p className="fine">
            Illustrative sample coordinates. Confirm the real location before
            publishing.
          </p>
        )}
        <a
          className="text-link"
          href={recordedLocationUrl(active) || undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open recorded location <ArrowUpRight size={15} />
        </a>
        <div className="network-map-key">
          <span>
            <i className="merchant" />
            Merchant
          </span>
          <span>
            <i className="partner" />
            Acquisition partner
          </span>
        </div>
        <div className="network-map-node-list">
          {valid.map((node, index) => (
            <button
              key={node.id}
              className={node.id === active.id ? "active" : ""}
              onClick={() => setSelected(node.id)}
            >
              {String(index + 1).padStart(2, "0")} <span>{node.name}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
