import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  Clock,
  MapPin,
  Radio,
  ShieldCheck,
  Mail,
  Plus,
  AlertCircle,
  Download,
  ArrowLeft,
  Store,
  Gift,
} from "lucide-react";
import { requireActor } from "@/lib/auth";
import { getDb, type DB } from "@/lib/db";
import { localMode, messagingReady } from "@/lib/config";
import { offerAvailable, type Actor, type Offer } from "@/lib/domain";
import { businessReadiness, platformReadiness } from "@/lib/launch";
import {
  operatorOverview,
  operatorMessage,
  sourceDetail,
  type PlacementSource,
} from "@/lib/operator";
import {
  loadOfferMetadata,
  offerSmsPreview,
  qualityReview,
} from "@/lib/product";
import { Shell } from "@/components/shell";
import { Badge, ButtonLink, Empty, PageHeading, Metric } from "@/components/ui";
import { ActionButton, ReviewActions, SimpleForm } from "@/components/forms";
import { Builder } from "@/components/builder";
import {
  OperatorForm,
  CustomerLookup,
  PrintButton,
} from "@/components/operator-controls";
import "./operator.css";

export const dynamic = "force-dynamic";
const date = (value: string | null | undefined, time = false) =>
  value
    ? new Date(value).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: time ? undefined : "numeric",
        ...(time
          ? {
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short" as const,
            }
          : {}),
      })
    : "Not recorded";
const categories = [
  ["", "Not set"],
  ["fuel-convenience", "Fuel & convenience"],
  ["car-wash", "Car wash"],
  ["auto-service", "Auto service"],
  ["cafe", "Café"],
  ["restaurant", "Restaurant"],
  ["retail", "Retail"],
  ["wellness", "Wellness"],
  ["other", "Other"],
] as const;
type Overview = Awaited<ReturnType<typeof operatorOverview>>;
function PanelTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="op-panel-title">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
function State({ state }: { state: string }) {
  return (
    <Badge
      tone={
        ["live", "confirmed", "delivered", "complete", "subscribed"].includes(
          state,
        )
          ? "mint"
          : ["review", "intended", "failed", "undelivered", "pending"].includes(
                state,
              )
            ? "amber"
            : "neutral"
      }
    >
      {state === "confirmed"
        ? "Confirmed by Uptick"
        : state === "review"
          ? "Awaiting review"
          : state.replaceAll("_", " ")}
    </Badge>
  );
}
function OfferLine({ offer }: { offer: Offer }) {
  return (
    <div className="op-offer-copy">
      <p>{offer.qualification}</p>
      <strong>{offer.reward}</strong>
    </div>
  );
}
function OfferTable({ offers }: { offers: Offer[] }) {
  return offers.length ? (
    <div className="op-table-wrap">
      <table className="op-table">
        <thead>
          <tr>
            <th>Offer / business</th>
            <th>Type</th>
            <th>Status</th>
            <th>Window</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => (
            <tr key={o.id}>
              <td>
                <strong>{o.title}</strong>
                <span>{o.merchant}</span>
              </td>
              <td>{o.kind === "anchor" ? "Anchor" : "Weekly Drop"}</td>
              <td>
                <State state={o.state} />
              </td>
              <td>
                {date(o.starts_at)}
                <span>Until {date(o.expires_at)}</span>
              </td>
              <td>
                <Link className="text-link" href={`/operator/review/${o.id}`}>
                  Open
                  <ArrowUpRight size={15} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No offers in this view">
      Create an Anchor or Weekly Drop to get started.
    </Empty>
  );
}
function SourceTable({ sources }: { sources: PlacementSource[] }) {
  return sources.length ? (
    <div className="op-table-wrap">
      <table className="op-table">
        <thead>
          <tr>
            <th>Host / placement</th>
            <th>Merchant</th>
            <th>Handoff</th>
            <th>Visits</th>
            <th>Claims</th>
            <th>Redeemed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.host || "Direct source"}</strong>
                <span>{s.placement || s.campaign}</span>
              </td>
              <td>
                {s.merchant}
                <span>{s.creative}</span>
              </td>
              <td>
                <State
                  state={
                    s.state === "revoked" ? "revoked" : s.status || "intended"
                  }
                />
              </td>
              <td>{s.visits}</td>
              <td>{s.claims}</td>
              <td>{s.redemptions}</td>
              <td>
                <Link className="text-link" href={`/operator/sources/${s.id}`}>
                  Open
                  <ArrowUpRight size={15} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="Build the first connection">
      Add a host placement and QR source below.
    </Empty>
  );
}

