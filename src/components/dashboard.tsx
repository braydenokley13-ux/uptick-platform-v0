import Link from "next/link";
import { weekKey } from "@/lib/domain";
import {
  ArrowUpRight,
  ArrowRight,
  Radio,
  Gift,
  Check,
  MapPin,
  Store,
  Route,
  Users,
  CalendarDays,
  Activity,
  CheckCircle2,
  Clock,
  Lightbulb,
} from "lucide-react";
import { Badge, Metric, CoffeeArt, TextLink, Empty } from "./ui";
import { offerState, placementState } from "@/lib/product";
import type {
  overview,
  SourceRow,
  merchantSourceContext,
} from "@/lib/read-model";
type Data = Awaited<ReturnType<typeof overview>>;
function date(value: string, timezone: string, full = false) {
  return new Date(value).toLocaleDateString("en-US", {
    month: full ? "long" : "short",
    day: "numeric",
    timeZone: timezone,
  });
}
function activeAnchor(data: Data) {
  return (
    data.offers.find(
      (x) =>
        x.kind === "anchor" &&
        x.state === "live" &&
        new Date(x.starts_at) <= new Date(data.asOf) &&
        new Date(x.expires_at) > new Date(data.asOf),
    ) || data.offers.find((x) => x.kind === "anchor")
  );
}
function placements(data: Data) {
  return [
    ...new Map(
      data.sources
        .filter((s) => s.state === "active" && s.placement_id)
        .map((s) => [s.placement_id, s]),
    ).values(),
  ];
}
export function Metrics({ data }: { data: Data }) {
  return (
    <div className="metrics-grid">
      <Metric
        label="QR source visits"
        value={data.visits}
        note="Recorded visits · repeats possible"
      />
      <Metric
        label="Source-linked claims"
        value={data.sourceClaims}
        note="Accepted after a QR source visit"
      />
      <Metric
        label="Recorded redemptions"
        value={data.counts.redemptions}
        note="Across Anchor + Weekly Drops"
        accent
      />
      <Metric
        label="Weekly Drop subscribers"
        value={data.counts.subscribers}
        note="Currently opted in and confirmed"
      />
    </div>
  );
}
export function CommandStatus({ data }: { data: Data }) {
  const anchor = activeAnchor(data),
    p = placements(data),
    confirmed = p.filter((s) => s.status === "confirmed").length;
  return (
    <div className="command-status">
      <span className="eyebrow">
        <span className="status-dot" />
        {anchor &&
        anchor.state === "live" &&
        new Date(anchor.starts_at) <= new Date(data.asOf) &&
        new Date(anchor.expires_at) > new Date(data.asOf)
          ? "YOUR ANCHOR IS PUBLISHED"
          : "YOUR GROWTH SYSTEM IS TAKING SHAPE"}
      </span>
      <span>
        {p.length} placements configured · {confirmed} handoffs confirmed
      </span>
      <Link href="/merchant/plan">
        Your Growth Plan
        <ArrowUpRight size={14} />
      </Link>
    </div>
  );
}
export function AnchorCard({ data }: { data: Data }) {
  const anchor = activeAnchor(data);
  if (!anchor)
    return (
      <section className="panel">
        <Empty title="Your first Anchor starts here.">
          Uptick will help put a clear, durable offer into your neighborhood.
        </Empty>
        <TextLink href="/merchant/plan">See your Growth Plan</TextLink>
      </section>
    );
  const p = placements(data).filter((s) => s.offer_id === anchor.id);
  return (
    <section className="panel anchor-card">
      <div className="panel-top">
        <span className="eyebrow">
          <Radio size={14} /> YOUR ACQUISITION ANCHOR
        </span>
        <Badge
          tone={
            offerState(anchor.state, anchor.expires_at) === "Live"
              ? "mint"
              : "neutral"
          }
        >
          {offerState(anchor.state, anchor.expires_at)}
        </Badge>
      </div>
      <div className="anchor-body">
        <div>
          <p className="offer-qualification">{anchor.qualification}</p>
          <h2>
            {anchor.reward.replace(/^Get a /, "")}
            <span className="tiny-asterisk">*</span>
          </h2>
          <p className="muted">
            A reason to stop by. A chance to become their place.
          </p>
        </div>
        <CoffeeArt />
      </div>
      <div className="anchor-hosts">
        {p.slice(0, 3).map((s) => (
          <div key={s.id}>
            <span>
              <MapPin size={13} />
              {s.host}
            </span>
            <span
              className={s.status === "confirmed" ? "confirmed-text" : "muted"}
            >
              {s.status === "confirmed" ? (
                <>
                  <Check size={13} /> Handoff confirmed
                </>
              ) : (
                "Awaiting confirmation"
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="anchor-bottom">
        <span>{p.length} intended host placements</span>
        <TextLink href="/merchant/anchor">View your Anchor</TextLink>
      </div>
    </section>
  );
}
export function DropCard({ data }: { data: Data }) {
  const drop =
    data.dropHistory.find(
      (x) =>
        ["draft", "review", "scheduled"].includes(x.state) &&
        new Date(x.expires_at) > new Date(),
    ) ||
    data.dropHistory.find(
      (x) => x.state === "live" && new Date(x.expires_at) > new Date(),
    );
  const status =
    drop?.review_decision === "returned"
      ? "Needs changes"
      : drop
        ? offerState(drop.state, drop.expires_at)
        : "Ready when you are";
  return (
    <section className="drop-card">
      <div className="panel-top">
        <span className="eyebrow">
          <Gift size={14} /> THE NEXT REASON TO RETURN
        </span>
        <Badge>{status}</Badge>
      </div>
      <h2>{drop?.title || "Your next Weekly Drop."}</h2>
      <p>
        {drop?.qualification ||
          "One useful offer for people who want to hear from you."}
      </p>
      <h3>{drop?.reward || "Something is always free."}</h3>
      <p className="drop-time">
        {drop?.scheduled_at ? (
          <>
            <CalendarDays size={14} /> Scheduled{" "}
            {date(drop.scheduled_at, data.organization.timezone, true)}
          </>
        ) : drop ? (
          <>
            <Clock size={14} /> Proposed{" "}
            {date(drop.starts_at, data.organization.timezone, true)}
          </>
        ) : (
          <>
            <Users size={14} />
            {data.audience.subscribers} current subscribers
          </>
        )}
      </p>
      <div className="drop-card-bottom">
        <p>
          <Check size={14} />
          Uptick reviews the offer and timing.
        </p>
        <Link
          className="button mint-button"
          href={
            drop && ["draft", "review"].includes(drop.state)
              ? `/merchant/create?id=${drop.id}`
              : drop
                ? "/merchant/drops"
                : "/merchant/create"
          }
        >
          {drop?.state === "draft"
            ? "Finish your Drop"
            : drop
              ? "View Weekly Drops"
              : "Create a Weekly Drop"}
          <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
export function RecommendationCard({
  data,
  all = false,
}: {
  data: Data;
  all?: boolean;
}) {
  return (
    <div className={all ? "recommendation-list" : "recommendation-single"}>
      {(all ? data.recommendations : data.recommendations.slice(0, 1)).map(
        (r, i) => (
          <section className={`recommendation-card ${r.tone}`} key={r.title}>
            <div className="recommendation-icon">
              <Lightbulb size={20} />
            </div>
            <div>
              <p className="eyebrow">
                {i === 0 ? "YOUR NEXT USEFUL MOVE" : "ALSO WORTH A LOOK"} ·
                UPTICK RECOMMENDS
              </p>
              <h3>{r.title}</h3>
              <p>{r.detail}</p>
            </div>
            <TextLink href={r.href}>{r.action}</TextLink>
          </section>
        ),
      )}
    </div>
  );
}
export function AudienceCard({ data }: { data: Data }) {
  return (
    <section className="panel audience-card">
      <div className="panel-top">
        <span className="eyebrow">
          <Users size={14} /> YOUR LOCAL AUDIENCE
        </span>
        <span className="fine">CURRENTLY OPTED IN</span>
      </div>
      <div className="audience-number">
        <strong>{data.audience.subscribers}</strong>
        <div>
          <h3>
            People with a reason
            <br />
            to hear from you again.
          </h3>
          <p>
            {data.audience.joined7} new{" "}
            {data.audience.joined7 === 1 ? "subscriber" : "subscribers"} in the
            past 7 days
          </p>
        </div>
      </div>
      <div className="anchor-bottom">
        <span>{data.audience.eligible} consent-eligible for messaging</span>
        <TextLink href="/merchant/audience">Meet your audience</TextLink>
      </div>
    </section>
  );
}
export function SourcesTable({ data }: { data: Data }) {
  return (
    <section className="panel sources-panel">
      <div className="section-top">
        <div>
          <p className="eyebrow">FROM AROUND THE CORNER</p>
          <h2>Your neighborhood, at work.</h2>
        </div>
        <TextLink href="/merchant/network">View Local Network</TextLink>
      </div>
      {!data.sources.length ? (
        <Empty title="Your neighborhood starts here.">
          Uptick will configure nearby placements for your Anchor.
        </Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>HOST / PLACEMENT</th>
                <th>QR VISITS</th>
                <th>CLAIMS</th>
                <th>REDEMPTIONS</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s, i) => (
                <tr key={s.id}>
                  <td>
                    <Link
                      className="host-cell"
                      href={`/merchant/network?id=${s.id}`}
                    >
                      <span className="host-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <strong>{s.host || "Direct placement"}</strong>
                        <small>
                          {s.placement || s.campaign} ·{" "}
                          {placementState(s.status, s.state)}
                        </small>
                      </span>
                      <ArrowUpRight size={14} />
                    </Link>
                  </td>
                  <td>{s.visits}</td>
                  <td>{s.claims}</td>
                  <td>
                    <span className="table-value">{s.redemptions}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="table-footnote">
        A confirmed handoff records Uptick’s installation check. It does not
        verify screen playback. QR visits may repeat.
      </p>
    </section>
  );
}
export function Loop({
  data,
  expanded = false,
}: {
  data: Data;
  expanded?: boolean;
}) {
  const steps = [
    {
      title: "FOUND NEARBY",
      n: data.visits,
      label: "QR source visits",
      detail: `${placements(data).length} configured host placements`,
      icon: MapPin,
      href: "/merchant/network",
    },
    {
      title: "BROUGHT IN",
      n: data.sourceClaims,
      label: "Source-linked claims",
      detail: `${data.audience.initial_redeemers} ${data.audience.initial_redeemers === 1 ? "person" : "people"} redeemed an Anchor`,
      icon: Store,
      href: "/merchant/results",
    },
    {
      title: "JOINED THE DROP",
      n: data.audience.subscribers,
      label: "Current subscribers",
      detail: `${data.audience.initial_joined} also redeemed an Anchor`,
      icon: Gift,
      href: "/merchant/audience",
    },
    {
      title: "CAME BACK",
      n: data.audience.returners,
      label: "People with a recorded return",
      detail: `${data.audience.return_redemptions} later Drop redemptions`,
      icon: Route,
      href: "/merchant/results",
    },
  ];
  return (
    <section className={`growth-loop ${expanded ? "expanded" : ""}`}>
      <div className="section-top">
        <div>
          <p className="eyebrow">THE UPTICK LOOP</p>
          <h2>
            A reason to visit. <em>A reason to return.</em>
          </h2>
        </div>
        {!expanded && (
          <Link href="/merchant/loop" className="text-link">
            Follow the loop
            <ArrowUpRight size={15} />
          </Link>
        )}
      </div>
      <div className="growth-loop-stages">
        {steps.map((step, i) => (
          <Link href={step.href} key={step.title}>
            <div className="loop-stage-top">
              <span>0{i + 1}</span>
              <step.icon size={20} />
            </div>
            <p className="eyebrow">{step.title}</p>
            <strong>{step.n}</strong>
            <p>{step.label}</p>
            <small>{step.detail}</small>
            {i < 3 && (
              <span className="loop-connector">
                <ArrowRight size={16} />
              </span>
            )}
          </Link>
        ))}
      </div>
      {expanded && (
        <div className="loop-explanation">
          <p>
            <strong>Follow the journey, one observed action at a time.</strong>{" "}
            QR visits are page visits, claims are saved passes, and redemptions
            are completed counter records. These totals have different
            denominators and are not a single conversion funnel.
          </p>
          <p>
            A recorded return requires a later Weekly Drop redemption by someone
            who already redeemed your Anchor. A person without that record may
            still have visited your store.
          </p>
        </div>
      )}
    </section>
  );
}
export function NetworkMap({ data }: { data: Data }) {
  const rows = placements(data);
  return (
    <section className="network-map">
      <div className="section-top">
        <div>
          <p className="eyebrow">YOUR LOCAL NETWORK</p>
          <h2>
            Good neighbors.
            <br />
            <em>New reasons to visit.</em>
          </h2>
        </div>
        <span className="map-disclaimer">SCHEMATIC · NOT TO SCALE</span>
      </div>
      <div className="neighborhood-diagram">
        <div className="merchant-node">
          <span>
            <Store size={29} />
          </span>
          <p className="eyebrow">YOUR BUSINESS</p>
          <strong>{data.organization.name}</strong>
          <small>The destination</small>
        </div>
        <div className="neighborhood-path" aria-hidden="true">
          <ArrowRight size={20} />
        </div>
        <div className="host-nodes">
          {rows.length ? (
            rows.slice(0, 5).map((s) => (
              <Link
                className="host-node"
                key={s.id}
                href={`/merchant/network?id=${s.id}`}
              >
                <span className="host-node-icon">
                  <MapPin size={21} />
                </span>
                <div>
                  <strong>{s.host || "Direct placement"}</strong>
                  <p>{s.placement}</p>
                  <small>{placementState(s.status, s.state)}</small>
                </div>
                <ArrowUpRight size={16} />
              </Link>
            ))
          ) : (
            <div className="host-node">
              <MapPin size={23} />
              <div>
                <strong>Your next good neighbors</strong>
                <p>Uptick will add the first placements to your plan.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="map-footnote">
        Real named placements, connected to your offer. Distances are shown only
        when verified location data is available.
      </p>
    </section>
  );
}
export function SourceDetail({
  source: s,
  timezone,
  context,
}: {
  source: SourceRow;
  timezone: string;
  context?: Awaited<ReturnType<typeof merchantSourceContext>>;
}) {
  return (
    <section className="panel source-detail">
      <div className="section-top">
        <div>
          <p className="eyebrow">PLACEMENT ACTIVITY</p>
          <h2>{s.host || "Direct placement"}</h2>
          <p>{s.placement || s.campaign}</p>
        </div>
        <Badge
          tone={
            s.status === "confirmed" && s.state === "active"
              ? "mint"
              : "neutral"
          }
        >
          {placementState(s.status, s.state)}
        </Badge>
      </div>
      <p>
        <MapPin size={14} /> {s.address || "Location not recorded"}
      </p>
      <div className="metrics-grid">
        <Metric
          label="QR source visits"
          value={s.visits}
          note="Page visits · repeats possible"
        />
        <Metric
          label="Accepted claims"
          value={s.claims}
          note="Linked to this QR source"
        />
        <Metric
          label="Redemptions"
          value={s.redemptions}
          note="Linked to this QR source"
        />
        <Metric
          label="Current subscribers"
          value={s.subscribers}
          note="First claim linked to this source"
        />
      </div>
      <div className="source-detail-grid">
        <div>
          <p className="eyebrow">THE OFFER</p>
          <h3>{s.offer_title}</h3>
          <p>{context?.creative?.headline || s.creative}</p>
          <span className="fine">
            {context?.creative
              ? `Creative version ${context.creative.version} · `
              : ""}
            QR created {date(s.created_at, timezone, true)}
          </span>
        </div>
        <div>
          <p className="eyebrow">SCREEN HANDOFF</p>
          <h3>{placementState(s.status, s.state)}</h3>
          <p>
            {s.confirmed_at
              ? `Confirmed ${date(s.confirmed_at, timezone, true)}`
              : "No confirmation timestamp recorded."}
          </p>
          <span className="fine">
            Confirmation records a handoff check, not verified playback.
          </span>
        </div>
      </div>
      <div className="source-history">
        <p className="eyebrow">PLACEMENT HISTORY</p>
        {context?.history.length ? (
          <ol>
            {context.history.map((event) => (
              <li key={event.id}>
                <span className="status-dot" />
                <strong>{placementState(event.status)}</strong>
                <time dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: timezone,
                  })}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="fine">
            Uptick’s placement checks will appear here as they are recorded.
          </p>
        )}
      </div>
    </section>
  );
}
export function GrowthPlan({ data }: { data: Data }) {
  const anchor = activeAnchor(data),
    p = placements(data);
  const sections = [
    {
      icon: MapPin,
      kicker: "01 / FIND THEM",
      title: data.organization.growth_goal || "Reach people already nearby.",
      copy: `Uptick brings your acquisition offer to ${p.length ? p.map((s) => s.host).join(", ") : "compatible nearby host businesses as placements are configured"}.`,
      href: "/merchant/network",
      action: "See your Local Network",
    },
    {
      icon: Store,
      kicker: "02 / BRING THEM IN",
      title: anchor?.qualification || "Make your first offer clear.",
      copy:
        anchor?.reward ||
        "Work with Uptick on a purchase + free-extra Anchor that staff can easily honor.",
      href: "/merchant/anchor",
      action: "View your Anchor",
    },
    {
      icon: Users,
      kicker: "03 / BUILD YOUR AUDIENCE",
      title: "Make the next invitation welcome.",
      copy: "After a successful redemption, invite customers to choose your Weekly Drop. Consent stays optional, specific to your business, and easy to change.",
      href: "/merchant/audience",
      action: "View your audience",
    },
    {
      icon: Gift,
      kicker: "04 / BRING THEM BACK",
      title: "Something is always free.",
      copy: "Use one clear purchase + free item each week. You propose the offer; Uptick checks timing, consent, and delivery readiness.",
      href: "/merchant/drops",
      action: "Plan your next Drop",
    },
  ];
  return (
    <>
      <div className="growth-plan-intro">
        <span className="plan-mark">
          <Route size={33} />
        </span>
        <div>
          <p className="eyebrow">THE PLAN FOR {data.organization.name}</p>
          <h2>
            A customer-acquisition and return
            <br />
            system around your store.
          </h2>
          <p>
            Your Anchor brings people in. Your Weekly Drop gives them reasons to
            come back. Uptick keeps the pieces connected.
          </p>
        </div>
      </div>
      <div className="growth-plan-grid">
        {sections.map((s) => (
          <section key={s.kicker} className="panel plan-stage">
            <div className="panel-top">
              <span className="eyebrow">{s.kicker}</span>
              <s.icon size={23} />
            </div>
            <h3>{s.title}</h3>
            <p>{s.copy}</p>
            <TextLink href={s.href}>{s.action}</TextLink>
          </section>
        ))}
      </div>
      <section className="plan-measurement">
        <div>
          <p className="eyebrow">HOW WE LEARN</p>
          <h3>Observe. Review. Make the next offer better.</h3>
        </div>
        <p>
          Claims → redemptions → current subscribers → later Drop redemptions.
          We use recorded actions and show when the evidence is still too small.
        </p>
        <TextLink href="/merchant/results">See your results</TextLink>
      </section>
    </>
  );
}
export function AudienceView({ data }: { data: Data }) {
  const a = data.audience;
  return (
    <>
      <AudienceCard data={data} />
      <div className="metrics-grid">
        <Metric
          label="New in 30 days"
          value={a.joined30}
          note="First opted in during this period; still subscribed"
        />
        <Metric
          label="Unsubscribed in 30 days"
          value={a.unsubscribed30}
          note="People who withdrew merchant consent"
        />
        <Metric
          label="Consent-eligible"
          value={a.eligible}
          note="Confirmed consent; no sender opt-out"
        />
        <Metric
          label="Awaiting confirmation"
          value={a.pending}
          note="Optional opt-in pending phone confirmation"
        />
      </div>
      <section className="panel audience-cohorts">
        <div className="section-top">
          <div>
            <p className="eyebrow">A SMALL, USEFUL AUDIENCE PICTURE</p>
            <h2>How people joined your loop.</h2>
          </div>
          <Badge>Read-only insights</Badge>
        </div>
        <div className="audience-cohort-grid">
          <div>
            <span className="eyebrow">FIRST CLAIM FROM A NEIGHBOR</span>
            {data.sources.length ? (
              data.sources.map((s) => (
                <div className="cohort-row" key={s.id}>
                  <span>
                    {s.host || "Direct source"}
                    <small>{s.placement}</small>
                  </span>
                  <strong>{s.subscribers}</strong>
                </div>
              ))
            ) : (
              <p className="muted">
                Source cohorts appear after customers subscribe.
              </p>
            )}
          </div>
          <div>
            <span className="eyebrow">CURRENT SUBSCRIBERS</span>
            <div className="cohort-row">
              <span>Also redeemed an Anchor</span>
              <strong>{a.initial_joined}</strong>
            </div>
            <div className="cohort-row">
              <span>No recorded Drop redemption yet</span>
              <strong>{a.never_drop}</strong>
            </div>
            <p className="fine">
              These groups can overlap. “No recorded redemption” does not mean a
              person has not returned to the store.
            </p>
          </div>
        </div>
        <p className="table-footnote">
          Consent-eligible is a current audience check. The actual send also
          checks timing, frequency, the offer, sender readiness, and current
          opt-outs.
        </p>
      </section>
      <ReturnEvidence data={data} />
    </>
  );
}
export function ReturnEvidence({ data }: { data: Data }) {
  const a = data.audience;
  return (
    <section className="panel return-evidence">
      <div>
        <p className="eyebrow">RECORDED RETURN</p>
        <h2>
          {a.initial_redeemers
            ? `${Math.round((a.returners / a.initial_redeemers) * 100)}%`
            : "Still learning."}
        </h2>
        <p>
          <strong>
            {a.returners} of {a.initial_redeemers}
          </strong>{" "}
          initial Anchor redeemers later redeemed a Weekly Drop.
        </p>
        <p className="fine">
          Observed{" "}
          {a.observation_start
            ? `from ${date(a.observation_start, data.organization.timezone, true)} through today`
            : "from the first recorded Anchor redemption onward"}
          . People have different follow-up periods.
        </p>
      </div>
      <div>
        <p className="eyebrow">REDEEMERS IN YOUR AUDIENCE</p>
        <h2>
          {a.initial_redeemers
            ? `${Math.round((a.initial_joined / a.initial_redeemers) * 100)}%`
            : "—"}
        </h2>
        <p>
          <strong>
            {a.initial_joined} of {a.initial_redeemers}
          </strong>{" "}
          initial Anchor redeemers currently subscribe to your Drop.
        </p>
        <p className="fine">
          This measures current overlap. Consent may have happened before or
          after redemption.
        </p>
      </div>
      <p className="evidence-note">
        {a.initial_redeemers < 20
          ? "Small sample: treat this as an early observation, not a reliable benchmark. "
          : ""}
        No recorded return does not prove no physical return. Uptick does not
        infer sales, profit, or customer lifetime value.
      </p>
    </section>
  );
}
export function DropHistoryView({
  data,
  comparison = false,
}: {
  data: Data;
  comparison?: boolean;
}) {
  if (!data.dropHistory.length)
    return (
      <section className="panel">
        <Empty title="Your first Drop is waiting.">
          Pick one useful free extra and give your audience a reason to come
          back.
        </Empty>
        <TextLink href="/merchant/create">Open Offer Studio</TextLink>
      </section>
    );
  if (comparison)
    return (
      <section className="panel sources-panel">
        <div className="section-top">
          <div>
            <p className="eyebrow">WHAT YOU HAVE TRIED</p>
            <h2>Compare the recorded response.</h2>
          </div>
          <Badge>Still learning</Badge>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>WEEKLY DROP</th>
                <th>PASSES PREPARED</th>
                <th>DELIVERED</th>
                <th>RECORDED RETURNS</th>
              </tr>
            </thead>
            <tbody>
              {data.dropHistory
                .filter((d) => d.scheduled_at)
                .map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.title}</strong>
                      <small>
                        {date(d.starts_at, d.timezone)} ·{" "}
                        {offerState(d.state, d.expires_at)}
                      </small>
                    </td>
                    <td>{d.prepared}</td>
                    <td>{d.delivered}</td>
                    <td>{d.returns}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!data.dropHistory.some((d) => d.scheduled_at) && (
          <p className="table-footnote">
            Your first comparison appears after Uptick schedules a Drop. Drafts
            are not results.
          </p>
        )}
        <p className="table-footnote">
          Returns require an earlier Anchor redemption. Different audiences and
          offer windows make this a descriptive comparison, not an experiment.
          Delivered does not mean read.
        </p>
      </section>
    );
  return (
    <div className="drop-history-list">
      {data.dropHistory.map((d) => {
        const state =
          d.review_decision === "returned"
            ? "Needs changes"
            : d.review_decision === "rejected"
              ? "Not approved"
              : offerState(d.state, d.expires_at);
        return (
          <section className="panel drop-history-card" key={d.id}>
            <div className="drop-date">
              <span>
                {new Date(d.starts_at).toLocaleDateString("en-US", {
                  month: "short",
                  timeZone: d.timezone,
                })}
              </span>
              <strong>
                {new Date(d.starts_at).toLocaleDateString("en-US", {
                  day: "2-digit",
                  timeZone: d.timezone,
                })}
              </strong>
              <small>{d.scheduled_at ? "Scheduled" : "Proposed"}</small>
            </div>
            <div className="drop-history-content">
              <div className="panel-top">
                <Badge
                  tone={
                    ["Needs changes", "In Uptick review"].includes(state)
                      ? "amber"
                      : state === "Live"
                        ? "mint"
                        : "neutral"
                  }
                >
                  {state}
                </Badge>
                <span className="fine">Offer {d.current_version}</span>
              </div>
              <h2>{d.title}</h2>
              <p>
                {d.qualification}.{" "}
                <strong className="amber-text">{d.reward}.</strong>
              </p>
              <p className="fine">
                {new Date(d.starts_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: d.timezone,
                })}{" "}
                →{" "}
                {new Date(d.expires_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: d.timezone,
                })}{" "}
                · {d.timezone}
              </p>
              {d.review_note && (
                <p className="review-note">
                  <strong>From Uptick:</strong> {d.review_note}
                </p>
              )}
              {d.scheduled_at && (
                <div className="drop-mini-metrics">
                  <span>
                    <strong>{d.prepared}</strong> passes prepared
                  </span>
                  <span>
                    <strong>{d.delivered}</strong> delivered
                  </span>
                  <span>
                    <strong>{d.returns}</strong> recorded returns
                  </span>
                </div>
              )}
            </div>
            {["draft", "review"].includes(d.state) && (
              <Link
                className="button secondary"
                href={`/merchant/create?id=${d.id}`}
              >
                {d.state === "review" ? "Revise draft" : "Open draft"}
                <ArrowUpRight size={15} />
              </Link>
            )}
          </section>
        );
      })}
    </div>
  );
}
export function NextThirtyDays({
  data,
  compact = false,
}: {
  data: Data;
  compact?: boolean;
}) {
  const now = new Date(data.asOf).getTime(),
    cutoff = now + 30 * 86400000,
    anchor = activeAnchor(data),
    upcoming = data.dropHistory
      .filter(
        (d) =>
          ["draft", "review", "scheduled", "live"].includes(d.state) &&
          new Date(d.starts_at).getTime() >= now &&
          new Date(d.starts_at).getTime() <= cutoff,
      )
      .sort(
        (a, b) =>
          new Date(a.scheduled_at || a.starts_at).getTime() -
          new Date(b.scheduled_at || b.starts_at).getTime(),
      );
  const nextWeekKey = new Date(
    Date.parse(
      `${weekKey(new Date(now), data.organization.timezone)}T12:00:00Z`,
    ) +
      7 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const anchorReview = anchor
    ? Math.max(now, new Date(anchor.starts_at).getTime() + 30 * 86400000)
    : null;
  const items = [
    {
      date: "NOW",
      title: anchor
        ? `${anchor.qualification} → ${anchor.reward}`
        : "Set up your acquisition Anchor",
      detail: `${placements(data).length} configured host placements. ${placements(data).filter((s) => s.status === "confirmed").length} handoffs confirmed.`,
      state: "Your Anchor",
      href: "/merchant/anchor",
    },
    ...upcoming.map((d) => ({
      date: date(d.scheduled_at || d.starts_at, data.organization.timezone),
      title: d.title,
      detail: d.scheduled_at
        ? "A message time is saved. Uptick checks readiness before sending."
        : "The offer has a proposed window. It is not on the send schedule yet.",
      state: d.scheduled_at ? "Scheduled" : offerState(d.state),
      href: ["draft", "review"].includes(d.state)
        ? `/merchant/create?id=${d.id}`
        : "/merchant/drops",
    })),
    ...(!upcoming.some(
      (d) =>
        weekKey(
          new Date(d.scheduled_at || d.starts_at),
          data.organization.timezone,
        ) === nextWeekKey,
    )
      ? [
          {
            date: "NEXT WEEK",
            title: "A new reason to come back.",
            detail: "There is no Drop proposed for next week yet.",
            state: "To plan",
            href: "/merchant/create",
          },
        ]
      : []),
    ...(anchorReview && anchorReview <= cutoff
      ? [
          {
            date:
              anchorReview === now
                ? "DUE FOR A LOOK"
                : date(
                    new Date(anchorReview).toISOString(),
                    data.organization.timezone,
                  ),
            title: "Review your Anchor with Uptick.",
            detail:
              "A suggested creative check 30 days after the current offer window starts.",
            state: "Suggested review",
            href: "/merchant/anchor",
          },
        ]
      : []),
  ];
  return (
    <section className="panel next-thirty">
      <div className="section-top">
        <div>
          <p className="eyebrow">
            <CalendarDays size={14} /> NEXT 30 DAYS
          </p>
          <h2>Keep good things coming.</h2>
        </div>
        {compact && (
          <TextLink href="/merchant/calendar">View the plan</TextLink>
        )}
      </div>
      <div className="plan-timeline">
        {(compact ? items.slice(0, 3) : items).map((item, i) => (
          <Link className="plan-timeline-item" href={item.href} key={i}>
            <span className="timeline-date">{item.date}</span>
            <span className="timeline-dot" />
            <div>
              <span className="eyebrow">{item.state}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </div>
            <ArrowUpRight size={16} />
          </Link>
        ))}
      </div>
      <p className="table-footnote">
        Only “Scheduled” entries have a saved send time. Suggested reviews and
        empty weeks are planning guidance.
      </p>
    </section>
  );
}
const activityLabels: Record<string, string> = {
  "offer.drafted": "Offer draft saved",
  "offer.submitted": "Offer sent to Uptick for review",
  "offer.approved": "Offer approved by Uptick",
  "offer.returned": "Uptick returned an offer with feedback",
  "offer.rejected": "Uptick did not approve an offer",
  "offer.paused": "Offer paused",
  "broadcast.queued": "Weekly Drop passes prepared",
  "broadcast.missed_window": "Weekly Drop window needs attention",
  "source.created": "A nearby placement was added",
  "source.revoked": "A placement QR was retired",
  "creative.created": "Screen creative created",
  "placement.updated": "Placement confirmation updated",
  "business.created": "Business added to Uptick",
  "sender.configured": "Messaging setup updated",
  "membership.assigned": "Business access updated",
};
export function MerchantActivity({ data }: { data: Data }) {
  return (
    <section className="panel merchant-activity">
      <div className="section-top">
        <div>
          <p className="eyebrow">
            <Activity size={14} /> YOUR GROWTH PROGRAM
          </p>
          <h2>Good work, kept in view.</h2>
        </div>
      </div>
      {data.activity.length ? (
        <ol>
          {data.activity.map((event) => (
            <li key={event.id}>
              <span className="activity-dot">
                <CheckCircle2 size={16} />
              </span>
              <div>
                <strong>
                  {activityLabels[event.action] ||
                    event.action.split(".").join(" ").replaceAll("_", " ")}
                </strong>
                <p>
                  {new Date(event.created_at).toLocaleString("en-US", {
                    month: "long",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: data.organization.timezone,
                  })}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="Your plan’s story starts here.">
          Offer drafts, reviews, scheduled Drops, and placement updates will
          appear as they happen.
        </Empty>
      )}
    </section>
  );
}
