/* Merchant overview.

   A store owner is not an operator. They get the five answers they actually
   want, in order, and nothing else. No campaign builder, no member list, no
   impressions, no invented "new customers" number.

   Every label here names a recorded event, not a hoped-for outcome. See the
   header of src/lib/merchant-overview.ts for what the database can and cannot
   prove — in short: it can prove a redemption was recorded, and it can never
   prove a purchase, because the evidence table forbids that column from being
   true. */
import Link from "next/link";
import {
  ArrowRight,
  CircleCheck,
  Coffee,
  LifeBuoy,
  MapPin,
  TriangleAlert,
} from "lucide-react";
import type {
  merchantOverview,
  MerchantIncident,
} from "@/lib/merchant-overview";
import { Dot, Pill, Scene, Stat } from "./system";
import "./merchant-overview.css";

type Data = Awaited<ReturnType<typeof merchantOverview>>;

/* One line per make-good state. None of these say "made good" unless the
   recovery was actually redeemed. */
function recoveryNote(incident: MerchantIncident) {
  switch (incident.recoveryState) {
    case "completed":
      return "Uptick issued a backed make-good and the member used it.";
    case "active":
      return "Uptick issued a make-good. The member has not used it yet.";
    case "expired":
      return "The make-good Uptick issued expired unused. Still open.";
    case "superseded":
      return "An earlier make-good failed and is being replaced.";
    default:
      return incident.unresolved
        ? "Uptick is arranging a make-good."
        : "Closed by your Uptick operator.";
  }
}