function Today({ data }: { data: Overview }) {
  const now = Date.parse(data.evaluatedAt),
    review = data.offers.filter((o) => o.state === "review"),
    intended = data.sources.filter(
      (s) => s.state === "active" && s.status === "intended",
    ),
    failed = data.messages.filter((m) =>
      ["failed", "undelivered", "uncertain", "unknown"].includes(m.state),
    ),
    expiring = data.offers.filter(
      (o) =>
        o.state === "live" &&
        Date.parse(o.expires_at) > now &&
        Date.parse(o.expires_at) < now + 7 * 86400000,
    ),
    inactive = data.sources.filter(
      (s) =>
        s.state === "active" &&
        s.status === "confirmed" &&
        now - Date.parse(s.last_visit || s.created_at) > 14 * 86400000,
    );
  const inbox = [
    ...review.map((o) => ({
      key: o.id,
      kind: "OFFER REVIEW",
      title: o.title,
      detail: `${o.merchant} · ${o.reward}`,
      href: `/operator/review/${o.id}`,
      action: "Review offer",
      icon: Gift,
    })),
    ...intended.map((s) => ({
      key: s.id,
      kind: "PLACEMENT HANDOFF",
      title: s.host,
      detail: `${s.placement} · Awaiting Uptick confirmation`,
      href: `/operator/sources/${s.id}`,
      action: "Check placement",
      icon: Radio,
    })),
    ...failed.slice(0, 5).map((m) => ({
      key: m.id,
      kind: "MESSAGE NEEDS ATTENTION",
      title: `${m.merchant} · ••• ${m.phone_suffix}`,
      detail: `${m.state}${m.error_code ? ` · Provider code ${m.error_code}` : ""}`,
      href: `/operator/messages?message=${m.id}`,
      action: "Troubleshoot",
      icon: Mail,
    })),
    ...expiring.map((o) => ({
      key: `expire-${o.id}`,
      kind: "ANCHOR ENDING SOON",
      title: o.title,
      detail: `${o.merchant} · Ends ${date(o.expires_at)}`,
      href: `/operator/review/${o.id}`,
      action: "Review window",
      icon: Clock,
    })),
    ...inactive.map((s) => ({
      key: `inactive-${s.id}`,
      kind: "PLACEMENT CHECK",
      title: s.host,
      detail:
        "No recorded source visit in the last 14 days. Check the physical placement.",
      href: `/operator/sources/${s.id}`,
      action: "Inspect source",
      icon: MapPin,
    })),
  ];
  const today = data.broadcasts.filter(
    (b) =>
      b.state === "scheduled" &&
      new Date(b.scheduled_at).toDateString() ===
        new Date(data.evaluatedAt).toDateString(),
  );
  return (
    <>
      <PageHeading
        eyebrow="NETWORK OPERATIONS"
        title={
          <>
            Keep good things
            <br />
            <em>moving.</em>
          </>
        }
        description="The decisions, handoffs and customer moments that need Uptick today."
        action={
          <ButtonLink href="/operator/onboarding">
            Onboard a business
          </ButtonLink>
        }
      />
      <div className="op-overview-strip">
        <div>
          <span className="op-live-pulse" />
          <strong>
            {
              data.businesses.filter((b) => b.capabilities.includes("merchant"))
                .length
            }
          </strong>
          <span>merchant businesses</span>
        </div>
        <div>
          <strong>
            {
              data.sources.filter(
                (s) => s.status === "confirmed" && s.state === "active",
              ).length
            }
          </strong>
          <span>confirmed sources</span>
        </div>
        <div>
          <strong>
            {
              data.offers.filter(
                (o) => o.kind === "anchor" && offerAvailable(o),
              ).length
            }
          </strong>
          <span>live Anchors</span>
        </div>
        <div>
          <strong>{today.length}</strong>
          <span>Drops scheduled today</span>
        </div>
      </div>
      <div className="op-command-grid">
        <section className="panel op-inbox">
          <PanelTitle
            eyebrow="TODAY’S INBOX"
            title={
              inbox.length
                ? `${inbox.length} ${inbox.length === 1 ? "thing" : "things"} to move forward`
                : "The handoffs are up to date"
            }
          >
            <Badge tone={inbox.length ? "amber" : "mint"}>
              {inbox.length ? "Your attention" : "All clear"}
            </Badge>
          </PanelTitle>
          {inbox.length ? (
            inbox.map((item) => (
              <Link className="op-inbox-row" href={item.href} key={item.key}>
                <span className="op-inbox-icon">
                  <item.icon size={21} />
                </span>
                <div>
                  <p className="eyebrow">{item.kind}</p>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </div>
                <span className="op-inbox-action">
                  {item.action}
                  <ArrowUpRight size={16} />
                </span>
              </Link>
            ))
          ) : (
            <Empty title="Room to work on the next connection">
              Review your businesses, prepare the next Drop, or check a physical
              placement.
            </Empty>
          )}
        </section>
        <aside className="op-today-aside">
          <section className="op-network-card">
            <p className="eyebrow">THE LOCAL NETWORK</p>
            <h2>
              Real places.
              <br />
              <em>Recorded progress.</em>
            </h2>
            <div className="op-network-lines">
              {data.sources.slice(0, 4).map((s) => (
                <Link href={`/operator/sources/${s.id}`} key={s.id}>
                  <span>
                    <Radio size={15} />
                    {s.host}
                  </span>
                  <span
                    className={
                      s.status === "confirmed" ? "op-dot mint" : "op-dot amber"
                    }
                  />
                </Link>
              ))}
            </div>
            <Link href="/operator/placements" className="text-link">
              Open placements
              <ArrowRight size={16} />
            </Link>
            <p className="fine">
              Confirmed means an Uptick handoff was recorded. Screen playback is
              managed externally.
            </p>
          </section>
          <section className="panel">
            <PanelTitle title="Sending readiness" />
            <div className="op-explainer">
              <ShieldCheck size={21} />
              <p>
                {localMode()
                  ? "Local development is active. Sample businesses and test transport are separate from production."
                  : messagingReady()
                    ? "Platform messaging gates are configured. Each merchant still needs an approved sender."
                    : "Production sending is gated until provider configuration, messaging approval and legal approval are ready."}
              </p>
            </div>
            <Link className="text-link" href="/operator/settings">
              Review setup
              <ArrowUpRight size={16} />
            </Link>
          </section>
        </aside>
      </div>
      <section className="panel">
        <PanelTitle
          eyebrow="NEXT ON THE CALENDAR"
          title="Scheduled Weekly Drops"
        />
        <div className="op-schedule-list">
          {data.broadcasts
            .filter((b) => b.state === "scheduled")
            .slice(0, 4)
            .map((b) => (
              <Link href={`/operator/review/${b.offer_id}`} key={b.id}>
                <span className="op-calendar">
                  <Clock size={20} />
                </span>
                <div>
                  <strong>{b.title}</strong>
                  <p>{b.merchant}</p>
                </div>
                <time>{date(b.scheduled_at, true)}</time>
                <ArrowUpRight size={16} />
              </Link>
            ))}
        </div>
        {!data.broadcasts.some((b) => b.state === "scheduled") && (
          <p className="muted">
            No Drops scheduled yet. An approved offer and a valid send window
            come first.
          </p>
        )}
      </section>
    </>
  );
}

