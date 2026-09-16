/* The operator's home screen.

   Layout follows the order an operator actually thinks in:
     1. Is anything wrong right now?           → attention strip
     2. What is this week's shape?             → four stats
     3. Where is it happening and what broke?  → Market Cell map
     4. Can we open enrollment?                → system readiness
     5. What do I do next?                     → this week's focus

   The map is not decoration. It answers "which counter is unreliable and how
   far is it from the members we admitted" in one look, which a table of
   addresses cannot. Where coordinates are missing it degrades to the same
   information as a labelled list rather than inventing positions. */
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  MapPin,
  Navigation,
  TriangleAlert,
} from "lucide-react";
import type { commandCentre, DestinationPin } from "@/lib/command-centre";
import type { PilotConstraint } from "@/lib/pilot-operations";
import { Dot, Pill, Row, Stat, WeekSwitch, type Tone } from "./system";

type Centre = Awaited<ReturnType<typeof commandCentre>>;

const pinTone: Record<DestinationPin["state"], Tone> = {
  active: "ok",
  low_supply: "warn",
  not_ready: "warn",
  outage: "bad",
};
const pinWord: Record<DestinationPin["state"], string> = {
  active: "Active",
  low_supply: "Low supply",
  not_ready: "Not ready",
  outage: "Outage",
};

