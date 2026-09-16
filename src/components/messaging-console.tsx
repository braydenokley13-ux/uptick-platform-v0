/* Messaging & support console.

   Two questions, answered above everything else:
     Can we send?     → provider state, both switches, both signed callbacks
     Is anyone stuck? → the support queue, oldest first

   Recent activity deliberately shows delivery *outcomes*, including the ones
   that failed and the ones whose outcome is unknown. An unknown outcome is
   never rendered as success and never offered a blind retry. */
import Link from "next/link";
import { ArrowRight, CircleCheck, Radio, TriangleAlert } from "lucide-react";
import type { MembershipMessagingOperations } from "@/lib/network-operations";
import { Dot, Pill, type Tone } from "./system";
import "./messaging-console.css";

const STATE: Record<string, { tone: Tone; label: string }> = {
  delivered: { tone: "ok", label: "Delivered" },
  sent: { tone: "ok", label: "Sent to carrier" },
  queued: { tone: "idle", label: "Queued" },
  scheduled: { tone: "idle", label: "Scheduled" },
  failed: { tone: "bad", label: "Delivery failed" },
  undelivered: { tone: "bad", label: "Undelivered" },
  unknown: { tone: "warn", label: "Outcome unknown" },
  suppressed: { tone: "idle", label: "Suppressed" },
  cancelled: { tone: "idle", label: "Cancelled" },
};

const ORIGIN: Record<string, string> = {
  sms_help: "HELP received by text",
  sms_other: "Member replied by text",
  member_web: "Asked for help on the web",
};

const PURPOSE: Record<string, string> = {
  access: "Access link",
  weekly_access: "Weekly access link",
  membership_access: "Membership access link",
  promotional: "Weekly benefit notice",
  weekly_promotion: "Weekly benefit notice",
  confirmation: "Opt-in confirmation",
  opt_in_confirmation: "Opt-in confirmation",
  phone_correction: "Phone correction check",
  support: "Support reply",
};
/* An unmapped purpose is still readable to an operator; raw snake_case is not. */
const purposeLabel = (value: string) =>
  PURPOSE[value] ||
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