function Businesses({ data }: { data: Overview }) {
  return (
    <>
      <PageHeading
        eyebrow="BUSINESSES & LOCATIONS"
        title={
          <>
            A neighborhood.
            <br />
            <em>One operating view.</em>
          </>
        }
        description="Merchants bring the offer. Hosts provide the physical connection. Uptick runs the loop."
        action={
          <ButtonLink href="/operator/onboarding">Add business</ButtonLink>
        }
      />
      <div className="op-business-grid">
        {data.businesses.map((b) => (
          <Link
            key={b.id}
            href={`/operator/businesses/${b.id}`}
            className="panel op-business-card"
          >
            <div className="op-business-icon">
              <Store size={24} />
              <ArrowUpRight size={18} />
            </div>
            <p className="eyebrow">
              {b.capabilities.join(" + ")}
              {b.is_demo ? " · LOCAL SAMPLE" : ""}
            </p>
            <h2>{b.name}</h2>
            <p>
              {categories.find((c) => c[0] === b.category)?.[1] ||
                "Category not set"}{" "}
              · {b.locations} {b.locations === 1 ? "location" : "locations"}
            </p>
            <div className="op-business-bottom">
              <span>
                {b.capabilities.includes("merchant")
                  ? `${b.offers} live / scheduled offers`
                  : "Physical host partner"}
              </span>
              <span>
                {b.capabilities.includes("merchant")
                  ? `${b.subscribers} subscribers`
                  : "View locations"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function NewBusiness() {
  return (
    <section className="panel">
      <PanelTitle
        eyebrow="01 / BUSINESS IDENTITY"
        title="Add a business and first location"
      />
      <SimpleForm action="create-business" button="Create business">
        <div className="field-pair">
          <label>
            Business name
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              placeholder="Joe’s Fuel & Go"
            />
          </label>
          <label>
            Role in the network
            <select name="capability">
              <option value="merchant">Merchant · runs offers</option>
              <option value="host">Host · carries placements</option>
            </select>
          </label>
        </div>
        <label>
          First location address
          <input
            name="address"
            required
            minLength={5}
            maxLength={240}
            placeholder="Street, city, state and ZIP"
          />
        </label>
        <label>
          Business timezone
          <select name="timezone" defaultValue="America/New_York">
            <option value="America/New_York">Eastern · America/New_York</option>
            <option value="America/Chicago">Central · America/Chicago</option>
            <option value="America/Denver">Mountain · America/Denver</option>
            <option value="America/Phoenix">Arizona · America/Phoenix</option>
            <option value="America/Los_Angeles">
              Pacific · America/Los_Angeles
            </option>
            <option value="America/Anchorage">
              Alaska · America/Anchorage
            </option>
            <option value="Pacific/Honolulu">Hawaii · Pacific/Honolulu</option>
          </select>
        </label>
        <p className="fine">
          The timezone governs Weekly Drop quiet hours. Creating a business does
          not publish an offer or enable sending.
        </p>
      </SimpleForm>
    </section>
  );
}
function Onboarding({ data }: { data: Overview }) {
  return (
    <>
      <PageHeading
        eyebrow="PILOT ONBOARDING"
        title={
          <>
            The next merchant,
            <br />
            <em>set up well.</em>
          </>
        }
        description="Start with the business. Then work through the offer, local placements, sender and real-world handoff."
      />
      <ol className="op-onboarding-steps">
        {[
          "Business & location",
          "Anchor & goal",
          "Host & creative",
          "Sender & staff",
          "Launch checks",
        ].map((x, i) => (
          <li key={x}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {x}
          </li>
        ))}
      </ol>
      <div className="op-two-col">
        <NewBusiness />
        <section className="panel">
          <PanelTitle
            eyebrow="CONTINUE SETUP"
            title="Pick up with a business"
          />
          {data.businesses.map((b) => (
            <Link
              key={b.id}
              className="op-setup-row"
              href={`/operator/businesses/${b.id}`}
            >
              <span className="op-avatar">{b.name.slice(0, 1)}</span>
              <div>
                <strong>{b.name}</strong>
                <p>
                  {b.category ? "Category saved" : "Add business category"} ·{" "}
                  {b.capabilities.includes("merchant")
                    ? b.sender_approved
                      ? "Sender marked approved"
                      : "Sender setup needed"
                    : "Host partner"}
                </p>
              </div>
              <ArrowUpRight size={17} />
            </Link>
          ))}
        </section>
      </div>
    </>
  );
}

async function BusinessDetail({
  db,
  data,
  businessId,
  pilot = false,
}: {
  db: DB;
  data: Overview;
  businessId: string;
  pilot?: boolean;
}) {
  const b = data.businesses.find((b) => b.id === businessId);
  if (!b) notFound();
  const offers = data.offers.filter((o) => o.organization_id === b.id),
    sources = data.sources.filter((s) => s.organization_id === b.id),
    locations = data.locations.filter((l) => l.organization_id === b.id),
    anchor = offers.find((o) => o.kind === "anchor" && offerAvailable(o));
  const production = await businessReadiness(db, b.id);
  const [sender] = await db.query<{
    approved: boolean;
    service_sid: string | null;
    phone_present: boolean;
  }>(
    "select approved,service_sid,phone is not null phone_present from senders where organization_id=$1",
    [b.id],
  );
  const checks = await db.query<{
    check_key: string;
    note: string;
    checked_at: string;
  }>(
    "select check_key,note,checked_at from launch_checks where organization_id=$1",
    [b.id],
  );
  const [{ latest }] = await db.query<{ latest: string | null }>(
    `select max(v.created_at) latest from offer_versions v join offers o on o.id=v.offer_id where o.organization_id=$1 and o.kind='anchor'`,
    [b.id],
  );
  const creativeRows = await db.query<{
    source_id: string;
    offer_version: number;
    created_at: string;
  }>(
    `select c.source_id,c.offer_version,c.created_at from source_creatives c join sources s on s.id=c.source_id join offers o on o.id=s.offer_id where o.organization_id=$1`,
    [b.id],
  );
  const members = await db.query<{
    user_id: string;
    role: string;
    can_export: boolean;
  }>(
    "select user_id,role,can_export from memberships where organization_id=$1 order by role",
    [b.id],
  );
  const activeSources = sources.filter(
      (s) => s.state === "active" && s.offer_id === anchor?.id,
    ),
    activeCreatives = creativeRows.filter(
      (c) =>
        activeSources.some((s) => s.id === c.source_id) &&
        c.offer_version === anchor?.current_version,
    );
  const changedAt = Math.max(
    Date.parse(latest || "1970-01-01"),
    Date.parse(production.senderChangedAt || "1970-01-01"),
    ...activeSources.map((s) => Date.parse(s.created_at)),
    ...activeCreatives.map((c) => Date.parse(c.created_at)),
  );
  const tested = (key: string) =>
    checks.some(
      (c) => c.check_key === key && Date.parse(c.checked_at) >= changedAt,
    );
  const readiness = [
    {
      title: "Anchor accepting claims",
      done: !!anchor,
      detail:
        anchor?.title || "An approved Anchor must be inside its offer window.",
      href: `/operator/offers/new?business=${b.id}`,
    },
    {
      title: "Source & placement",
      done: activeSources.length > 0,
      detail: `${activeSources.length} active sources for the current Anchor`,
      href: "/operator/placements",
    },
    {
      title: "Screen creative",
      done:
        activeSources.length > 0 &&
        activeSources.every((s) =>
          activeCreatives.some((c) => c.source_id === s.id),
        ),
      detail: `${activeCreatives.length} creatives match the current Anchor version`,
      href: "/operator/creatives",
    },
    {
      title: "Screen handoff confirmed",
      done:
        activeSources.length > 0 &&
        activeSources.every((s) => s.status === "confirmed"),
      detail:
        "Uptick confirmation records external installation; it does not prove playback.",
      href: "/operator/placements",
    },
    {
      title: "Production SMS",
      done: production.readyToAcceptClaims,
      detail: localMode()
        ? "Local test mode. Production sending remains gated."
        : "Platform configuration, legal identity and the approved merchant sender must all be ready.",
      href: "/operator/settings",
    },
    {
      title: "Terms & privacy approval",
      done: process.env.LEGAL_APPROVED === "true",
      detail:
        "Published support pages exist; production copy needs recorded legal approval.",
      href: "/terms",
    },
    {
      title: "Claim flow tested",
      done: tested("claim-tested"),
      detail:
        "Record a fresh claim test after the latest Anchor, source or sender change.",
      href: "#manual-checks",
    },
    {
      title: "Pass & redemption tested",
      done: tested("pass-tested"),
      detail: "Record a fresh pass and cashier redemption test.",
      href: "#manual-checks",
    },
    {
      title: "Staff briefed",
      done: tested("staff-briefed"),
      detail: "Review qualification, reward and the one-time redemption step.",
      href: `/operator/pilot/${b.id}`,
    },
  ];
  if (pilot) {
    const meta = anchor
      ? await loadOfferMetadata(db, anchor.id, anchor.current_version)
      : null;
    return (
      <>
        <div className="op-no-print">
          <Link className="text-link" href={`/operator/businesses/${b.id}`}>
            <ArrowLeft size={16} />
            Back to business
          </Link>
          <PageHeading
            eyebrow="PRINTABLE PILOT SHEET"
            title={b.name}
            description="A practical handoff for the merchant, host and Uptick operator."
            action={<PrintButton />}
          />
        </div>
        <article className="panel op-pilot-sheet">
          <div className="op-pilot-masthead">
            <span>UPTICK LOCAL</span>
            <Badge>
              {b.is_demo ? "Local sample pilot" : "Merchant handoff"}
            </Badge>
          </div>
          <h1>{b.name}</h1>
          <p>{locations.map((l) => l.address).join(" · ")}</p>
          <div className="op-two-col">
            <section>
              <p className="eyebrow">THE ANCHOR</p>
              {anchor ? (
                <>
                  <h2>{anchor.qualification}</h2>
                  <h2 className="op-amber-text">{anchor.reward}</h2>
                  <p>
                    Valid {date(anchor.starts_at)} – {date(anchor.expires_at)}
                  </p>
                  <p>{anchor.terms}</p>
                </>
              ) : (
                <p>An approved Anchor is needed before the staff handoff.</p>
              )}
              <h3>Cashier instructions</h3>
              <p>
                {meta?.staffInstructions ||
                  "Check the qualifying purchase and active pass. Ask the customer to tap Redeem while you watch. Provide the reward once the pass shows a recorded redemption."}
              </p>
              <ol>
                <li>Customer makes the qualifying purchase.</li>
                <li>Cashier checks the receipt and active pass.</li>
                <li>Customer taps Redeem with the cashier watching.</li>
                <li>Cashier provides the free reward once.</li>
              </ol>
              <h3>After the reward</h3>
              <p>
                The customer can choose this merchant’s Weekly Drop. Marketing
                consent is optional and never required to get the offer.
              </p>
            </section>
            <section>
              <p className="eyebrow">HOST HANDOFF</p>
              {sources.map((s) => (
                <div className="op-pilot-source" key={s.id}>
                  <strong>
                    {s.host} · {s.placement}
                  </strong>
                  <p>
                    {s.creative} ·{" "}
                    {s.status === "confirmed"
                      ? "Confirmed by Uptick"
                      : "Handoff pending"}
                  </p>
                  <Link href={`/api/qr/${s.id}`}>Download source QR</Link>
                  {creativeRows.some((c) => c.source_id === s.id) && (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={`/api/creative/${s.id}`}>
                        Download screen creative
                      </Link>
                    </>
                  )}
                </div>
              ))}
              <h3>Launch checks</h3>
              {readiness.map((c) => (
                <p className="op-print-check" key={c.title}>
                  <span>{c.done ? "✓" : "○"}</span>
                  {c.title}
                </p>
              ))}
              <p className="fine">
                Generated {date(new Date().toISOString(), true)}. Test every QR
                at its actual placement. External screen playback is not
                measured by Uptick.
              </p>
            </section>
          </div>
        </article>
      </>
    );
  }
  return (
    <>
      <Link className="text-link" href="/operator/businesses">
        <ArrowLeft size={15} />
        All businesses
      </Link>
      <PageHeading
        eyebrow={`${b.capabilities.join(" + ").toUpperCase()}${b.is_demo ? " · LOCAL SAMPLE" : ""}`}
        title={b.name}
        description={`${b.timezone} · ${b.locations} ${b.locations === 1 ? "location" : "locations"} · Uptick managed`}
        action={
          <ButtonLink href={`/operator/pilot/${b.id}`}>
            Staff & pilot sheet
          </ButtonLink>
        }
      />
      {b.capabilities.includes("merchant") && (
        <section className="panel op-launch-panel">
          <PanelTitle
            eyebrow="LAUNCH READINESS"
            title={
              readiness.every((x) => x.done)
                ? "Ready for a real-world launch"
                : `${readiness.filter((x) => x.done).length} of ${readiness.length} checks complete`
            }
          >
            <ButtonLink href={`/operator/offers/new?business=${b.id}`} quiet>
              Create offer
            </ButtonLink>
          </PanelTitle>
          <div className="op-check-grid">
            {readiness.map((c) => (
              <Link
                href={c.href}
                className={`op-check ${c.done ? "done" : ""}`}
                key={c.title}
              >
                <span>{c.done ? <Check size={17} /> : <span />}</span>
                <div>
                  <strong>{c.title}</strong>
                  <p>{c.detail}</p>
                </div>
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
        </section>
      )}
      <div className="op-two-col">
        <section className="panel">
          <PanelTitle
            eyebrow="BUSINESS CONTEXT"
            title="A clear job for the system"
          />
          <OperatorForm
            action="business-profile"
            extra={{ organizationId: b.id }}
            button="Save business context"
          >
            <label>
              Business category
              <select name="category" defaultValue={b.category}>
                {categories.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="fine">
              The same specific category at a merchant and host is a direct
              competitor conflict. Manual placement checks are still required
              when categories are incomplete.
            </p>
            <label>
              Acquisition goal
              <textarea
                name="growthGoal"
                maxLength={300}
                rows={3}
                defaultValue={b.growth_goal}
                placeholder="Bring nearby drivers into the store, then give them a reason to return."
              />
            </label>
          </OperatorForm>
        </section>
        <section className="panel">
          <PanelTitle
            eyebrow="PHYSICAL LOCATIONS"
            title="Where this business operates"
          />
          {locations.map((l) => (
            <div className="op-location-row" key={l.id}>
              <MapPin size={20} />
              <div>
                <strong>{l.name}</strong>
                <p>{l.address}</p>
              </div>
            </div>
          ))}
          <details className="op-details">
            <summary>
              Add another location
              <Plus size={15} />
            </summary>
            <OperatorForm
              action="add-location"
              extra={{ organizationId: b.id }}
              button="Add location"
            >
              <label>
                Location name
                <input name="name" required minLength={2} maxLength={100} />
              </label>
              <label>
                Address
                <input name="address" required minLength={5} maxLength={240} />
              </label>
            </OperatorForm>
          </details>
        </section>
      </div>
      {b.capabilities.includes("merchant") && (
        <>
          <section className="panel">
            <PanelTitle title="Offers for this business" />
            <OfferTable offers={offers} />
          </section>
          <div className="op-two-col">
            <section className="panel" id="sender">
              <PanelTitle
                eyebrow="PRODUCTION SENDER"
                title="Connect the approved sender"
              />
              <p className="muted">
                Registration happens with your SMS provider. This form records a
                sender that has already been registered and reviewed; it does
                not register or approve one externally.
              </p>
              <State state={sender?.approved ? "approved" : "pending"} />
              <SimpleForm
                action="sender"
                extra={{ organizationId: b.id }}
                button="Save sender configuration"
              >
                <label>
                  Twilio Messaging Service SID
                  <input
                    name="serviceSid"
                    required
                    pattern="MG[0-9a-fA-F]{32}"
                    placeholder="MG…"
                    defaultValue={sender?.service_sid || ""}
                  />
                </label>
                <label>
                  Sending number · US E.164
                  <input
                    name="phone"
                    required
                    type="tel"
                    pattern="\+1[0-9]{10}"
                    placeholder="+12015550123"
                    autoComplete="off"
                  />
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    name="approved"
                    defaultChecked={sender?.approved}
                  />
                  <span>
                    I have verified provider registration and merchant-specific
                    approval.
                  </span>
                </label>
              </SimpleForm>
            </section>
            <section className="panel" id="manual-checks">
              <PanelTitle
                eyebrow="REAL-WORLD VALIDATION"
                title="Record what you tested"
              />
              <OperatorForm
                action="launch-check"
                extra={{ organizationId: b.id }}
                button="Save test evidence"
              >
                <label>
                  Check completed
                  <select name="checkKey">
                    <option value="claim-tested">QR → accepted claim</option>
                    <option value="pass-tested">
                      Pass → one-time redemption
                    </option>
                    <option value="staff-briefed">
                      Cashier / staff briefing
                    </option>
                  </select>
                </label>
                <label>
                  What was checked?
                  <textarea
                    name="note"
                    required
                    minLength={8}
                    maxLength={600}
                    rows={3}
                    placeholder="Record the source, offer version and result. Do not include phone numbers or private pass links."
                  />
                </label>
              </OperatorForm>
              {checks.map((c) => (
                <div className="op-evidence" key={c.check_key}>
                  <strong>{c.check_key.replaceAll("-", " ")}</strong>
                  <p>{c.note}</p>
                  <time>{date(c.checked_at, true)}</time>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
      <section className="panel">
        <PanelTitle eyebrow="ACCOUNT ACCESS" title="Verified account access" />
        <p className="muted">
          Assign accounts by verified email, check authenticator readiness, and
          revoke access through the account-access screen.
        </p>
        <Link className="button secondary" href="/operator/pilot/access">
          Manage account access
        </Link>
        <div className="op-member-list">
          {members.map((m) => (
            <p key={m.user_id}>
              <code>{m.user_id}</code>
              <Badge>{m.role}</Badge>
              <span>{m.can_export ? "Export access" : "No export access"}</span>
            </p>
          ))}
        </div>
      </section>
    </>
  );
}

function Placements({
  data,
  creatives = false,
}: {
  data: Overview;
  creatives?: boolean;
}) {
  return (
    <>
      <PageHeading
        eyebrow={creatives ? "SCREEN OPERATIONS BRIDGE" : "PHYSICAL NETWORK"}
        title={
          creatives ? (
            <>
              Make the offer
              <br />
              <em>work in the room.</em>
            </>
          ) : (
            <>
              Every connection,
              <br />
              <em>accounted for.</em>
            </>
          )
        }
        description={
          creatives
            ? "Prepare a screen-ready creative and its source QR. Export the handoff for your external screen system."
            : "Place acquisition Anchors with nearby hosts. Confirm the external handoff, then learn from recorded source activity."
        }
      />
      {creatives && (
        <div className="op-explainer panel">
          <Radio size={25} />
          <p>
            Open a source to create its first creative. Each replacement
            creative gets a new source and QR, so earlier claims keep their
            original context. Exporting does not confirm installation or
            playback.
          </p>
        </div>
      )}
      <section className="panel">
        <PanelTitle
          title={
            creatives
              ? "Source creative workspace"
              : "Placements & source activity"
          }
        >
          <Badge>{data.sources.length} sources</Badge>
        </PanelTitle>
        <SourceTable sources={data.sources} />
        <p className="fine">
          Visits are recorded QR link requests, not screen impressions or unique
          viewers. Claim and redemption totals belong to the source.
        </p>
      </section>
      <section className="panel">
        <PanelTitle
          eyebrow="ADD A LOCAL CONNECTION"
          title="Create a placement and QR source"
        />
        <OperatorForm
          action="create-placement-source"
          button="Create placement & source"
        >
          <div className="field-pair">
            <label>
              Merchant Anchor
              <select name="offerId" required defaultValue="">
                <option value="" disabled>
                  Choose an acquisition offer
                </option>
                {data.offers
                  .filter((o) => o.kind === "anchor")
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.merchant} · {o.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Host location
              <select name="locationId" required defaultValue="">
                <option value="" disabled>
                  Choose a host
                </option>
                {data.locations
                  .filter((l) => l.capabilities.includes("host"))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.business} · {l.name}
                      {l.category
                        ? ` · ${categories.find((c) => c[0] === l.category)?.[1] || l.category}`
                        : " · category not set"}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="op-explainer">
            <ShieldCheck size={18} />
            <p>
              Same-category merchant and host placements are blocked. Confirm
              compatibility manually when categories are missing or broad. Set
              categories in each business’s profile.
            </p>
          </div>
          <div className="field-pair">
            <label>
              Placement name
              <input
                name="placement"
                required
                minLength={2}
                maxLength={100}
                placeholder="Waiting area · Display 01"
              />
            </label>
            <label>
              Placement type
              <select name="placementType">
                <option>Wall TV</option>
                <option>Countertop display</option>
                <option>Printed counter QR</option>
                <option>Lobby display</option>
              </select>
            </label>
          </div>
          <div className="field-pair">
            <label>
              Screen environment
              <input
                name="environment"
                maxLength={160}
                placeholder="Customer lounge, visible from the seats"
              />
            </label>
            <label>
              Useful dwell context
              <input
                name="dwellContext"
                maxLength={160}
                placeholder="Customers wait during a service"
              />
            </label>
          </div>
          <div className="field-pair">
            <label>
              Campaign reference
              <input
                name="campaign"
                required
                minLength={2}
                maxLength={120}
                placeholder="Neighborhood acquisition"
              />
            </label>
            <label>
              Initial creative reference
              <input
                name="creative"
                required
                minLength={2}
                maxLength={120}
                placeholder="Fuel + free coffee · V1"
              />
            </label>
          </div>
          <p className="fine">
            Each source preserves its offer, placement, campaign and creative
            reference. To replace a QR or move a campaign, create a new source.
          </p>
        </OperatorForm>
      </section>
    </>
  );
}

async function SourcePage({
  db,
  actor,
  id,
}: {
  db: DB;
  actor: Actor;
  id: string;
}) {
  const detail = await sourceDetail(db, actor, id);
  if (!detail) notFound();
  const { source: s, offer, history, creative, children } = detail;
  return (
    <>
      <Link className="text-link" href="/operator/placements">
        <ArrowLeft size={15} />
        All placements
      </Link>
      <PageHeading
        eyebrow="SOURCE DETAIL"
        title={s.host || s.campaign}
        description={`${s.placement || "Direct QR"} · ${s.merchant} · ${s.offer_title}`}
        action={
          <a className="button" href={`/api/qr/${s.id}`}>
            Download source QR
            <Download size={16} />
          </a>
        }
      />
      <div className="op-source-bar">
        <State state={s.state === "revoked" ? "revoked" : s.status} />
        <span>Created {date(s.created_at)}</span>
        <code>{s.id}</code>
        <Link className="text-link" href={`/c/${s.token}`} target="_blank">
          Open claim experience
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="metrics-grid op-source-metrics">
        <Metric
          label="SOURCE VISITS"
          value={s.visits}
          note="Recorded link requests"
        />
        <Metric
          label="ACCEPTED CLAIMS"
          value={s.claims}
          note="Saved passes from this source"
        />
        <Metric
          label="REDEMPTIONS"
          value={s.redemptions}
          note="Recorded one-time redemptions"
        />
        <Metric
          label="DROP SUBSCRIBERS"
          value={s.optins}
          note="Current subscribers who claimed here"
          accent
        />
      </div>
      <div className="op-two-col">
        <section className="panel">
          <PanelTitle eyebrow="SCREEN HANDOFF" title="Confirm what happened" />
          <dl className="op-detail-list">
            <dt>Placement</dt>
            <dd>{s.placement_type}</dd>
            <dt>Environment</dt>
            <dd>{s.environment || "Not recorded"}</dd>
            <dt>Dwell context</dt>
            <dd>{s.dwell_context || "Not recorded"}</dd>
            <dt>Last source visit</dt>
            <dd>{date(s.last_visit, true)}</dd>
            <dt>External screen reference</dt>
            <dd>{s.external_reference || "Not recorded"}</dd>
          </dl>
          <OperatorForm
            action="placement-confirmation"
            extra={{ id: s.placement_id }}
            button="Save handoff status"
          >
            <label>
              Placement status
              <select name="status" defaultValue={s.status || "intended"}>
                <option value="intended">Intended · not confirmed</option>
                <option value="confirmed">Confirmed by Uptick</option>
                <option value="paused">Paused externally</option>
              </select>
            </label>
            <label>
              External screen reference
              <input
                name="externalReference"
                defaultValue={s.external_reference || ""}
                maxLength={120}
                placeholder="Optional screen ID or handoff reference"
              />
            </label>
            <label>
              Confirmation note
              <textarea
                name="note"
                required
                minLength={5}
                maxLength={600}
                rows={3}
                placeholder="What was installed, checked or paused, and where?"
              />
            </label>
            <p className="fine">
              This records an operator’s external handoff. It does not verify
              playback. Pausing a placement does not invalidate existing passes
              or disable its QR.
            </p>
          </OperatorForm>
        </section>
        <section className="panel">
          <PanelTitle eyebrow="PERMANENT CONTEXT" title="Placement history" />
          <div className="op-timeline">
            <article>
              <span className="op-event-dot neutral" />
              <div>
                <time>{date(s.created_at, true)}</time>
                <h3>Source created</h3>
                <p>
                  {s.campaign} · {s.creative}
                </p>
              </div>
            </article>
            {history.map((h) => (
              <article key={h.id}>
                <span
                  className={`op-event-dot ${h.status === "confirmed" ? "mint" : "amber"}`}
                />
                <div>
                  <time>{date(h.created_at, true)}</time>
                  <h3>
                    {h.status === "confirmed"
                      ? "Confirmed by Uptick"
                      : h.status === "paused"
                        ? "Placement paused"
                        : "Placement intended"}
                  </h3>
                  <p>{h.note}</p>
                  {h.external_reference && (
                    <small>{h.external_reference}</small>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!history.length && (
            <p className="fine">
              The original source had no detailed confirmation note. New handoff
              updates are saved above.
            </p>
          )}
          <div className="op-source-controls">
            <h3>Retire this QR when its job is done</h3>
            <p className="fine">
              Revoking stops new claims from this link. Existing customer passes
              stay valid. This action does not stop external screen playback.
            </p>
            {s.state === "active" ? (
              <ActionButton
                action="revoke-source"
                data={{ id: s.id }}
                secondary
              >
                Revoke source link
              </ActionButton>
            ) : (
              <State state="revoked" />
            )}
          </div>
        </section>
      </div>
      <section className="panel">
        <PanelTitle
          eyebrow="CREATIVE HANDOFF"
          title={
            creative
              ? `Screen creative · version ${creative.version}`
              : "Make the message tangible"
          }
        >
          {creative && (
            <a className="button" href={`/api/creative/${s.id}`}>
              Export SVG
              <Download size={16} />
            </a>
          )}
        </PanelTitle>
        <div className="op-two-col">
          <div className="op-creative-preview">
            {creative ? (
              <Image
                unoptimized
                src={`/api/creative/${s.id}?preview=1`}
                width={creative.format === "landscape" ? 1920 : 1080}
                height={creative.format === "landscape" ? 1080 : 1440}
                alt={`${s.merchant} screen creative version ${creative.version}`}
              />
            ) : (
              <div className="op-screen-draft">
                <span className="eyebrow">{s.merchant}</span>
                <h2>{offer.qualification}</h2>
                <h2>{offer.reward}</h2>
                <span>SCAN FOR YOUR PRIVATE PASS</span>
                <p>
                  Draft preview · save a creative to generate the source QR
                  artwork.
                </p>
              </div>
            )}
            <p className="fine">
              {creative
                ? `Saved against offer version ${creative.offer_version}. Export is an SVG suitable for handoff; install it in your external screen system.`
                : "No playback, impressions or installation is implied."}
            </p>
          </div>
          {children.length > 0 ? (
            <div className="op-explainer">
              <p>
                This artwork has a replacement. Open the replacement below to
                prepare the next version; the earlier artwork remains preserved.
              </p>
            </div>
          ) : (
            <OperatorForm
              action="create-creative"
              extra={{ sourceId: s.id }}
              button={
                creative
                  ? "Create replacement version & QR"
                  : "Save first screen creative"
              }
            >
              <label>
                Screen headline
                <input
                  name="headline"
                  required
                  minLength={3}
                  maxLength={80}
                  defaultValue={creative?.headline || offer.qualification}
                />
              </label>
              <label>
                Scan call to action
                <input
                  name="cta"
                  required
                  minLength={3}
                  maxLength={60}
                  defaultValue={
                    creative?.cta || "Scan. Claim. Something’s free."
                  }
                />
              </label>
              <label>
                Format
                <select
                  name="format"
                  defaultValue={creative?.format || "landscape"}
                >
                  <option value="landscape">Landscape TV · 16:9</option>
                  <option value="countertop">Countertop · 3:4</option>
                </select>
              </label>
              <label>
                Placement instructions
                <textarea
                  name="notes"
                  maxLength={600}
                  rows={3}
                  defaultValue={creative?.notes || ""}
                  placeholder="Use a readable display size. Keep the QR unobstructed."
                />
              </label>
              <p className="fine">
                {creative
                  ? "A replacement creates a new source and QR. Install the new artwork, confirm its handoff, then revoke the earlier QR when appropriate. Earlier claims retain their original context."
                  : "The qualification, free reward and offer version are saved with the creative."}
              </p>
            </OperatorForm>
          )}
        </div>
        {creative?.parent_source_id && (
          <Link
            className="text-link"
            href={`/operator/sources/${creative.parent_source_id}`}
          >
            <ArrowLeft size={15} />
            Previous creative source
          </Link>
        )}
        {children.map((c) => (
          <Link
            className="text-link"
            key={c.id}
            href={`/operator/sources/${c.source_id}`}
          >
            Open replacement creative V{c.version}
            <ArrowRight size={15} />
          </Link>
        ))}
      </section>
    </>
  );
}

async function OfferDetail({
  db,
  data,
  id,
  edit = false,
}: {
  db: DB;
  data: Overview;
  id: string;
  edit?: boolean;
}) {
  const [networkSupply] = await db.query<{ market_id: string }>(
    "select market_id from network_drop_supplies where offer_id=$1",
    [id],
  );
  if (networkSupply)
    redirect(
      `/operator/network/supply?market=${encodeURIComponent(networkSupply.market_id)}`,
    );
  const offer = data.offers.find((o) => o.id === id);
  if (!offer) notFound();
  const meta = await loadOfferMetadata(db, offer.id, offer.current_version),
    quality = qualityReview({
      ...meta,
      qualification: offer.qualification,
      reward: offer.reward,
      terms: offer.terms,
      startsAt: offer.starts_at,
      expiresAt: offer.expires_at,
    });
  const reviews = await db.query<{
    id: string;
    offer_version: number;
    decision: string;
    note: string;
    created_at: string;
  }>(
    "select id,offer_version,decision,note,created_at from offer_reviews where offer_id=$1 order by created_at desc",
    [id],
  );
  const previous = data.offers
    .filter(
      (o) =>
        o.organization_id === offer.organization_id &&
        o.kind === "drop" &&
        o.id !== id,
    )
    .slice(0, 3);
  const [{ eligible }] = await db.query<{ eligible: number }>(
    `select count(*)::int eligible from subscriptions s join relationships r on r.customer_id=s.customer_id and r.organization_id=s.organization_id join customers c on c.id=s.customer_id join senders se on se.organization_id=s.organization_id where s.organization_id=$1 and s.state='subscribed' and r.possession_confirmed_at is not null and not exists(select 1 from suppressions x where x.phone=c.phone and x.sender_id=se.id and x.suppressed)`,
    [offer.organization_id],
  );
  const [sender] = await db.query<{
    approved: boolean;
    service_sid: string | null;
  }>("select approved,service_sid from senders where organization_id=$1", [
    offer.organization_id,
  ]);
  const editable = ["draft", "review"].includes(offer.state);
  if (edit)
    return (
      <>
        <Link className="text-link" href={`/operator/review/${id}`}>
          <ArrowLeft size={15} />
          Back to offer review
        </Link>
        <PageHeading
          eyebrow="OPERATOR OFFER STUDIO"
          title={
            <>
              A clearer offer,
              <br />
              <em>before it goes out.</em>
            </>
          }
          description={`${offer.merchant} · Changes create a new immutable offer version. Save and submit, then review the final schedule.`}
        />
        {editable ? (
          <Builder
            organizationId={offer.organization_id}
            merchant={offer.merchant}
            timezone={offer.timezone}
            offer={offer}
            operator
            metadata={meta}
          />
        ) : (
          <Empty title="This offer has already been published">
            Published terms stay with the customer’s original pass. Create a new
            offer to change the terms.
          </Empty>
        )}
      </>
    );
  return (
    <>
      <Link className="text-link" href="/operator/review">
        <ArrowLeft size={15} />
        Review queue
      </Link>
      <PageHeading
        eyebrow={`${offer.kind === "anchor" ? "ANCHOR" : "WEEKLY DROP"} · OFFER VERSION ${offer.current_version}`}
        title={offer.title}
        description={`${offer.merchant} · ${offer.timezone}`}
        action={
          editable ? (
            <ButtonLink href={`/operator/review/${id}/edit`} quiet>
              Edit offer
            </ButtonLink>
          ) : (
            <ButtonLink
              href={`/operator/offers/new?business=${offer.organization_id}`}
              quiet
            >
              Create next offer
            </ButtonLink>
          )
        }
      />
      <div className="op-source-bar">
        <State state={offer.state} />
        <span>
          {date(offer.starts_at, true)} → {date(offer.expires_at, true)}
        </span>
      </div>
      <div className="op-two-col">
        <section className="panel">
          <PanelTitle
            eyebrow="THE CUSTOMER PROMISE"
            title="One clear reason to visit"
          />
          <OfferLine offer={offer} />
          <p>{offer.terms}</p>
          <dl className="op-detail-list">
            <dt>Acquisition / return goal</dt>
            <dd>{meta.goal.replaceAll("-", " ")}</dd>
            <dt>Availability</dt>
            <dd>
              {offer.limit_mode === "unlimited"
                ? "No quantity limit"
                : `${offer.quantity} · ${offer.limit_mode === "claim" ? "reserved at claim" : "first recorded redemptions"}`}
            </dd>
            <dt>Location</dt>
            <dd>{offer.address}</dd>
          </dl>
          <div className="op-economics">
            <div>
              <span>Customer value</span>
              <strong>
                {meta.customerValue === null
                  ? "Not entered"
                  : `$${meta.customerValue.toFixed(2)}`}
              </strong>
            </div>
            <div>
              <span>Reward cost</span>
              <strong>
                {meta.rewardCost === null
                  ? "Not entered"
                  : `$${meta.rewardCost.toFixed(2)}`}
              </strong>
            </div>
            <div>
              <span>Required purchase</span>
              <strong>
                {meta.requiredPurchase === null
                  ? "Not entered"
                  : `$${meta.requiredPurchase.toFixed(2)}`}
              </strong>
            </div>
          </div>
          <p className="fine">
            Merchant-entered estimates. These are not incremental profit or ROI.
          </p>
          {meta.staffInstructions && (
            <div className="op-staff-note">
              <h3>For the cashier</h3>
              <p>{meta.staffInstructions}</p>
            </div>
          )}
        </section>
        <section className="panel">
          <PanelTitle
            eyebrow="PRACTICAL QUALITY CHECK"
            title="Ready for the room & the counter"
          />
          {quality.map((c) => (
            <div className={`op-quality ${c.tone}`} key={c.key}>
              <span>
                {c.tone === "strong" ? (
                  <Check size={17} />
                ) : (
                  <AlertCircle size={17} />
                )}
              </span>
              <div>
                <strong>{c.label}</strong>
                <p>{c.detail}</p>
              </div>
            </div>
          ))}
          <p className="fine">
            Deterministic checks from the saved offer. Operator judgment
            completes the review.
          </p>
        </section>
      </div>
      {offer.state === "review" && (
        <section className="panel op-approval">
          <div>
            <PanelTitle
              eyebrow="FINAL PRE-FLIGHT"
              title={
                offer.kind === "drop"
                  ? "Approve the offer. Set the moment."
                  : "Approve the acquisition Anchor."
              }
            />
            <div className="op-preflight">
              <p>
                {quality.find((c) => c.key === "free")?.tone === "strong" ? (
                  <Check size={15} />
                ) : (
                  <AlertCircle size={15} />
                )}{" "}
                {quality.find((c) => c.key === "free")?.tone === "strong"
                  ? "Current version names a free reward and saves the terms."
                  : "Name a free reward before approving this version."}
              </p>
              <p>
                <Clock size={15} /> Dates, quiet hours and weekly frequency are
                checked again on approval.
              </p>
              <p>
                <span className={eligible ? "op-dot mint" : "op-dot amber"} />
                {eligible} currently eligible subscribers for this merchant.
              </p>
              <p>
                <span
                  className={
                    sender?.approved && messagingReady()
                      ? "op-dot mint"
                      : "op-dot amber"
                  }
                />
                {localMode()
                  ? "Local test transport; no production delivery."
                  : sender?.approved && messagingReady()
                    ? "Sender and platform configuration ready."
                    : "Production sender / platform gate needs attention."}
              </p>
            </div>
            <div className="op-staff-note">
              <p className="eyebrow">FINAL SMS COPY · SAVED OFFER</p>
              <p>
                {offerSmsPreview(
                  offer.merchant,
                  offer.qualification,
                  offer.reward,
                  offer.kind,
                )}
              </p>
              <p className="fine">
                Each recipient’s private pass link replaces the bracketed link
                when this message is prepared.
              </p>
            </div>
            <ReviewActions offer={offer} />
          </div>
          <div className="op-return-review">
            <h3>Needs another pass?</h3>
            <p>Give the merchant a specific note they can act on.</p>
            <OperatorForm
              action="review-decision"
              extra={{ offerId: offer.id }}
              button="Save review decision"
            >
              <label>
                Decision
                <select name="decision">
                  <option value="returned">Return with changes</option>
                  <option value="rejected">Reject this proposal</option>
                </select>
              </label>
              <label>
                Note to the merchant
                <textarea
                  name="note"
                  required
                  minLength={5}
                  maxLength={1000}
                  rows={3}
                  placeholder="Keep the purchase simple and specify which size is free."
                />
              </label>
            </OperatorForm>
          </div>
        </section>
      )}
      {["live", "scheduled"].includes(offer.state) && (
        <section className="panel">
          <PanelTitle title="Operational controls" />
          <p className="muted">
            Pause stops new claims and pending promotional messages. Existing
            customer passes remain valid.
          </p>
          <ActionButton action="pause" data={{ id: offer.id }} secondary>
            Pause offer & pending sends
          </ActionButton>
        </section>
      )}
      {reviews.length > 0 && (
        <section className="panel">
          <PanelTitle title="Review history" />
          {reviews.map((r) => (
            <div className="op-evidence" key={r.id}>
              <strong>
                {r.decision === "returned"
                  ? "Returned with changes"
                  : r.decision === "rejected"
                    ? "Proposal rejected"
                    : "Approved"}{" "}
                · offer V{r.offer_version}
              </strong>
              <p>{r.note}</p>
              <time>{date(r.created_at, true)}</time>
            </div>
          ))}
        </section>
      )}
      <section className="panel">
        <PanelTitle eyebrow="MERCHANT CONTEXT" title="Other Weekly Drops" />
        <OfferTable offers={previous} />
      </section>
    </>
  );
}

async function Messages({
  db,
  actor,
  data,
  messageId,
}: {
  db: DB;
  actor: Actor;
  data: Overview;
  messageId?: string;
}) {
  const messages = messageId
    ? await operatorMessage(db, actor, messageId)
    : data.messages;
  const callbacks = messageId
    ? await db.query<{
        id: string;
        state: string;
        error_code: string | null;
        created_at: string;
      }>(
        "select id,state,error_code,created_at from message_events where message_id=$1 order by created_at desc",
        [messageId],
      )
    : [];
  return (
    <>
      <PageHeading
        eyebrow="CUSTOMER MESSAGING"
        title={
          <>
            Know what happened.
            <br />
            <em>Help with the next step.</em>
          </>
        }
        description="Delivery status and provider callbacks for requested passes and permissioned Weekly Drops."
        action={
          messageId ? (
            <ButtonLink href="/operator/messages" quiet>
              All messages
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="op-message-legend">
        <p>
          <strong>Accepted</strong>The provider took the message.
        </p>
        <p>
          <strong>Delivered</strong>A carrier reported delivery.
        </p>
        <p>
          <strong>Unknown</strong>Reconcile before retrying.
        </p>
        <p>
          <strong>Development</strong>Saved locally. No SMS sent.
        </p>
      </div>
      <section className="panel">
        <PanelTitle title={messageId ? "Selected message" : "Recent messages"}>
          <Badge>{messages.length} shown · latest 80</Badge>
        </PanelTitle>
        {messages.length ? (
          <div className="op-table-wrap">
            <table className="op-table">
              <thead>
                <tr>
                  <th>Time / reference</th>
                  <th>Merchant / customer</th>
                  <th>Purpose</th>
                  <th>State</th>
                  <th>Next check</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{date(m.created_at, true)}</strong>
                      <Link href={`/operator/messages?message=${m.id}`}>
                        <code>{m.id}</code>
                      </Link>
                    </td>
                    <td>
                      {m.merchant}
                      <span>••• ••• {m.phone_suffix}</span>
                    </td>
                    <td>
                      {m.purpose === "fulfillment"
                        ? "Requested pass"
                        : "Weekly Drop"}
                    </td>
                    <td>
                      <State state={m.state} />
                      {m.error_code && (
                        <span>Provider code {m.error_code}</span>
                      )}
                    </td>
                    <td>
                      {m.suppression_reason ||
                        (["unknown", "uncertain", "submitting"].includes(
                          m.state,
                        )
                          ? "Reconcile provider result before retrying"
                          : m.state === "development"
                            ? "Local transport; no SMS sent"
                            : m.state === "queued"
                              ? "Check sender, quiet hours and consent"
                              : m.state === "delivered"
                                ? "No action needed"
                                : "Open the customer journey")}
                    </td>
                    <td>
                      <Link
                        className="text-link"
                        href={`/operator/customers?business=${m.organization_id}&reference=${m.claim_id}`}
                      >
                        Timeline
                        <ArrowUpRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No messages in this view">
            Messages appear after a customer claims a pass or an approved Drop
            is prepared.
          </Empty>
        )}
      </section>
      {messageId && (
        <section className="panel">
          <PanelTitle title="Provider callback history" />
          {callbacks.length ? (
            <div className="op-timeline">
              {callbacks.map((e) => (
                <article key={e.id}>
                  <span className="op-event-dot neutral" />
                  <div>
                    <time>{date(e.created_at, true)}</time>
                    <h3>{e.state}</h3>
                    <p>
                      {e.error_code
                        ? `Provider code ${e.error_code}`
                        : "Status callback saved."}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">
              No provider callbacks are recorded for this message. Local
              development messages never receive real carrier callbacks.
            </p>
          )}
        </section>
      )}
      <div className="op-explainer panel">
        <ShieldCheck size={22} />
        <p>
          Uncertain submissions are not retried automatically: that could send
          the same text twice. Review the provider record and this customer’s
          consent before taking action. A customer’s STOP cannot be overridden
          here.
        </p>
      </div>
    </>
  );
}

async function Audit({ db }: { db: DB }) {
  const events = await db.query<{
    id: string;
    merchant: string | null;
    actor: string;
    action: string;
    entity_id: string;
    created_at: string;
  }>(
    `select a.id,g.name merchant,a.actor,a.action,a.entity_id,a.created_at from audit_events a left join organizations g on g.id=a.organization_id order by a.created_at desc limit 120`,
  );
  return (
    <>
      <PageHeading
        eyebrow="IMMUTABLE OPERATING HISTORY"
        title={
          <>
            A clear record.
            <br />
            <em>Every handoff matters.</em>
          </>
        }
        description="Who changed the offer, source, placement or business. Customer pass credentials and full phone numbers stay private."
      />
      <section className="panel">
        <PanelTitle title="Recent activity">
          <Badge>Latest 120 events</Badge>
        </PanelTitle>
        {events.length ? (
          <div className="op-table-wrap">
            <table className="op-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Business</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{date(e.created_at, true)}</td>
                    <td>{e.merchant || "Network"}</td>
                    <td>
                      <strong>{e.action.replaceAll(".", " · ")}</strong>
                    </td>
                    <td>{e.actor}</td>
                    <td>
                      <code>{e.entity_id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="The record starts with an action">
            Saved operator decisions and customer actions appear here.
          </Empty>
        )}
      </section>
    </>
  );
}
function Settings({ data }: { data: Overview }) {
  const platform = platformReadiness(),
    settings = platform.checks.map((c) => [c.label, c.ready] as const);
  return (
    <>
      <PageHeading
        eyebrow="PLATFORM READINESS"
        title={
          <>
            A real launch,
            <br />
            <em>with the gates visible.</em>
          </>
        }
        description="Configuration status is read from the running environment. Secrets are never displayed or edited in the browser."
      />
      <div className="op-two-col">
        <section className="panel">
          <PanelTitle title="Production platform" />
          <Badge tone={platform.ready ? "mint" : "amber"}>
            {localMode()
              ? "Local development"
              : platform.ready
                ? "Platform configuration ready"
                : "Production gates incomplete"}
          </Badge>
          <div className="op-settings-list">
            {settings.map(([label, done]) => (
              <div key={label}>
                <span>{label}</span>
                {done ? <Check size={18} /> : <Clock size={18} />}
              </div>
            ))}
          </div>
          <p className="fine">
            The infrastructure owner sets these environment values after
            external provider and legal review. This screen cannot complete
            registration or provide legal approval.
          </p>
        </section>
        <section className="panel">
          <PanelTitle title="Merchant sender setup" />
          {data.businesses
            .filter((b) => b.capabilities.includes("merchant"))
            .map((b) => (
              <Link
                className="op-setup-row"
                href={`/operator/businesses/${b.id}#sender`}
                key={b.id}
              >
                <div>
                  <strong>{b.name}</strong>
                  <p>
                    {b.sender_approved
                      ? "Marked approved by operator"
                      : "Sender setup needs attention"}
                    {b.is_demo ? " · Sample business" : ""}
                  </p>
                </div>
                <ArrowUpRight size={16} />
              </Link>
            ))}
          <div className="op-policy-links">
            <Link href="/terms">
              Terms
              <ArrowUpRight size={15} />
            </Link>
            <Link href="/privacy">
              Privacy
              <ArrowUpRight size={15} />
            </Link>
            <Link href="/sms">
              SMS disclosures & help
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

export default async function OperatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor(true),
    db = await getDb(),
    { section = [] } = await params,
    search = await searchParams;
  if (!section.length) redirect("/operator/pilot");
  const current = section[0] || "",
    detail = section[1],
    data = await operatorOverview(db, actor);
  const query = (name: string) =>
    typeof search[name] === "string" ? (search[name] as string) : "";
  let content: React.ReactNode;
  if (current === "") content = <Today data={data} />;
  else if (current === "businesses")
    content = detail ? (
      <BusinessDetail db={db} data={data} businessId={detail} />
    ) : (
      <Businesses data={data} />
    );
  else if (current === "onboarding") content = <Onboarding data={data} />;
  else if (current === "pilot" && detail)
    content = <BusinessDetail db={db} data={data} businessId={detail} pilot />;
  else if (current === "settings") content = <Settings data={data} />;
  else if (current === "placements" || current === "creatives")
    content = <Placements data={data} creatives={current === "creatives"} />;
  else if (current === "sources" && detail)
    content = <SourcePage db={db} actor={actor} id={detail} />;
  else if (current === "review" && detail)
    content = (
      <OfferDetail
        db={db}
        data={data}
        id={detail}
        edit={section[2] === "edit"}
      />
    );
  else if (current === "review")
    content = (
      <>
        <PageHeading
          eyebrow="OFFER APPROVALS"
          title={
            <>
              A good second
              <br />
              <em>pair of eyes.</em>
            </>
          }
          description="Review the promise, economics and timing. Give merchants a useful decision before a customer sees the offer."
        />
        <section className="panel">
          <PanelTitle title="Waiting for Uptick">
            <Badge tone="amber">
              {data.offers.filter((o) => o.state === "review").length} to review
            </Badge>
          </PanelTitle>
          <OfferTable
            offers={data.offers.filter((o) => o.state === "review")}
          />
        </section>
        <section className="panel">
          <PanelTitle title="Still being shaped" />
          <OfferTable offers={data.offers.filter((o) => o.state === "draft")} />
        </section>
      </>
    );
  else if (current === "offers" && detail === "new") {
    const merchants = data.businesses.filter((b) =>
        b.capabilities.includes("merchant"),
      ),
      business =
        merchants.find((b) => b.id === query("business")) || merchants[0];
    content = (
      <>
        <PageHeading
          eyebrow="OPERATOR OFFER STUDIO"
          title={
            <>
              A reason to visit.
              <br />
              <em>Something free.</em>
            </>
          }
          description="Create an Anchor or Weekly Drop on behalf of a merchant. The customer promise stays consistent from screen to pass to message."
        />
        <form className="op-business-switch" method="get">
          <label>
            Merchant business
            <select name="business" defaultValue={business?.id}>
              {merchants.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary">
            Choose merchant
            <ArrowRight size={15} />
          </button>
        </form>
        {business ? (
          <Builder
            key={business.id}
            organizationId={business.id}
            merchant={business.name}
            timezone={business.timezone}
            operator
          />
        ) : (
          <Empty title="Add a merchant first">
            Create the business and location in onboarding.
          </Empty>
        )}
      </>
    );
  } else if (current === "offers")
    content = (
      <>
        <PageHeading
          eyebrow="ANCHORS & WEEKLY DROPS"
          title={
            <>
              The offer is simple.
              <br />
              <em>The system is connected.</em>
            </>
          }
          description="Every promise has a version, a window and an operating state."
          action={
            <ButtonLink href="/operator/offers/new">Create offer</ButtonLink>
          }
        />
        <section className="panel">
          <OfferTable offers={data.offers} />
        </section>
      </>
    );
  else if (current === "messages")
    content = (
      <Messages
        db={db}
        actor={actor}
        data={data}
        messageId={query("message")}
      />
    );
  else if (current === "customers")
    content = (
      <>
        <PageHeading
          eyebrow="CUSTOMER OPERATIONS"
          title={
            <>
              One relationship.
              <br />
              <em>The whole journey.</em>
            </>
          }
          description="Find a customer inside one merchant relationship, then follow the recorded claim, message, consent and redemption events."
        />
        <CustomerLookup
          businesses={data.businesses.filter((b) =>
            b.capabilities.includes("merchant"),
          )}
          initialOrganization={query("business")}
          initialReference={
            /^(?:[a-f0-9]{24}|UP-[a-f0-9]{6})$/i.test(query("reference"))
              ? query("reference")
              : ""
          }
        />
      </>
    );
  else if (current === "audit") content = <Audit db={db} />;
  else notFound();
  return (
    <Shell
      actor={actor}
      active={
        current === "sources"
          ? "placements"
          : current === "pilot"
            ? "businesses"
            : current
      }
      name="Network operations"
    >
      <div className="operator-product">{content}</div>
    </Shell>
  );
}