function greeting(at = new Date()) {
  const hour = at.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Equirectangular projection, adequate at neighbourhood scale. */
function project(pins: DestinationPin[]) {
  const placed = pins.filter(
    (p) => p.latitude !== null && p.longitude !== null,
  ) as (DestinationPin & { latitude: number; longitude: number })[];
  if (placed.length === 0) return null;
  const lats = placed.map((p) => p.latitude);
  const lngs = placed.map((p) => p.longitude);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const scaleX = Math.cos((midLat * Math.PI) / 180);
  const spanLat = Math.max(0.004, Math.max(...lats) - Math.min(...lats));
  const spanLng = Math.max(
    0.004,
    (Math.max(...lngs) - Math.min(...lngs)) * scaleX,
  );
  const span = Math.max(spanLat, spanLng) * 1.55;
  const centreLat = midLat;
  const centreLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  return {
    centre: { x: 50, y: 50 },
    points: placed.map((p) => ({
      pin: p,
      x: 50 + ((p.longitude - centreLng) * scaleX * 100) / span,
      y: 50 - ((p.latitude - centreLat) * 100) / span,
    })),
    unplaced: pins.filter((p) => p.latitude === null || p.longitude === null),
  };
}

function MarketMap({ pins }: { pins: DestinationPin[] }) {
  const projected = project(pins);
  return (
    <div className="cc-map">
      {projected ? (
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label="Market Cell destinations"
        >
          <defs>
            <radialGradient id="cc-cell" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#cfe9dd" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#cfe9dd" stopOpacity="0.05" />
            </radialGradient>
          </defs>
          <rect width="100" height="100" fill="#f1f4ec" />
          {/* street grid: orientation cue only, not a real road network */}
          <g stroke="#e3e5d8" strokeWidth="0.6">
            {[18, 34, 50, 66, 82].map((v) => (
              <line key={`h${v}`} x1="0" y1={v} x2="100" y2={v} />
            ))}
            {[16, 32, 50, 68, 84].map((v) => (
              <line key={`v${v}`} x1={v} y1="0" x2={v} y2="100" />
            ))}
          </g>
          {/* the Market Cell itself */}
          <circle cx="50" cy="50" r="34" fill="url(#cc-cell)" />
          {[16, 25, 34].map((r) => (
            <circle
              key={r}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="#8fc3ae"
              strokeWidth="0.35"
              strokeDasharray="1.6 1.8"
              opacity="0.8"
            />
          ))}
          <circle cx="50" cy="50" r="1.6" fill="#1f4a3d" />
          {projected.points.map(({ pin, x, y }) => {
            const colour =
              pin.state === "outage"
                ? "#c0453a"
                : pin.state === "active"
                  ? "#2f9e6f"
                  : "#e2a24f";
            return (
              <g key={pin.supplyId}>
                <circle cx={x} cy={y} r="5.4" fill={colour} opacity="0.16" />
                <circle
                  cx={x}
                  cy={y}
                  r="2.6"
                  fill={colour}
                  stroke="#fff"
                  strokeWidth="0.9"
                />
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="cc-map-empty">
          <MapPin size={20} />
          <p>
            No destination coordinates recorded yet. Add a latitude and
            longitude to each market location to see them placed here.
          </p>
        </div>
      )}
      <ul className="cc-legend">
        {(["active", "low_supply", "not_ready", "outage"] as const).map((s) => (
          <li key={s}>
            <Dot tone={pinTone[s]} />
            {pinWord[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DestinationCard({ pin }: { pin: DestinationPin }) {
  return (
    <li className={`cc-dest ${pin.state}`}>
      <div className="cc-dest-head">
        <strong>{pin.label}</strong>
        <Pill tone={pinTone[pin.state]}>{pinWord[pin.state]}</Pill>
      </div>
      <p className="cc-dest-item">{pin.item}</p>
      <p className="cc-dest-why">{pin.why}</p>
      <dl className="cc-dest-figures">
        <div>
          <dt>Issued</dt>
          <dd>{pin.issued}</dd>
        </div>
        <div>
          <dt>Redeemed</dt>
          <dd>{pin.redeemed}</dd>
        </div>
        <div>
          <dt>Fallback left</dt>
          <dd>{pin.fallbackAvailable}</dd>
        </div>
        {pin.driveMinutes !== null && (
          <div>
            <dt>Drive</dt>
            <dd>{pin.driveMinutes} min</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

export function CommandCentre({
  centre,
  run,
  marketName,
  operatorName,
  constraints,
  readiness,
  weekHref,
}: {
  centre: Centre;
  run: { name: string; state: string; target_members: number };
  marketName: string;
  operatorName: string;
  constraints: PilotConstraint[];
  readiness: {
    key: string;
    label: string;
    tone: Tone;
    why: string;
    href?: string;
  }[];
  weekHref: (week: string) => string;
}) {
  const redeemRate = centre.issued
    ? Math.round((centre.redeemed / centre.issued) * 100)
    : 0;
  const priorRate = centre.priorIssued
    ? Math.round((centre.priorRedeemed / centre.priorIssued) * 100)
    : null;
  const nextUnbacked = centre.backing.find((w) => !w.released && w.short > 0);
  const blocking = constraints.filter((c) => c.urgency === "bad");
  const windowLabel = `${centre.weekWindow.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(centre.weekWindow.end.getTime() - 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <div className="command-centre">
      <header className="cc-top">
        <div>
          <h1>
            {greeting()}, {operatorName}.
          </h1>
          <p>
            Here’s what’s happening in {marketName}.{" "}
            <span className="cc-run">{run.name}</span>
          </p>
        </div>
        <WeekSwitch
          label={`Week ${centre.weekIndex} (${windowLabel})`}
          prev={centre.prevWeek ? weekHref(centre.prevWeek) : undefined}
          next={centre.nextWeek ? weekHref(centre.nextWeek) : undefined}
        />
      </header>

      {/* The single most important line on the screen. */}
      {blocking.length > 0 ? (
        <div className="cc-alarm u-rise">
          <TriangleAlert size={18} />
          <div>
            <strong>
              {blocking.length === 1
                ? "One thing is blocking this pilot."
                : `${blocking.length} things are blocking this pilot.`}
            </strong>
            <p>{blocking[0].text}</p>
          </div>
          {blocking[0].href && (
            <Link href={blocking[0].href} className="cc-alarm-go">
              Open <ArrowRight size={15} />
            </Link>
          )}
        </div>
      ) : (
        <div className="cc-calm u-rise">
          <CircleCheck size={17} />
          <span>
            Nothing is blocking this pilot right now.
            {nextUnbacked
              ? ` ${nextUnbacked.label} is still ${nextUnbacked.short} short of the ${nextUnbacked.required} members you have admitted.`
              : " All four weeks are backed for the cohort you have admitted."}
          </span>
        </div>
      )}

      <div className="u-stats cc-stats u-rise u-rise-2">
        <Stat
          label="Members"
          value={centre.admitted}
          foot={
            centre.waitlisted
              ? `${centre.waitlisted} waitlisted · cap ${run.target_members}`
              : `Admitted against a ${run.target_members} target`
          }
          tone={centre.waitlisted ? "warn" : undefined}
        />
        <Stat
          label="Benefits issued"
          value={centre.issued}
          foot={
            centre.released
              ? `Released for week ${centre.weekIndex}`
              : `Week ${centre.weekIndex} not released yet`
          }
          tone={centre.released ? "ok" : "idle"}
        />
        <Stat
          label="Redemptions"
          value={centre.redeemed}
          foot={
            centre.issued
              ? `${redeemRate}% of issued${priorRate === null ? "" : ` · ${priorRate}% prior weeks`}`
              : "Nothing issued to redeem yet"
          }
          tone={centre.issued ? "ok" : "idle"}
        />
        <Stat
          label="At risk"
          value={centre.atRisk}
          attention={centre.atRisk > 0}
          foot={
            centre.atRisk
              ? `${centre.openIncidents} open incident(s) · ${centre.pins.filter((p) => p.state === "outage" || p.state === "not_ready").length} destination(s)`
              : "No open incidents or unavailable counters"
          }
          tone={centre.atRisk ? "bad" : "ok"}
        />
      </div>

      <div className="cc-grid u-rise u-rise-3">
        <section className="u-card u-card-pad cc-panel-map">
          <div className="u-head">
            <h2>{marketName}</h2>
            <Link href="/operator/network/markets">
              Market setup <ArrowRight size={13} />
            </Link>
          </div>
          <MarketMap pins={centre.pins} />
          {centre.pins.length ? (
            <ul className="cc-dests">
              {[...centre.pins]
                .sort(
                  (a, b) =>
                    ["outage", "not_ready", "low_supply", "active"].indexOf(
                      a.state,
                    ) -
                    ["outage", "not_ready", "low_supply", "active"].indexOf(
                      b.state,
                    ),
                )
                .map((pin) => (
                  <DestinationCard key={pin.supplyId} pin={pin} />
                ))}
            </ul>
          ) : (
            <p className="cc-none">
              No supply is committed to week {centre.weekIndex} yet. Back this
              week before releasing it.
            </p>
          )}
        </section>

        <div className="cc-side">
          <section className="u-card u-card-pad">
            <div className="u-head">
              <h2>System readiness</h2>
              <Link href="/operator/pilot/settings">
                View all <ArrowRight size={13} />
              </Link>
            </div>
            <div className="u-rows">
              {readiness.map((item) => (
                <Row
                  key={item.key}
                  tone={item.tone}
                  title={item.label}
                  why={item.why}
                />
              ))}
            </div>
          </section>

          <section className="u-card u-card-pad">
            <div className="u-head">
              <h2>Four-week backing</h2>
            </div>
            <ol className="cc-weeks">
              {centre.backing.map((w) => (
                <li
                  key={w.week}
                  className={w.current ? "cc-week current" : "cc-week"}
                >
                  <span className="cc-week-name">
                    {w.label}
                    {w.current && <em>now</em>}
                  </span>
                  <span className="cc-week-bar" aria-hidden="true">
                    <i
                      className={w.short ? "short" : "full"}
                      style={{
                        width: `${Math.min(100, w.required ? (w.capacity / w.required) * 100 : 100)}%`,
                      }}
                    />
                  </span>
                  <span className="cc-week-fig">
                    {w.released ? (
                      <Pill tone="ok">Released</Pill>
                    ) : w.short ? (
                      <Pill tone="bad">{w.short} short</Pill>
                    ) : (
                      <Pill tone="ok">Backed</Pill>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            <p className="cc-weeks-note">
              Backing compares each week’s usable supply with the{" "}
              {centre.admitted} members already admitted — not the original
              target.
            </p>
          </section>
        </div>
      </div>

      <section className="u-card u-card-pad cc-focus u-rise u-rise-3">
        <div className="u-head">
          <h2>This week’s focus</h2>
          <span className="u-head-action">
            {constraints.length
              ? `${constraints.length} open`
              : "Nothing outstanding"}
          </span>
        </div>
        {constraints.length ? (
          <ul className="cc-focus-list">
            {constraints.map((c, i) => (
              <li key={`${c.category}-${i}`}>
                <Dot tone={c.urgency} />
                <span className="cc-focus-text">{c.text}</span>
                <span className="cc-focus-cat">{c.category}</span>
                {c.href ? (
                  <Link href={c.href} className="cc-focus-go">
                    Open <ArrowRight size={13} />
                  </Link>
                ) : (
                  <Link
                    href="/operator/pilot?view=setup"
                    className="cc-focus-go"
                  >
                    Setup <ArrowRight size={13} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="cc-focus-clear">
            <CircleCheck size={18} />
            <div>
              <strong>Everything recorded for this week.</strong>
              <p>
                Next: confirm week {Math.min(4, centre.weekIndex + 1)} supply
                and keep destination readiness inside its 72-hour window.
              </p>
            </div>
          </div>
        )}
        <div className="cc-quick">
          <Link href="/operator/pilot/fulfillment">
            <Navigation size={15} /> Store operations
          </Link>
          <Link href="/operator/pilot/support">
            <AlertTriangle size={15} /> Member support
            {centre.support.open > 0 && (
              <em className="cc-badge">{centre.support.open}</em>
            )}
          </Link>
          <Link href="/operator/network/messaging">
            <MapPin size={15} /> Messaging
            {centre.failedMessages > 0 && (
              <em className="cc-badge warn">{centre.failedMessages}</em>
            )}
          </Link>
        </div>
      </section>
    </div>
  );
}
