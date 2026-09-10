"use client";

import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
  const valid = nodes.filter(
    (node) => Number.isFinite(node.latitude) && Number.isFinite(node.longitude),
  );
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
          href={`https://www.google.com/maps/search/?api=1&query=${active.latitude},${active.longitude}`}
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