export function MerchantOverview({ data }: { data: Data }) {
  const { organization, run, commitment, totals, weeks, incidents, completed } =
    data;

  if (!run)
    return (
      <div className="mo">
        <section className="mo-hero">
          <div className="mo-hero-body">
            <p className="eyebrow">UPTICK FOR MERCHANTS</p>
            <h1>{organization?.name || "Your store"}</h1>
            <p className="mo-lede">
              You don’t have an active Uptick program yet. When your Uptick
              operator sets one up, everything about it appears here — what you
              agreed to provide, what is happening each week, and what was
              recorded at your counter.
            </p>
            <Link href="/sms" className="mo-cta">
              Talk to your Uptick operator <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </div>
    );

  const active = weeks.find((w) => w.current);
  const live = run.state === "live";
  const unresolved = totals?.unresolvedIncidents || 0;
  const expired = totals?.recoveriesExpired || 0;

  return (
    <div className="mo">
      {/* 0. Who and where */}
      <section className="mo-hero">
        <Scene
          height={132}
          caption={data.location || undefined}
          script="Good neighbors grow together."
        />
        <div className="mo-hero-body">
          <p className="eyebrow">UPTICK FOR MERCHANTS</p>
          <h1>{organization.name}</h1>
          <p className="mo-hero-meta">
            <Pill tone={completed ? "idle" : live ? "ok" : "warn"}>
              {completed
                ? "Pilot complete"
                : live
                  ? "Live"
                  : run.state.replaceAll("_", " ")}
            </Pill>
            {active && <span>Week {active.index} of 4</span>}
            {completed && <span>Final results</span>}
            {data.location && (
              <span>
                <MapPin size={13} /> {data.location}
              </span>
            )}
          </p>
        </div>
      </section>

      {/* 1. What are we trying to accomplish? */}
      <section
        className={unresolved ? "mo-status attention" : "mo-status"}
        aria-live="polite"
      >
        <span className="mo-status-mark">
          {unresolved ? <TriangleAlert size={19} /> : <CircleCheck size={19} />}
        </span>
        <div>
          <strong>
            {unresolved
              ? `${unresolved} member${unresolved === 1 ? "" : "s"} couldn’t get their Uptick at your counter.`
              : completed
                ? "Your four weeks are finished. These are your final results."
                : live
                  ? "You’re live. Thanks for being part of Uptick."
                  : "Your program is being set up."}
          </strong>
          <p>
            {unresolved
              ? `Uptick is arranging a make-good${expired ? `, including ${expired} that expired unused and is being reissued` : ""}. You don’t need to do anything unless your operator asks.`
              : completed
                ? "Nothing further is needed at your counter. Your operator will walk through these numbers with you."
                : "Uptick brings nearby members to your store. You provide the perk. We handle the member experience, the messaging and the support."}
          </p>
        </div>
      </section>

      {/* 4. What happened? */}
      <div className="u-stats mo-stats">
        <Stat
          label="Benefits issued"
          value={totals?.issued ?? 0}
          foot="Members given this benefit so far"
        />
        <Stat
          label="Recorded redemptions"
          value={totals?.recorded ?? 0}
          foot={
            totals?.redemptionRate === null
              ? "Nothing issued yet"
              : `${totals?.redemptionRate}% of issued${totals?.staffVerified ? ` · ${totals.staffVerified} staff-verified` : ""}`
          }
          tone={totals?.recorded ? "ok" : "idle"}
        />
        <Stat
          label="Make-goods completed"
          value={totals?.recoveriesCompleted ?? 0}
          foot={
            unresolved
              ? `${unresolved} still open${expired ? ` · ${expired} expired unused` : ""}`
              : totals?.incidentsTotal
                ? "No outstanding problems"
                : "No problems reported"
          }
          tone={unresolved ? "warn" : "ok"}
        />
      </div>
      <p className="mo-truth">
        Uptick can prove two things: a benefit was issued, and a redemption was
        recorded at your counter. “Staff-verified” means that recording came
        from a staff-held code rather than a member self-confirming. We don’t
        report visits, new customers or sales, because we can’t verify them —
        and a recorded redemption on its own isn’t proof an item changed hands.
      </p>

      {/* 2. What do I need to provide? */}
      {commitment && (
        <section className="u-card u-card-pad mo-commit">
          <div className="u-head">
            <h2>{completed ? "What you provided" : "What you provide"}</h2>
          </div>
          <div className="mo-commit-row">
            <span className="mo-commit-mark">
              <Coffee size={22} />
            </span>
            <div>
              <strong>{commitment.exact_item}</strong>
              <p>
                {commitment.size_label} · {commitment.qualification}
              </p>
              <small>{commitment.usable_hours}</small>
            </div>
          </div>
          {commitment.substitute_item && (
            <div className="mo-commit-fallback">
              <Dot tone="ok" />
              <div>
                <strong>If you run out: {commitment.substitute_item}</strong>
                <small>
                  {commitment.fallback_available ?? 0} substitutes still
                  reserved. Hand one over and scan the same staff QR.
                </small>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. What is Uptick doing, week by week? */}
      <section className="u-card u-card-pad">
        <div className="u-head">
          <h2>Your four weeks</h2>
        </div>
        <ol className="mo-weeks">
          {weeks.map((w) => (
            <li key={w.weekKey} className={w.current ? "current" : undefined}>
              <span className="mo-week-name">
                {w.label}
                {w.current && <em>this week</em>}
              </span>
              {w.released ? (
                <span className="mo-week-figs">
                  <b>{w.issued}</b> issued · <b>{w.recorded}</b> recorded
                </span>
              ) : (
                <span className="mo-week-figs muted">
                  {completed ? "Not released" : "Not started yet"}
                </span>
              )}
              <span className="mo-week-bar" aria-hidden="true">
                <i
                  style={{
                    width: `${w.issued ? Math.round((w.recorded / w.issued) * 100) : 0}%`,
                  }}
                />
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Problems, told plainly. */}
      {incidents.length > 0 && (
        <section className="u-card u-card-pad">
          <div className="u-head">
            <h2>When something went wrong</h2>
          </div>
          <div className="u-rows">
            {incidents.slice(0, 5).map((incident) => (
              <div className="u-row" key={incident.id}>
                <Dot
                  tone={
                    incident.madeGood
                      ? "ok"
                      : incident.unresolved
                        ? "bad"
                        : "warn"
                  }
                />
                <div className="u-row-body">
                  <strong>{incident.incident_type.replaceAll("_", " ")}</strong>
                  <small>{recoveryNote(incident)}</small>
                </div>
                <div className="u-row-end">
                  {new Date(incident.occurred_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. What should we do next? */}
      <section className="mo-next">
        <div>
          <p className="eyebrow">WHAT HAPPENS NEXT</p>
          <h2>
            {completed
              ? "Your operator will review the four weeks with you."
              : active && active.index < 4
                ? `Keep the counter ready for week ${active.index + 1}.`
                : "Your operator will review the four weeks with you."}
          </h2>
          <p>
            {completed
              ? "These results stay available here. Your commercial terms are whatever you agreed with your Uptick operator."
              : "Members are never charged and never required to buy anything to receive this benefit. If stock runs short or staff change, tell your Uptick operator before the next week is released — that is the one thing that keeps a member from being let down."}
          </p>
        </div>
        <Link href="/sms" className="mo-cta">
          <LifeBuoy size={16} /> Contact {run.support_owner || "your operator"}
        </Link>
      </section>
    </div>
  );
}