function ago(value: string) {
  const ms = Date.now() - new Date(value).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MessagingConsole({
  data,
}: {
  data: MembershipMessagingOperations;
}) {
  const { readiness, counts, messages, support, supportTotal, callbacks } =
    data;
  const inbound = callbacks.find((c) => c.kind === "inbound");
  const status = callbacks.find((c) => c.kind === "status");
  /* From the uncapped grouped totals, not from the eighty rows below. Counting
     the visible list meant an older failure fell out of the badge as newer
     messages arrived, and the operator saw zero unresolved while members were
     still undelivered. */
  const unresolved = counts
    .filter((c) => ["failed", "undelivered", "unknown"].includes(c.state))
    .reduce((n, c) => n + c.count, 0);
  const oldest = support[0];
  /* Two separate questions. Sending works or it does not; hearing back — the
     signed callbacks that carry STOP, HELP and delivery outcomes — works or it
     does not. Collapsing them told an operator with a stale callback that
     messaging could not send, which is its own untrue statement. */
  const sendReady = readiness.sendReady;
  const connected = readiness.ready;

  return (
    <div className="mc">
      {/* Can we send? */}
      <section
        className={connected ? "mc-provider ok" : "mc-provider warn"}
        aria-live="polite"
      >
        <span className="mc-provider-mark">
          {connected ? <CircleCheck size={20} /> : <TriangleAlert size={20} />}
        </span>
        <div>
          <strong>
            {readiness.simulated
              ? "Simulated delivery — no real messages leave this environment."
              : connected
                ? "Messaging service is ready."
                : sendReady
                  ? "Uptick can send, but replies are not confirmed reaching us."
                  : "Messaging is not ready to send."}
          </strong>
          <p>
            {!readiness.simulated && sendReady && !connected
              ? `No current signed ${!inbound?.current ? "inbound" : "status"} callback for this sender and release. STOP and HELP may not be reaching Uptick.`
              : readiness.sender
                ? `Sender ${readiness.sender.phone} · service ${readiness.sender.serviceSid.slice(0, 10)}…${readiness.sender.approved ? " · approved" : " · not approved"}`
                : "No dedicated membership sender is configured yet."}
          </p>
        </div>
        <Link href="/operator/pilot/settings" className="mc-provider-go">
          Details <ArrowRight size={14} />
        </Link>
      </section>

      <div className="mc-grid">
        <div className="mc-col">
          {/* The two switches, stated as what they do to members. */}
          <section className="u-card u-card-pad">
            <div className="u-head">
              <h2>What Uptick may send</h2>
            </div>
            <div className="mc-switches">
              <div className="u-toggle">
                <div className="u-toggle-body">
                  <strong>Account access messages</strong>
                  <small>
                    The private link a member needs to open their Uptick. Not
                    promotional; a member cannot opt out of these and stay a
                    member.
                  </small>
                </div>
                <span className="u-switch-label">
                  {readiness.accessEnabled ? "ON" : "OFF"}
                </span>
                <span
                  className={
                    readiness.accessEnabled ? "u-switch on" : "u-switch"
                  }
                  role="img"
                  aria-label={
                    readiness.accessEnabled
                      ? "Account access messages enabled"
                      : "Account access messages disabled"
                  }
                />
              </div>
              <div className="u-toggle">
                <div className="u-toggle-body">
                  <strong>Promotional messages</strong>
                  <small>
                    The optional weekly notice. Separate consent, separate
                    switch, and STOP applies only to this class.
                  </small>
                </div>
                <span className="u-switch-label">
                  {readiness.promotionEnabled ? "ON" : "OFF"}
                </span>
                <span
                  className={
                    readiness.promotionEnabled ? "u-switch on" : "u-switch"
                  }
                  role="img"
                  aria-label={
                    readiness.promotionEnabled
                      ? "Promotional messages enabled"
                      : "Promotional messages disabled"
                  }
                />
              </div>
            </div>
            <p className="mc-note">
              These switches are environment configuration, not toggles an
              operator can flip from this screen. That is deliberate: turning on
              real delivery is a deployment decision with a provider behind it.
            </p>
          </section>

          {/* Webhooks: the half of messaging that fails silently. */}
          <section className="u-card u-card-pad">
            <div className="u-head">
              <h2>Signed callbacks</h2>
            </div>
            <div className="u-rows">
              {[
                ["Inbound (STOP, START, HELP, replies)", inbound],
                ["Delivery status", status],
              ].map(([label, row]) => {
                const health = row as (typeof callbacks)[number] | undefined;
                const ok =
                  !!health?.last_success_at &&
                  (!health.last_failure_at ||
                    new Date(health.last_success_at) >
                      new Date(health.last_failure_at));
                return (
                  <div className="u-row" key={String(label)}>
                    <Dot tone={health ? (ok ? "ok" : "bad") : "idle"} />
                    <div className="u-row-body">
                      <strong>{String(label)}</strong>
                      <small>
                        {!health
                          ? "No signed callback has been received yet."
                          : ok
                            ? `Last signed success ${ago(health.last_success_at!)}.`
                            : `Last failure ${health.last_failure_at ? ago(health.last_failure_at) : "recorded"}${health.last_failure_code ? ` (${health.last_failure_code})` : ""}.`}
                      </small>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="mc-col">
          {/* Is anyone stuck? */}
          <section className="u-card u-card-pad">
            <div className="u-head">
              <h2>Support queue</h2>
              {supportTotal > 0 && (
                /* The list below is capped for readability. The count is the
                   whole queue, because "20 open" with 35 waiting is the kind of
                   reassurance that leaves members unanswered. */
                <Pill tone={supportTotal > 2 ? "bad" : "warn"}>
                  {supportTotal} open
                </Pill>
              )}
            </div>
            {support.length ? (
              <>
                <div className="u-rows">
                  {support.slice(0, 5).map((request) => (
                    <div className="u-row" key={request.id}>
                      <Dot
                        tone={request.state === "working" ? "warn" : "bad"}
                      />
                      <div className="u-row-body">
                        <strong>
                          {ORIGIN[request.origin] || request.origin}
                        </strong>
                        <small>
                          {request.phone_hint
                            ? `···${request.phone_hint} · `
                            : ""}
                          {request.state}
                        </small>
                      </div>
                      <div className="u-row-end">{ago(request.created_at)}</div>
                    </div>
                  ))}
                </div>
                {oldest && (
                  <p className="mc-note">
                    Oldest has been waiting {ago(oldest.created_at)}.
                  </p>
                )}
                <Link href="/operator/pilot/support" className="mc-go">
                  Work the queue <ArrowRight size={14} />
                </Link>
              </>
            ) : (
              <div className="u-empty">
                <span className="u-empty-mark">
                  <CircleCheck size={20} />
                </span>
                <strong>Nobody is waiting.</strong>
                <p>
                  Member replies and HELP messages arrive here. An empty queue
                  means every request has been resolved or closed.
                </p>
              </div>
            )}
          </section>

          {/* What actually happened on the wire. */}
          <section className="u-card u-card-pad">
            <div className="u-head">
              <h2>Recent delivery</h2>
              {unresolved > 0 && (
                <Pill tone="bad">{unresolved} unresolved</Pill>
              )}
            </div>
            {messages.length ? (
              <div className="u-rows">
                {messages.slice(0, 8).map((message) => {
                  const state = STATE[message.state] || {
                    tone: "idle" as Tone,
                    label: message.state,
                  };
                  return (
                    <div className="u-row" key={message.id}>
                      <Dot tone={state.tone} />
                      <div className="u-row-body">
                        <strong>
                          {state.label}
                          {message.error_code ? ` · ${message.error_code}` : ""}
                        </strong>
                        <small>
                          {purposeLabel(message.purpose)} · ···
                          {message.phone_hint}
                          {message.state === "unknown"
                            ? " · outcome unconfirmed, do not resend blindly"
                            : ""}
                        </small>
                      </div>
                      <div className="u-row-end">{ago(message.created_at)}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="u-empty">
                <span className="u-empty-mark">
                  <Radio size={20} />
                </span>
                <strong>No messages sent yet.</strong>
                <p>
                  Every access link, confirmation and weekly notice will be
                  listed here with its real delivery outcome.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
