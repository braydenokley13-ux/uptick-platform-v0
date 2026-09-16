/* Release readiness as a dependency map.

   A checklist tells you seven things are unfinished. It does not tell you which
   one to do first, or why the last row is red. This surface shows the actual
   shape of the problem: enrollment sits at the end of a chain, and the only
   useful next action is the earliest unmet link in it.

   Read left to right on a wide screen, top to bottom on a narrow one. Each
   column is a dependency layer: nothing in a column can be ready until
   everything it points back to is ready. */
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import type { Gate, GateKey } from "@/lib/operator-readiness";
import { gateTone } from "@/lib/operator-readiness";
import { Dot, Pill } from "./system";
import "./readiness-map.css";

const LAYERS: GateKey[][] = [
  ["software"],
  ["database"],
  ["identity", "messaging", "market"],
  ["support"],
  ["enrollment"],
];

const STATE_WORD: Record<Gate["state"], string> = {
  ready: "Ready",
  pending: "In progress",
  blocked: "Blocked",
  closed: "Held closed",
};

function expiry(value: string | null) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return "Evidence expired";
  const days = Math.floor(ms / 86400000);
  return days >= 1
    ? `Evidence expires in ${days} day${days === 1 ? "" : "s"}`
    : "Evidence expires today";
}

function GateCard({ gate, critical }: { gate: Gate; critical: boolean }) {
  const tone = gateTone[gate.state];
  const expires = expiry(gate.expiresAt);
  return (
    <article
      className={`rm-gate ${gate.state}${critical ? " critical" : ""}`}
      id={`gate-${gate.key}`}
    >
      <header>
        <Dot tone={tone} />
        <h3>{gate.label}</h3>
        <Pill tone={tone}>{STATE_WORD[gate.state]}</Pill>
      </header>
      <p className="rm-blocker">{gate.blocker}</p>
      <dl className="rm-detail">
        <div>
          <dt>If it stays this way</dt>
          <dd>{gate.consequence}</dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>{gate.action}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{gate.owner}</dd>
        </div>
        {(gate.evidence || expires) && (
          <div>
            <dt>Evidence</dt>
            <dd>
              {gate.evidence || "None recorded"}
              {expires && (
                <em className={expires === "Evidence expired" ? "stale" : ""}>
                  {expires}
                </em>
              )}
            </dd>
          </div>
        )}
      </dl>
      {gate.href && gate.state !== "ready" && (
        <Link href={gate.href} className="rm-go">
          Go there <ArrowRight size={14} />
        </Link>
      )}
    </article>
  );
}

export function ReadinessMap({ gates }: { gates: Gate[] }) {
  const byKey = new Map(gates.map((g) => [g.key, g]));
  const enrollment = byKey.get("enrollment")!;
  const blocking = gates.filter(
    (g) => g.key !== "enrollment" && g.state !== "ready",
  );
  /* The earliest unmet link: the one action that actually unblocks progress. */
  const firstUnmet = (
    [
      "software",
      "database",
      "identity",
      "messaging",
      "market",
      "support",
    ] as GateKey[]
  )
    .map((k) => byKey.get(k)!)
    .find((g) => g.state !== "ready");

  return (
    <section className="rm">
      <div className="rm-verdict">
        <span className="rm-verdict-mark">
          <Lock size={18} />
        </span>
        <div>
          <p className="eyebrow">THE PATH TO OPENING</p>
          <h2>
            {enrollment.state === "ready"
              ? "Every gate is clear. Opening enrollment is now a decision, not a blocker."
              : blocking.length === 0
                ? "Real enrollment is held closed deliberately. Nothing technical is blocking it."
                : `Real enrollment is blocked by ${blocking.length} gate${blocking.length === 1 ? "" : "s"}.`}
          </h2>
          {firstUnmet && (
            <p className="rm-first">
              Start here — <strong>{firstUnmet.label}</strong>:{" "}
              {firstUnmet.action}
            </p>
          )}
        </div>
      </div>

      <div className="rm-graph" role="list">
        {LAYERS.map((layer, index) => (
          <div className="rm-layer" key={index} role="listitem">
            <span className="rm-layer-label" aria-hidden="true">
              {index + 1}
            </span>
            <div className="rm-layer-cards">
              {layer.map((key) => {
                const gate = byKey.get(key);
                if (!gate) return null;
                return (
                  <GateCard
                    key={key}
                    gate={gate}
                    critical={gate.key === firstUnmet?.key}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="rm-note">
        Each layer depends on the ones before it. A gate cannot turn green while
        anything it points back to is open, which is why the earliest unmet gate
        is the only one worth working on first.
      </p>
    </section>
  );
}
