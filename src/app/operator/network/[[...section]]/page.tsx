import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Check,
  Info,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/config";
import { operatorDriveEstimate } from "@/lib/location-intelligence";
import {
  networkOperations,
  membershipMessagingOperations,
  type MembershipMessagingOperations,
  type NetworkOperations,
  type MarketRow,
  type PartnerRow,
  type SupplyRow,
  type SourceRow,
} from "@/lib/network-operations";
import { Shell } from "@/components/shell";
import { memberMessageText } from "@/lib/member-messaging";
import { Badge, ButtonLink, Empty, Metric, PageHeading } from "@/components/ui";
import {
  LocalCoordinateMap,
  NetworkForm,
  NetworkMemberLookup,
  type GeographicNode,
} from "@/components/network-operations";
import "@/components/network-operations.css";
export const dynamic = "force-dynamic";
const tabs = [
  ["", "Today"],
  ["markets", "Markets"],
  ["supply", "Drop supply"],
  ["acquisition", "Acquisition"],
  ["members", "Members & cohorts"],
  ["allocation", "Allocation"],
  ["messaging", "Member messaging"],
  ["map", "Local map"],
] as const;
const money = (value: number | null) =>
  value === null
    ? "Not recorded"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(Number(value));
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const date = (value: string, timezone = "America/New_York") =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  });
const href = (section: string, marketId: string) =>
  `/operator/network/${section}?market=${encodeURIComponent(marketId)}`;
function State({ state }: { state: string }) {
  return (
    <Badge
      tone={
        ["active", "live", "approved", "pilot"].includes(state)
          ? "mint"
          : ["review", "building", "paused"].includes(state)
            ? "amber"
            : "neutral"
      }
    >
      {state.replaceAll("_", " ")}
    </Badge>
  );
}
function Evidence({ children }: { children: React.ReactNode }) {
  return (
    <p className="network-evidence">
      <Info size={16} />
      {children}
    </p>
  );
}
function MarketSelect({
  data,
  section,
}: {
  data: NetworkOperations;
  section: string;
}) {
  return (
    <div className="network-market-switch" aria-label="Choose Market Cell">
      {data.markets.map((market) => (
        <Link
          key={market.id}
          href={href(section, market.id)}
          className={market.id === data.market?.id ? "active" : ""}
        >
          {market.name}
        </Link>
      ))}
    </div>
  );
}
function Coordinates({
  latitude,
  longitude,
}: {
  latitude?: number | null;
  longitude?: number | null;
}) {
  return (
    <div className="form-grid">
      <label>
        Latitude
        <input
          name="latitude"
          type="number"
          min="-90"
          max="90"
          step="0.000001"
          defaultValue={latitude ?? ""}
          placeholder="Optional recorded coordinate"
        />
      </label>
      <label>
        Longitude
        <input
          name="longitude"
          type="number"
          min="-180"
          max="180"
          step="0.000001"
          defaultValue={longitude ?? ""}
          placeholder="Optional recorded coordinate"
        />
      </label>
    </div>
  );
}
function MarketForm({ market }: { market?: MarketRow }) {
  return (
    <NetworkForm
      action="market-save"
      extra={{ id: market?.id }}
      button={market ? "Save Market Cell" : "Create Market Cell"}
    >
      <label>
        Market name
        <input
          name="name"
          required
          minLength={3}
          maxLength={120}
          defaultValue={market?.name}
          placeholder="Main Street corridor"
        />
      </label>
      <div className="form-grid">
        <label>
          Short name for links
          <input
            name="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
            defaultValue={market?.slug}
            placeholder="main-street"
          />
        </label>
        <label>
          Operating state
          <select name="state" defaultValue={market?.state || "draft"}>
            {["draft", "building", "pilot", "live", "paused"].map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Time zone
        <input
          name="timezone"
          required
          defaultValue={market?.timezone || "America/New_York"}
        />
        <small>
          Dates and the weekly promise follow this market’s local time.
        </small>
      </label>
      <label>
        Home / work ZIPs served
        <input
          name="zips"
          required
          defaultValue={market?.zips.join(", ")}
          placeholder="10583, 10530"
        />
        <small>
          ZIP matching is a first relevance rule. This list does not imply a
          measured drive time or a precise trade-area boundary.
        </small>
      </label>
      <label>
        Why this area works as one market
        <textarea
          name="boundaryNote"
          required
          minLength={10}
          maxLength={1500}
          defaultValue={market?.boundary_note}
          placeholder="Describe nearby destinations, commuter movement, physical barriers and the local operating boundary."
        />
      </label>
      <Coordinates
        latitude={market?.center_latitude}
        longitude={market?.center_longitude}
      />
    </NetworkForm>
  );
}
function WeeklyCoverage({ data }: { data: NetworkOperations }) {
  return (
    <section className="panel">
      <div className="network-panel">
        <p className="eyebrow">THIS WEEK + THE NEXT FOUR</p>
        <h2>Can we keep the promise?</h2>
        <p>
          Covered means already served, holding a valid reservation, or matched
          to remaining supply for that market-local week. Each active,
          permissioned member counts once. Future weeks use today’s membership
          and saved supply; those projections do not reserve inventory across
          weeks.
        </p>
      </div>
      <div className="network-table-wrap">
        <table className="network-table">
          <thead>
            <tr>
              <th>MARKET WEEK</th>
              <th>PERMISSIONED</th>
              <th>MEMBERS COVERED</th>
              <th>REMAINING UNITS</th>
              <th>GAP</th>
            </tr>
          </thead>
          <tbody>
            {data.coverage.map((week, index) => (
              <tr key={week.weekKey}>
                <td>
                  <strong>
                    {index === 0
                      ? "This week"
                      : index === 1
                        ? "Next week"
                        : `In ${index} weeks`}
                  </strong>
                  <small>Week of {week.weekKey}</small>
                </td>
                <td>{number(week.activeMembers)}</td>
                <td>
                  <strong>
                    {number(week.coveredMembers)} / {number(week.activeMembers)}
                  </strong>
                  <small>
                    {week.activeMembers
                      ? `${week.coveragePercent ?? 0}% weekly coverage`
                      : "No active permissioned members"}
                  </small>
                </td>
                <td>
                  {week.capacity === null
                    ? "Ample policy"
                    : number(week.capacity)}
                  <small>
                    {week.supplies} approved{" "}
                    {week.supplies === 1 ? "Drop" : "Drops"}
                  </small>
                </td>
                <td>
                  {week.uncoveredMembers ? (
                    <Badge tone="amber">
                      {week.uncoveredMembers} uncovered
                    </Badge>
                  ) : (
                    <span className="fine">
                      {week.activeMembers
                        ? "No gap in current plan"
                        : "No promise measured yet"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Today({ data }: { data: NetworkOperations }) {
  const market = data.market!,
    current = data.coverage[0],
    next = data.coverage[1];
  const review = data.supplies.filter(
    (supply) => supply.state === "review",
  ).length;
  const destinations = data.locations.filter(
    (location) => location.active,
  ).length;
  const channels = new Set(
    data.sources
      .filter((source) => source.state === "active")
      .map((source) => source.channel),
  ).size;
  const issues = [
    ...(review
      ? [
          {
            title: `${review} ${review === 1 ? "Drop needs" : "Drops need"} a supply decision`,
            detail:
              "Review the saved reward, quantity, dates, staff instructions and verification policy.",
            path: "supply",
          },
        ]
      : []),
    ...(next?.uncoveredMembers
      ? [
          {
            title: `${next.uncoveredMembers} members have no matched option next week`,
            detail:
              "Add geographically useful supply or more inventory before promising the next Drop.",
            path: "supply",
          },
        ]
      : []),
    ...(destinations < 2
      ? [
          {
            title: "One destination is a fragile promise",
            detail:
              "Add a useful fallback location. A supply interruption should not leave the whole market empty.",
            path: "markets",
          },
        ]
      : []),
    ...(channels < 2
      ? [
          {
            title: "Broaden the acquisition mix",
            detail:
              "A second concentrated local channel creates operational redundancy and a useful cohort comparison.",
            path: "acquisition",
          },
        ]
      : []),
    ...(!data.members.permissioned
      ? [
          {
            title: "Verify the first Uptick member",
            detail:
              "Use a membership source link, record the ZIPs and complete the explicit phone-possession and consent steps.",
            path: "acquisition",
          },
        ]
      : []),
  ];
  return (
    <>
      <div className="network-hero">
        <div className="network-hero-copy">
          <p className="eyebrow">ONE LOCAL MARKET. ONE WEEKLY PROMISE.</p>
          <h2>
            Worth joining.
            <br />
            <em>Worth coming back for.</em>
          </h2>
          <p>
            Keep useful free Drops ahead of local member demand. Watch the gaps,
            protect the evidence, and build a market people can rely on.
          </p>
          <ButtonLink href={href("supply", market.id)}>
            Manage this week’s supply
          </ButtonLink>
        </div>
        <div className="network-coverage">
          <p className="eyebrow">THIS WEEK · MEMBER COVERAGE</p>
          <div className="network-coverage-value">
            {current?.activeMembers ? (current.coveragePercent ?? 0) : "—"}
            <span>{current?.activeMembers ? "%" : ""}</span>
          </div>
          <p>
            {current?.activeMembers
              ? `${current.coveredMembers} of ${current.activeMembers} active, permissioned members are already served, reserved, or matched to remaining supply this week.`
              : "Coverage begins when the market has active, permissioned members."}
          </p>
          <div className="network-coverage-bar">
            <i
              style={{
                width: `${Math.min(current?.coveragePercent || 0, 100)}%`,
              }}
            />
          </div>
          <p>
            {current?.capacity === null
              ? "At least one approved Drop uses an ample inventory policy."
              : `${current?.capacity || 0} finite units remain after redemptions and active reservations.`}{" "}
            Covered members are counted once. Coverage does not mean another
            claim is available to someone already served.
          </p>
        </div>
      </div>
      <div className="network-metrics">
        <Metric
          label="UPTICK MEMBERS"
          value={data.members.joined}
          note={`${data.members.permissioned} verified, active and permissioned`}
        />
        <Metric
          label="REDEMPTION DESTINATIONS"
          value={destinations}
          note="Active locations linked to this market"
        />
        <Metric
          label="ACQUISITION CHANNELS"
          value={channels}
          note="Distinct channels with active source links"
        />
        <Metric
          label="RECORDED REDEEMERS"
          value={data.members.redeemed}
          note="Members with a completed network redemption"
        />
      </div>
      <div className="network-grid">
        <section className="panel network-panel">
          <p className="eyebrow">OPERATOR TODAY</p>
          <h2>Keep the next promise ready.</h2>
          {issues.length ? (
            issues.map((issue) => (
              <div className="network-issue" key={issue.title}>
                <AlertCircle size={18} />
                <div>
                  <strong>{issue.title}</strong>
                  <p>{issue.detail}</p>
                  <Link
                    className="text-link"
                    href={href(issue.path, market.id)}
                  >
                    Take the next step <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <div className="network-issue">
              <Check size={20} />
              <div>
                <strong>No basic supply or setup gaps found.</strong>
                <p>
                  Continue watching observed redemptions, member return behavior
                  and actual merchant economics. A green checklist does not
                  establish incrementality.
                </p>
              </div>
            </div>
          )}
        </section>
        <section className="panel network-panel">
          <p className="eyebrow">MARKET READINESS</p>
          <h2>{market.name}</h2>
          <div className="network-status-row">
            <State state={market.state} />
            <p>
              State is set by an operator. The measures below are independent of
              that decision.
            </p>
          </div>
          <p>{market.boundary_note}</p>
          <ol className="network-step-list">
            <li>
              <span>01</span>
              <div>
                <strong>Demand with permission</strong>
                <p>
                  {data.members.permissioned} verified, active members with
                  current Uptick consent. {data.members.active28} members
                  claimed or redeemed in the past 28 days.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Useful supply and a fallback</strong>
                <p>
                  {current?.supplies || 0} approved Drops this week.{" "}
                  {destinations} active destinations. Confirm actual reward
                  availability and staff readiness.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Evidence of coming back</strong>
                <p>
                  {data.members.returned} members have two recorded network
                  redemptions at the same merchant. Revenue and incremental
                  profit remain unavailable.
                </p>
              </div>
            </li>
          </ol>
          <Link className="text-link" href={href("markets", market.id)}>
            Edit market setup <ArrowUpRight size={14} />
          </Link>
        </section>
      </div>
      <WeeklyCoverage data={data} />
      <Evidence>
        All numbers come from saved member, consent, supply, allocation and
        redemption records. Internal test-ledger activity is excluded. A claim
        is not a physical visit; a redemption is not proof of a purchase.
      </Evidence>
    </>
  );
}
function Markets({ data }: { data: NetworkOperations }) {
  const market = data.market!;
  const connected = data.locations.filter(
    (location) => location.active !== null,
  );
  return (
    <>
      <div className="network-grid equal">
        <section className="panel network-panel">
          <p className="eyebrow">MARKET SETUP</p>
          <h2>{market.name}</h2>
          <MarketForm market={market} />
        </section>
        <section className="panel network-panel">
          <p className="eyebrow">REDEMPTION DESTINATIONS</p>
          <h2>Connect a merchant location.</h2>
          <p>
            Start with one to three gas station and convenience-store
            destinations. Keep actual location coordinates and a manual
            relevance estimate separate.
          </p>
          <NetworkForm
            action="market-location-save"
            extra={{ marketId: market.id }}
            button="Connect location"
          >
            <label>
              Merchant location
              <select name="locationId" required>
                {data.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.merchant} · {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Location ZIP
              <input
                name="postalCode"
                required
                pattern="[0-9]{5}"
                maxLength={5}
                placeholder="Five-digit ZIP"
              />
            </label>
            <label>
              Typical local drive, estimated minutes
              <input
                name="driveMinutes"
                type="number"
                min={1}
                max={180}
                step={1}
                placeholder="Optional manual estimate"
              />
              <small>
                This is an operator estimate for the trade area, not a live
                route calculation.
              </small>
            </label>
            <Coordinates />
            <label className="network-check">
              <input name="active" type="checkbox" defaultChecked />
              Active destination in this market
            </label>
          </NetworkForm>
          <Evidence>
            Set up the actual merchant first in{" "}
            <Link href="/operator/onboarding">Launch a merchant</Link>. The
            market link does not change its authenticated business access.
          </Evidence>
        </section>
      </div>
      <section className="panel">
        <div className="network-panel">
          <p className="eyebrow">CURRENT DESTINATIONS</p>
          <h2>Location relevance, explicitly recorded.</h2>
        </div>
        {connected.length ? (
          connected.map((location) => (
            <div className="network-panel" key={location.id}>
              <div className="network-status-row">
                <strong>
                  {location.merchant} · {location.name}
                </strong>
                <State state={location.active ? "active" : "paused"} />
              </div>
              <p>{location.address}</p>
              <details>
                <summary className="text-link">Edit market relevance</summary>
                <div style={{ marginTop: 20 }}>
                  <NetworkForm
                    action="market-location-save"
                    extra={{ marketId: market.id, locationId: location.id }}
                    button="Save location relevance"
                  >
                    <div className="form-grid">
                      <label>
                        Location ZIP
                        <input
                          name="postalCode"
                          required
                          pattern="[0-9]{5}"
                          defaultValue={location.postal_code || ""}
                        />
                      </label>
                      <label>
                        Estimated local drive, minutes
                        <input
                          name="driveMinutes"
                          type="number"
                          min={1}
                          max={180}
                          step={1}
                          defaultValue={location.drive_minutes ?? ""}
                        />
                      </label>
                    </div>
                    <Coordinates
                      latitude={location.latitude}
                      longitude={location.longitude}
                    />
                    <label className="network-check">
                      <input
                        name="active"
                        type="checkbox"
                        defaultChecked={!!location.active}
                      />
                      Active destination
                    </label>
                  </NetworkForm>
                </div>
              </details>
            </div>
          ))
        ) : (
          <Empty title="No destinations connected yet.">
            Connect a location above to make its saved Drops available as market
            supply.
          </Empty>
        )}
      </section>
      <details className="panel network-panel" style={{ marginTop: 24 }}>
        <summary>Create another Market Cell</summary>
        <div style={{ marginTop: 24 }}>
          <MarketForm />
        </div>
      </details>
    </>
  );
}
function PartnerForm({
  marketId,
  partner,
}: {
  marketId: string;
  partner?: PartnerRow;
}) {
  return (
    <NetworkForm
      action="partner-save"
      extra={{ marketId, id: partner?.id }}
      button={partner ? "Save acquisition partner" : "Add acquisition partner"}
    >
      <label>
        Partner name
        <input
          name="name"
          required
          minLength={2}
          maxLength={150}
          defaultValue={partner?.name}
          placeholder="River House Residents"
        />
      </label>
      <div className="form-grid">
        <label>
          Partner type
          <select name="kind" defaultValue={partner?.kind || "apartment"}>
            {[
              "apartment",
              "employer",
              "office",
              "gym",
              "car-wash",
              "auto-service",
              "parking",
              "organization",
              "newsletter",
              "creator",
              "community",
              "other",
            ].map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="state" defaultValue={partner?.state || "active"}>
            <option>active</option>
            <option>paused</option>
          </select>
        </label>
      </div>
      <label>
        Address
        <input
          name="address"
          maxLength={300}
          defaultValue={partner?.address}
          placeholder="Optional partner address"
        />
      </label>
      <Coordinates
        latitude={partner?.latitude}
        longitude={partner?.longitude}
      />
      <label>
        Agreement and capabilities
        <textarea
          name="agreementNote"
          maxLength={1500}
          defaultValue={partner?.agreement_note}
          placeholder="Record the agreed resident / employee benefit, distribution channels and any reciprocal arrangement."
        />
      </label>
    </NetworkForm>
  );
}
function SourceForm({
  data,
  source,
}: {
  data: NetworkOperations;
  source?: SourceRow;
}) {
  return (
    <NetworkForm
      action="source-save"
      extra={{
        marketId: data.market!.id,
        id: source?.id,
        ...(source
          ? {
              partnerId: source.partner_id || "",
              channel: source.channel,
              campaign: source.campaign,
            }
          : {}),
      }}
      button={source ? "Save acquisition source" : "Create membership source"}
    >
      <label>
        Source name
        <input
          name="name"
          required
          minLength={2}
          maxLength={150}
          defaultValue={source?.name}
          placeholder="River House · September resident email"
        />
      </label>
      {!source && (
        <label>
          Acquisition partner
          <select name="partnerId" defaultValue="">
            <option value="">Direct Uptick acquisition</option>
            {data.partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="form-grid">
        <label>
          Channel
          <select
            name="channel"
            defaultValue={source?.channel || "partner-email"}
            disabled={!!source}
          >
            {source &&
              ![
                "partner-email",
                "physical-qr",
                "screen",
                "newsletter",
                "community-event",
                "referral",
                "direct-mail",
                "paid-digital",
                "organic-digital",
                "other",
              ].includes(source.channel) && (
                <option value={source.channel}>{source.channel}</option>
              )}
            {[
              "partner-email",
              "physical-qr",
              "screen",
              "newsletter",
              "community-event",
              "referral",
              "direct-mail",
              "paid-digital",
              "organic-digital",
              "other",
            ].map((channel) => (
              <option key={channel}>{channel}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="state" defaultValue={source?.state || "active"}>
            <option>active</option>
            <option>paused</option>
          </select>
        </label>
      </div>
      <label>
        Campaign
        <input
          name="campaign"
          required
          minLength={2}
          maxLength={180}
          defaultValue={source?.campaign}
          readOnly={!!source}
          placeholder="Founding members · Fall pilot"
        />
      </label>
      <label>
        Recorded acquisition cost, $
        <input
          name="cost"
          type="number"
          min={0}
          step="0.01"
          defaultValue={source?.cost ?? ""}
          placeholder="Leave blank if unknown"
        />
        <small>
          Use total actual cost attributed to this source. Unknown is different
          from zero.
        </small>
      </label>
    </NetworkForm>
  );
}
function Acquisition({ data }: { data: NetworkOperations }) {
  return (
    <>
      <div className="network-grid equal">
        <section className="panel network-panel">
          <p className="eyebrow">A FIRST-CLASS NETWORK PARTNER</p>
          <h2>Meet people where they already are.</h2>
          <p>
            Give a concentrated local audience a worthwhile membership benefit.
            Preserve the source so future quality can be measured.
          </p>
          <PartnerForm marketId={data.market!.id} />
        </section>
        <section className="panel network-panel">
          <p className="eyebrow">A JOIN LINK WITH A JOB</p>
          <h2>Create a membership source.</h2>
          <p>
            Each source has a durable public link and QR. It welcomes members to
            Uptick, with the partner and market recorded separately.
          </p>
          <SourceForm data={data} />
        </section>
      </div>
      <section className="panel">
        <div className="network-panel">
          <p className="eyebrow">MEMBERSHIP DISTRIBUTION</p>
          <h2>Sources, links and observed adoption.</h2>
        </div>
        {data.sources.length ? (
          data.sources.map((source) => (
            <section className="network-panel" key={source.id}>
              <div className="network-status-row">
                <strong>{source.name}</strong>
                <State state={source.state} />
              </div>
              <p>
                {source.partner || "Direct Uptick"} · {source.channel} ·{" "}
                {source.campaign}
              </p>
              <div className="network-acquisition-link">
                <code>
                  {appUrl()}/join/{source.token}
                </code>
                <Link className="text-link" href={`/join/${source.token}`}>
                  Open join page <ArrowUpRight size={14} />
                </Link>
                <a
                  className="text-link"
                  href={`/api/network-ops/source/${source.id}`}
                >
                  Download QR <ArrowUpRight size={14} />
                </a>
              </div>
              <Evidence>
                {source.loads} source loads · {source.joins} joins ·{" "}
                {source.verified} phone verifications · {source.redeemed}{" "}
                recorded redeemers. Source loads may include link previews and
                repeat requests.
              </Evidence>
              <details>
                <summary className="text-link">
                  Edit source and recorded cost
                </summary>
                <div style={{ marginTop: 20 }}>
                  <SourceForm data={data} source={source} />
                </div>
              </details>
            </section>
          ))
        ) : (
          <Empty title="Your first member starts with a source.">
            Create a membership source above, then open its join page or export
            its QR.
          </Empty>
        )}
      </section>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="network-panel">
          <p className="eyebrow">AGGREGATE PARTNER ADOPTION</p>
          <h2>The partnership, without a resident list.</h2>
        </div>
        {data.partners.length ? (
          data.partners.map((partner) => (
            <section className="network-panel" key={partner.id}>
              <div className="network-status-row">
                <strong>{partner.name}</strong>
                <State state={partner.state} />
              </div>
              <p>
                {partner.joins} members joined · {partner.claimed} claimed ·{" "}
                {partner.redeemed} completed a recorded redemption.
              </p>
              <details>
                <summary className="text-link">
                  Partner details and agreement
                </summary>
                <div style={{ marginTop: 20 }}>
                  <PartnerForm marketId={data.market!.id} partner={partner} />
                </div>
              </details>
            </section>
          ))
        ) : (
          <Empty title="No acquisition partners yet.">
            Add the first local apartment, employer or other concentrated
            audience above.
          </Empty>
        )}
      </section>
    </>
  );
}
function SupplyForm({
  data,
  supply,
}: {
  data: NetworkOperations;
  supply?: SupplyRow;
}) {
  return (
    <NetworkForm
      action="supply-save"
      extra={{
        marketId: data.market!.id,
        id: supply?.id,
        ...(supply ? { offerId: supply.offer_id } : {}),
      }}
      button={supply ? "Save supply policy" : "Add Drop supply"}
    >
      {!supply && (
        <label>
          Saved Drop
          <select name="offerId" required defaultValue="">
            <option value="" disabled>
              Choose a saved free reward
            </option>
            {data.offers
              .filter(
                (offer) =>
                  !data.supplies.some(
                    (existing) => existing.offer_id === offer.id,
                  ),
              )
              .map((offer) => (
                <option value={offer.id} key={offer.id}>
                  {offer.merchant} · {offer.title} · V{offer.current_version}
                </option>
              ))}
          </select>
          <small>
            The saved version controls the reward, terms and dates. Create or
            edit the offer in Offer Studio first.
          </small>
        </label>
      )}
      <div className="form-grid">
        <label>
          Inventory policy
          <select
            name="inventoryPolicy"
            defaultValue={supply?.inventory_policy || "redemption"}
          >
            <option value="redemption">First N redemptions</option>
            <option value="claim">Reserve on claim</option>
            <option value="timed">Timed reservation</option>
            <option value="unlimited">Operationally ample</option>
          </select>
        </label>
        <label>
          Available units
          <input
            name="quantity"
            type="number"
            min={1}
            max={1000000}
            step={1}
            defaultValue={supply?.quantity ?? ""}
            placeholder="Required for capped inventory"
          />
        </label>
      </div>
      <label>
        Reservation window, minutes
        <input
          name="reservationMinutes"
          type="number"
          min={5}
          max={10080}
          step={1}
          defaultValue={supply?.reservation_minutes ?? ""}
          placeholder="Only needed for timed reservations"
        />
      </label>
      <label>
        Station verification
        <select
          name="verificationMode"
          defaultValue={supply?.verification_mode || "staff_tap"}
        >
          <option value="staff_tap">Staff-controlled Uptick Tap</option>
          <option value="public_tap">Public Uptick Tap + staff fallback</option>
          <option value="self_confirm">Customer self-confirmation</option>
        </select>
      </label>
      <label className="network-check">
        <input
          name="selfConfirmApproved"
          type="checkbox"
          defaultChecked={supply?.self_confirm_approved}
        />
        Explicit operator approval for self-confirmation. Evidence must remain
        labeled as self-reported.
      </label>
      <label>
        Staff instructions
        <textarea
          name="staffInstructions"
          required
          minLength={10}
          maxLength={2000}
          defaultValue={supply?.staff_instructions}
          placeholder="What the cashier checks, which item to hand over, and when to complete the pass."
        />
      </label>
      <label>
        Fallback if the public point is unavailable
        <textarea
          name="fallbackPlan"
          maxLength={1500}
          defaultValue={supply?.fallback_plan}
          placeholder="Required for a public redemption point. State the staff-controlled alternative."
        />
      </label>
      <div className="form-grid">
        <label>
          Fixed Growth fee, $
          <input
            name="growthFee"
            type="number"
            min={0}
            step="0.01"
            defaultValue={supply?.growth_fee ?? ""}
            placeholder="Not recorded"
          />
        </label>
        <label>
          Reward spend guardrail, $
          <input
            name="spendCap"
            type="number"
            min={0}
            step="0.01"
            defaultValue={supply?.spend_cap ?? ""}
            placeholder="Not recorded"
          />
        </label>
      </div>
      <label>
        Reward funding
        <select
          name="fundingSource"
          defaultValue={supply?.funding_source || "merchant"}
        >
          <option value="merchant">Merchant-provided reward inventory</option>
          <option value="uptick">Uptick · manually agreed pilot</option>
          <option value="partner">Partner · manually agreed</option>
          <option value="brand">Brand · manually agreed</option>
        </select>
        <small>
          This records the funding agreement; it does not charge, pay or
          reconcile anyone.
        </small>
      </label>
      <div className="form-grid">
        <label className="network-check">
          <input
            name="shareable"
            type="checkbox"
            defaultChecked={supply?.shareable}
          />
          Allow members to share this Drop
        </label>
        <label>
          Referral joins per member
          <input
            name="referralCap"
            type="number"
            min={0}
            max={100}
            step={1}
            defaultValue={supply?.referral_cap ?? 5}
          />
        </label>
      </div>
      <label className="network-check">
        <input
          name="submit"
          type="checkbox"
          defaultChecked={supply?.state === "review"}
        />
        Submit these saved supply rules for operator approval
      </label>
    </NetworkForm>
  );
}
function Supply({ data }: { data: NetworkOperations }) {
  return (
    <>
      <div className="network-grid">
        <div>
          <section className="panel network-panel">
            <p className="eyebrow">THE WEEKLY PROMISE HAS REAL INVENTORY</p>
            <h2>Make a saved Drop available.</h2>
            <p>
              Pin the offer version, choose how inventory works and record what
              the staff should do. Uptick approves the audience-facing supply.
            </p>
            {data.offers.length ? (
              <SupplyForm data={data} />
            ) : (
              <Empty title="Connect a location and save a Drop.">
                Use Market setup to connect a merchant, then create its free
                reward in Offer Studio.
              </Empty>
            )}
            <div style={{ marginTop: 20 }}>
              <ButtonLink href="/operator/offers/new" quiet>
                Open Offer Studio
              </ButtonLink>
            </div>
          </section>
          <Evidence>
            An approved reward spend guardrail requires a saved per-item cost
            and finite inventory. Quantity times that cost cannot exceed the
            guardrail. Actual purchases, billing and margin remain separate.
          </Evidence>
        </div>
        <aside className="panel network-panel">
          <p className="eyebrow">SMALL CHOICES. CLEAR PROMISES.</p>
          <h2>Choose the right supply rule.</h2>
          <ol className="network-step-list">
            <li>
              <span>01</span>
              <div>
                <strong>First N redemptions</strong>
                <p>
                  A claim does not reserve an item. Remaining inventory is
                  checked atomically at redemption.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Reserve on claim</strong>
                <p>
                  Each accepted claim holds one item through the offer window.
                  Good for limited rewards.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Timed reservation</strong>
                <p>
                  A claim holds one item for the configured duration, capped by
                  the offer’s end.
                </p>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <strong>Operationally ample</strong>
                <p>
                  No numeric ceiling is assumed. Confirm actual merchant
                  capacity and fallback arrangements.
                </p>
              </div>
            </li>
          </ol>
          <Link href="/operator/tap" className="text-link">
            Configure Uptick Tap <ArrowUpRight size={15} />
          </Link>
        </aside>
      </div>
      {data.supplies.map((supply) => {
        const usage = data.usage[supply.id];
        return (
          <section
            className="panel network-panel network-supply-card"
            key={supply.id}
          >
            <header>
              <div>
                <h3>{supply.title}</h3>
                <p>
                  {supply.merchant} · Saved offer V{supply.offer_version}
                </p>
              </div>
              <State state={supply.state} />
            </header>
            <p className="network-offer-reward">{supply.reward}</p>
            <p>{supply.qualification}</p>
            <dl className="network-supply-details">
              <div>
                <dt>Window</dt>
                <dd>
                  {date(supply.starts_at, supply.timezone)} →{" "}
                  {date(supply.expires_at, supply.timezone)}
                </dd>
              </div>
              <div>
                <dt>Inventory</dt>
                <dd>
                  {usage.quantity === null
                    ? "Operationally ample"
                    : `${usage.remaining} of ${usage.quantity} units remain`}{" "}
                  · {supply.inventory_policy}
                </dd>
              </div>
              <div>
                <dt>Observed</dt>
                <dd>
                  {usage.claimed} claims · {usage.redeemed} redemptions ·{" "}
                  {usage.reserved} active reservations
                </dd>
              </div>
              <div>
                <dt>Verification</dt>
                <dd>{supply.verification_mode.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Merchant economics</dt>
                <dd>
                  Growth fee {money(supply.growth_fee)} · reward guardrail{" "}
                  {money(supply.spend_cap)}
                </dd>
              </div>
              <div>
                <dt>Sharing</dt>
                <dd>
                  {supply.shareable
                    ? `Allowed · up to ${supply.referral_cap} referral joins per member`
                    : "Drop sharing is off"}
                </dd>
              </div>
            </dl>
            <p>
              <strong>Staff:</strong> {supply.staff_instructions}
            </p>
            {supply.fallback_plan && (
              <p>
                <strong>Fallback:</strong> {supply.fallback_plan}
              </p>
            )}
            <Evidence>
              {supply.verification_mode === "self_confirm"
                ? "Self-confirmation records the member’s statement; it does not verify an in-store interaction."
                : `${supply.staff_tap_count} active staff Tap point${supply.staff_tap_count === 1 ? "" : "s"} · ${supply.public_tap_count} active public Tap point${supply.public_tap_count === 1 ? "" : "s"}. Configuration does not prove that signs are installed or staff are trained.`}
            </Evidence>
            {["draft", "review"].includes(supply.state) &&
              supply.offer_version !== supply.current_offer_version && (
                <p className="error">
                  The merchant revised this offer to V
                  {supply.current_offer_version}. Save the supply policy again
                  to review the current version before approval.
                </p>
              )}
            {supply.state === "review" && (
              <NetworkForm
                action="supply-approve"
                extra={{ supplyId: supply.id }}
                button="Approve saved Drop supply"
              >
                <label className="network-check">
                  <input type="checkbox" required />I reviewed this saved
                  reward, its dates, inventory, staff instructions and
                  verification policy.
                </label>
              </NetworkForm>
            )}
            {["draft", "review"].includes(supply.state) && (
              <details>
                <summary>Edit supply rules</summary>
                <div>
                  <SupplyForm data={data} supply={supply} />
                </div>
              </details>
            )}
            {["approved", "paused"].includes(supply.state) && (
              <details>
                <summary>Inventory adjustment and pause controls</summary>
                <div className="network-grid equal">
                  {supply.inventory_policy !== "unlimited" && (
                    <NetworkForm
                      action="supply-adjust"
                      extra={{ supplyId: supply.id }}
                      button="Record inventory adjustment"
                    >
                      <label>
                        Units added or removed
                        <input
                          name="delta"
                          type="number"
                          step={1}
                          required
                          placeholder="25 or -10"
                        />
                      </label>
                      <label>
                        Reason
                        <textarea
                          name="reason"
                          required
                          minLength={10}
                          maxLength={800}
                          placeholder="Record the actual change and who confirmed it."
                        />
                      </label>
                    </NetworkForm>
                  )}
                  {supply.state === "paused" && (
                    <NetworkForm
                      action="supply-resume"
                      extra={{ supplyId: supply.id }}
                      button="Resume approved supply"
                    >
                      <label>
                        Resume reason
                        <textarea
                          name="reason"
                          required
                          minLength={10}
                          maxLength={800}
                          placeholder="Confirm the merchant is ready to honor the original saved offer and verification policy."
                        />
                      </label>
                    </NetworkForm>
                  )}
                  {supply.state === "approved" && (
                    <NetworkForm
                      action="supply-pause"
                      extra={{ supplyId: supply.id }}
                      button="Pause new allocations and claims"
                      quiet
                    >
                      <label>
                        Pause reason
                        <textarea
                          name="reason"
                          required
                          minLength={10}
                          maxLength={800}
                          placeholder="Existing passes retain their saved terms. Explain why new supply is paused."
                        />
                      </label>
                    </NetworkForm>
                  )}
                </div>
              </details>
            )}
          </section>
        );
      })}
      <WeeklyCoverage data={data} />
    </>
  );
}
function Members({ data }: { data: NetworkOperations }) {
  return (
    <>
      <div className="network-metrics">
        <Metric
          label="JOINED UPTICK"
          value={data.members.joined}
          note="A durable membership record was created"
        />
        <Metric
          label="ACTIVE & PERMISSIONED"
          value={data.members.permissioned}
          note="Verified, active state, latest membership consent accepted"
        />
        <Metric
          label="ACTIVE IN 28 DAYS"
          value={data.members.active28}
          note="Recorded claim or redemption in the past 28 days"
        />
        <Metric
          label="RECORDED RETURNERS"
          value={data.members.returned}
          note="Two network redemptions at the same merchant"
        />
      </div>
      <section className="panel">
        <div className="network-panel">
          <p className="eyebrow">ACQUISITION COHORT QUALITY</p>
          <h2>Which sources create lasting value?</h2>
          <p>
            Join totals are only the beginning. Compare observed adoption and
            mature return windows before changing the acquisition mix.
          </p>
        </div>
        <div className="network-table-wrap">
          <table className="network-table">
            <thead>
              <tr>
                <th>SOURCE</th>
                <th>JOIN / VERIFIED</th>
                <th>ALLOCATED / CLAIMED</th>
                <th>REDEEMED MEMBERS</th>
                <th>2-WEEK RETURN</th>
                <th>4-WEEK RETURN</th>
                <th>ACQUISITION COST</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <strong>{source.name}</strong>
                    <small>
                      {source.partner || "Direct Uptick"} · {source.channel}
                    </small>
                  </td>
                  <td>
                    {source.joins} / {source.verified}
                  </td>
                  <td>
                    {source.allocated} / {source.claimed}
                    <small>Allocated does not mean delivered.</small>
                  </td>
                  <td>{source.redeemed}</td>
                  <td>
                    {source.mature2
                      ? `${source.retained2} / ${source.mature2}`
                      : "Not mature"}
                    <small>Claim or redeem on days 14–20</small>
                  </td>
                  <td>
                    {source.mature4
                      ? `${source.retained4} / ${source.mature4}`
                      : "Not mature"}
                    <small>Claim or redeem on days 28–34</small>
                  </td>
                  <td>
                    {money(source.cost)}
                    <small>
                      {source.cost === null || !source.joins
                        ? "Cost / join unavailable"
                        : `${money(Number(source.cost) / source.joins)} / joined member`}
                    </small>
                    <small>
                      {source.cost === null || !source.redeemed
                        ? "Cost / redeemer unavailable"
                        : `${money(Number(source.cost) / source.redeemed)} / recorded redeemer`}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.sources.length && (
          <Empty title="No source cohorts yet.">
            Create an acquisition source and complete the first membership flow.
          </Empty>
        )}
      </section>
      <Evidence>
        Two-week reporting includes only members joined at least 21 days ago;
        four-week reporting requires 35 days. The numerator records a claim or
        redemption in that exact return window. Young cohorts remain “Not
        mature,” rather than reporting a misleading zero.
      </Evidence>
      <div className="network-definition-grid">
        <div>
          <strong>Observed</strong>
          <p>
            A source loaded, consent was accepted, an offer was claimed, or a
            redemption completed. These records show the action that occurred.
          </p>
        </div>
        <div>
          <strong>Derived</strong>
          <p>
            Coverage, cohort return counts, acquisition cost and repeat merchant
            redemptions are calculated from saved records. Weekly coverage
            includes members already served, reserved, or matched to remaining
            supply; it is not a count of new claims available now.
          </p>
        </div>
        <div>
          <strong>Unavailable</strong>
          <p>
            Incremental visits, purchase confirmation, basket contribution and
            profitable demand require additional purchase or
            controlled-experiment evidence.
          </p>
        </div>
      </div>
      <Evidence>
        <ShieldCheck size={14} />
        This view contains aggregate counts and short internal references. It
        does not provide a phone-number or resident-identity export.
      </Evidence>
    </>
  );
}
function Allocation({ data }: { data: NetworkOperations }) {
  return (
    <>
      <div className="network-grid">
        <section className="panel network-panel">
          <p className="eyebrow">
            ONE FEATURED UPTICK · UP TO TWO ALTERNATIVES
          </p>
          <h2>Prepare useful choices.</h2>
          <p>
            Choose from approved supply using explicit market, ZIP, inventory
            and frequency rules. Each member’s weekly options and their reasons
            are preserved.
          </p>
          <NetworkForm
            action="allocate"
            extra={{ marketId: data.market!.id }}
            button="Prepare current member allocations"
          >
            <label className="network-check">
              <input type="checkbox" required />
              Prepare the current week’s choices for up to 250 active,
              permissioned members. Existing weekly choices stay fixed. This
              does not send messages.
            </label>
          </NetworkForm>
        </section>
        <aside className="panel network-panel">
          <p className="eyebrow">EXPLAINABLE BY DESIGN</p>
          <h2>The reason stays with the choice.</h2>
          <p>
            Allocation is a presentation decision, not a reserved item or a
            delivered message. Inventory is checked again at claim and
            redemption, according to the saved policy.
          </p>
          <p>
            Saved weekly choices are stable. The pass can only use one selected
            Drop from that weekly allocation.
          </p>
          <Link className="text-link" href="/operator/messages">
            Open messaging operations <ArrowUpRight size={14} />
          </Link>
        </aside>
      </div>
      <section className="panel">
        <div className="network-panel">
          <p className="eyebrow">LATEST 40 WEEKLY ASSIGNMENTS</p>
          <h2>Which options were assigned, and why.</h2>
          <p>
            “Received” here means a saved allocation. Delivery and viewing
            require their own observed events.
          </p>
        </div>
        <div className="network-table-wrap">
          <table className="network-table">
            <thead>
              <tr>
                <th>MEMBER / WEEK</th>
                <th>FEATURED + ALTERNATIVES</th>
                <th>WHY ELIGIBLE</th>
                <th>CLAIM</th>
              </tr>
            </thead>
            <tbody>
              {data.allocations.map((allocation) => (
                <tr key={allocation.id}>
                  <td>
                    <strong>Member {allocation.member_ref}</strong>
                    <small>{allocation.week_key}</small>
                  </td>
                  <td>
                    {allocation.titles?.length
                      ? allocation.titles.map((title, index) => (
                          <div key={`${title}-${index}`}>
                            <strong>
                              {index === 0
                                ? "Featured"
                                : `Alternative ${index}`}{" "}
                              · {title}
                            </strong>
                          </div>
                        ))
                      : "No option"}
                  </td>
                  <td>
                    <small>
                      {allocation.reasons
                        ?.map((value) => {
                          const reason = value as Record<string, unknown>;
                          return `${reason.market || "Market relevance recorded"}; ${reason.recentMerchantRedemptions28d ?? 0} recent merchant redemptions; ${reason.driveMinutesEstimate == null ? "drive time unavailable" : `${reason.driveMinutesEstimate} min manual estimate`}; ${reason.remainingAtAllocation == null ? "ample policy" : `${reason.remainingAtAllocation} remaining at assignment`}.`;
                        })
                        .join(" ") || "No matching supply recorded"}
                    </small>
                  </td>
                  <td>
                    {allocation.claimed ? (
                      <Badge tone="mint">Claimed</Badge>
                    ) : (
                      "No claim recorded"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.allocations.length && (
          <Empty title="No weekly allocations yet.">
            Approve current Drop supply, then prepare member allocations above.
          </Empty>
        )}
      </section>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="network-panel">
          <p className="eyebrow">LATEST 40 LOCAL DEMAND EVENTS</p>
          <h2>The first-party record.</h2>
        </div>
        <div className="network-table-wrap">
          <table className="network-table">
            <thead>
              <tr>
                <th>EVENT</th>
                <th>CONTEXT</th>
                <th>EVIDENCE</th>
                <th>WHEN</th>
              </tr>
            </thead>
            <tbody>
              {data.activity.map((event) => (
                <tr key={event.id}>
                  <td>
                    <strong>{event.kind.replaceAll("_", " ")}</strong>
                    <small>
                      {event.member_ref
                        ? `Member ${event.member_ref}`
                        : "No member identity"}
                    </small>
                  </td>
                  <td>{event.title || event.source || "Market interaction"}</td>
                  <td>
                    <Badge>{event.evidence_class}</Badge>
                  </td>
                  <td>{date(event.created_at, data.market!.timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function Map({ data }: { data: NetworkOperations }) {
  const nodes: GeographicNode[] = [
    ...data.locations
      .filter(
        (location) =>
          location.active &&
          location.latitude !== null &&
          location.longitude !== null,
      )
      .map((location) => ({
        id: location.id,
        name: location.merchant,
        kind: "merchant" as const,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        address: location.address,
        detail: `${data.supplies.filter((supply) => supply.location_id === location.id && supply.state === "approved").length} approved Drops. ${operatorDriveEstimate(location.drive_minutes).label}`,
        sample: location.is_demo,
      })),
    ...data.partners
      .filter(
        (partner) =>
          partner.state === "active" &&
          partner.latitude !== null &&
          partner.longitude !== null,
      )
      .map((partner) => ({
        id: partner.id,
        name: partner.name,
        kind: "partner" as const,
        latitude: Number(partner.latitude),
        longitude: Number(partner.longitude),
        address: partner.address,
        detail: `${partner.joins} members joined · ${partner.redeemed} recorded redeemers from this partner's sources.`,
      })),
  ];
  return (
    <>
      <LocalCoordinateMap nodes={nodes} />
      <Evidence>
        The plot uses recorded destination and partner coordinates. Select a
        marker to see its source or supply context, then open the actual
        location in Maps. Member ZIPs are not plotted as home addresses. No
        continuous location, road routing or inferred travel time is collected
        here.
      </Evidence>
      <div className="network-grid equal">
        <section className="panel network-panel">
          <p className="eyebrow">THE OPERATING AREA</p>
          <h2>{data.market!.name}</h2>
          <p>{data.market!.boundary_note}</p>
          <p>Served ZIPs: {data.market!.zips.join(", ") || "None recorded"}</p>
          <Link className="text-link" href={href("markets", data.market!.id)}>
            Edit locations and relevance <ArrowUpRight size={14} />
          </Link>
        </section>
        <section className="panel network-panel">
          <p className="eyebrow">PHYSICAL REDEMPTION</p>
          <h2>Connect the point to the promise.</h2>
          <p>
            Configure real merchant-location QR and Uptick Tap points
            separately. Physical verification evidence stays attached to each
            redemption.
          </p>
          <Link className="text-link" href="/operator/tap">
            Open Uptick Tap controls <ArrowUpRight size={14} />
          </Link>
        </section>
      </div>
    </>
  );
}
function MembershipMessaging({
  data,
}: {
  data: MembershipMessagingOperations;
}) {
  const { readiness } = data;
  const count = (state: string) =>
    data.counts.find((item) => item.state === state)?.count || 0;
  return (
    <>
      <div className="network-status-row">
        <Badge
          tone={
            readiness.simulated ? "amber" : readiness.ready ? "mint" : "neutral"
          }
        >
          {readiness.simulated
            ? "Simulated · no SMS"
            : readiness.ready
              ? "Delivery configured"
              : "Delivery blocked"}
        </Badge>
        <p>
          All Market Cells ·{" "}
          {readiness.environment || "Environment not configured"}. This
          workspace controls Uptick membership messages, separate from merchant
          programs.
        </p>
      </div>
      <div className="network-metrics">
        <Metric
          label="QUEUED"
          value={count("queued")}
          note="Awaiting an eligible dispatch"
        />
        <Metric
          label="DELIVERED"
          value={count("delivered")}
          note="Confirmed by provider callback"
        />
        <Metric
          label="UNKNOWN"
          value={count("unknown")}
          note="No automatic retry"
        />
        <Metric
          label="SUPPRESSED"
          value={count("suppressed")}
          note="Held by a current delivery rule"
        />
      </div>
      <div className="network-grid equal">
        <section className="panel network-panel">
          <p className="eyebrow">01 / THE UPTICK MEMBERSHIP SENDER</p>
          <h2>One clear identity.</h2>
          <p>
            Use Uptick’s dedicated, approved Messaging Service and US sender.
            Saving these values records configuration; it does not register or
            approve a provider campaign.
          </p>
          <NetworkForm
            action="membership-sender-save"
            button="Save membership sender"
          >
            <label>
              Messaging Service SID
              <input
                name="serviceSid"
                required
                pattern="MG[0-9a-fA-F]{32}"
                maxLength={34}
                defaultValue={readiness.sender?.serviceSid || ""}
                placeholder="MG…"
                autoComplete="off"
              />
            </label>
            <label>
              US sender number
              <input
                name="phone"
                required
                type="tel"
                pattern="\+1[0-9]{10}"
                defaultValue={readiness.sender?.phone || ""}
                placeholder="+12125550100"
                autoComplete="off"
              />
            </label>
            <label className="network-check">
              <input
                name="approved"
                type="checkbox"
                defaultChecked={readiness.sender?.approved || false}
              />
              I verified that the provider approved this sender and campaign for
              the Uptick membership program.
            </label>
          </NetworkForm>
          <Evidence>
            Replacing the active sender does not transfer old consents or
            rewrite queued message context. Reconcile outstanding messages and
            carrier opt-outs before a sender migration.
          </Evidence>
        </section>
        <section className="panel network-panel">
          <p className="eyebrow">02 / PREPARE, INSPECT, THEN DISPATCH</p>
          <h2>The week has a delivery record.</h2>
          <p>
            Prepare up to 100 eligible members across active markets. A member
            needs current verified permission and available approved supply. A
            saved weekly message is never duplicated.
          </p>
          <NetworkForm
            action="membership-prepare"
            button="Prepare current-week queue"
          />
          <Evidence>
            {data.preparations.length
              ? data.preparations
                  .map(
                    (item) =>
                      `${item.count} ${item.state.replaceAll("_", " ")}`,
                  )
                  .join(" · ")
              : "No current-week preparation attempts yet."}{" "}
            Members waiting for supply are checked again after a delay.
          </Evidence>
          <NetworkForm
            action="membership-dispatch"
            button={
              readiness.simulated
                ? "Process queue · no SMS"
                : "Dispatch eligible messages"
            }
          >
            <label className="network-check">
              <input name="reviewed" type="checkbox" required />I reviewed the
              message text, active sender, environment and queue below. Process
              up to 20 queued messages across all markets.
            </label>
          </NetworkForm>
          <Evidence>
            Dispatch rechecks permission, suppression, local quiet hours,
            current supply, expiry and environment. Uncertain provider outcomes
            remain unknown. This control never retries them.
          </Evidence>
        </section>
      </div>
      <div className="network-grid equal">
        <section className="panel network-panel">
          <p className="eyebrow">MESSAGE COPY · PRIVATE LINK REDACTED</p>
          <h2>What members receive.</h2>
          <p>
            <strong>Requested access</strong>
            <br />
            {memberMessageText("access", "[secure member link]")}
          </p>
          <p>
            <strong>Weekly Uptick</strong>
            <br />
            {memberMessageText("drop", "[secure member link]")}
          </p>
          <Evidence>
            A secure link identifies its own member and saved weekly choices.
            Private credentials are excluded from this ledger.
          </Evidence>
        </section>
        <section className="panel network-panel">
          <p className="eyebrow">LIVE DELIVERY REQUIREMENTS</p>
          <h2>Every gate, in view.</h2>
          {readiness.checks.map((check) => (
            <div className="network-status-row" key={check.key}>
              <Badge tone={check.ready ? "mint" : "neutral"}>
                {check.ready ? "Configured" : "Missing"}
              </Badge>
              <p>{check.label}</p>
            </div>
          ))}
          <div className="network-status-row">
            <Badge tone={readiness.sender?.approved ? "mint" : "neutral"}>
              {readiness.sender?.approved ? "Attested" : "Missing"}
            </Badge>
            <p>Dedicated membership sender approval</p>
          </div>
          <Evidence>
            Development transport records a simulation and sends nothing.
            Staging with Twilio sends only to allowlisted internal numbers.
            Production also requires its explicit delivery switch.
          </Evidence>
        </section>
      </div>
      <section className="panel">
        <div className="network-panel">
          <p className="eyebrow">LATEST 80 MEMBERSHIP MESSAGES · ALL MARKETS</p>
          <h2>Prepared is different from delivered.</h2>
          <p>
            Provider accepted means Twilio accepted the request. Delivered
            requires a delivery callback. Development means no SMS. Masked
            references support troubleshooting without exposing private access
            links.
          </p>
        </div>
        {data.messages.length ? (
          <div className="network-table-wrap">
            <table className="network-table">
              <thead>
                <tr>
                  <th>MEMBER / MARKET</th>
                  <th>MESSAGE</th>
                  <th>OUTCOME</th>
                  <th>WINDOW</th>
                </tr>
              </thead>
              <tbody>
                {data.messages.map((message) => (
                  <tr key={message.id}>
                    <td>
                      <strong>UL-{message.member_ref}</strong>
                      <small>
                        Phone ending {message.phone_hint} ·{" "}
                        {message.market || "No market yet"}
                      </small>
                    </td>
                    <td>
                      <strong>
                        {message.purpose === "drop"
                          ? "Weekly Uptick"
                          : "Requested access"}
                      </strong>
                      <small>
                        {message.week_key
                          ? `Week of ${message.week_key}`
                          : "One requested access link"}{" "}
                        · {message.environment}
                      </small>
                    </td>
                    <td>
                      <State state={message.state} />
                      <small>
                        {message.suppression_reason ||
                          (message.error_code
                            ? `Provider code: ${message.error_code}`
                            : "")}
                      </small>
                      {message.provider_sid && (
                        <small>Provider reference {message.provider_sid}</small>
                      )}
                    </td>
                    <td>
                      <small>
                        Scheduled {date(message.scheduled_at)}
                        <br />
                        Expires {date(message.expires_at)}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No membership messages yet.">
            An explicit member access request creates its first delivery record.
            Weekly preparation requires current permission and approved supply.
          </Empty>
        )}
      </section>
    </>
  );
}

export default async function NetworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ market?: string }>;
}) {
  const actor = await requireActor(true),
    { section = [] } = await params,
    { market: selectedMarket } = await searchParams;
  const active = section.join("/");
  if (!tabs.some(([key]) => key === active)) notFound();
  const db = await getDb();
  const data = await networkOperations(db, actor, selectedMarket);
  const messaging =
    active === "messaging"
      ? await membershipMessagingOperations(db, actor)
      : null;
  const titles: Record<
    string,
    { eyebrow: string; title: string; description: string }
  > = {
    "": {
      eyebrow: "UPTICK LOCAL · MARKET OPERATIONS",
      title: "Build a market worth coming back to.",
      description:
        "Member demand, reliable Drop supply and the evidence that connects them.",
    },
    markets: {
      eyebrow: "OPERATING GEOGRAPHY",
      title: "Start local. Make it work.",
      description:
        "Define a useful trade area and connect the places that can keep its weekly promise.",
    },
    supply: {
      eyebrow: "UPTICK DROP · INVENTORY & APPROVAL",
      title: "A real perk. A reliable promise.",
      description:
        "Approve the free reward, its available quantity and how it will be verified.",
    },
    acquisition: {
      eyebrow: "THE ACQUISITION NETWORK",
      title: "Good things travel through people.",
      description:
        "Partner channels welcome local members to Uptick, with durable source attribution.",
    },
    members: {
      eyebrow: "MEMBER VALUE · COHORT EVIDENCE",
      title: "Growth that keeps coming back.",
      description:
        "See what members actually do after joining, and give young cohorts time to tell the truth.",
    },
    allocation: {
      eyebrow: "DEMAND ROUTING · EXPLAINABLE CHOICES",
      title: "The right Uptick, with a reason.",
      description:
        "Prepare one featured Drop and up to two curated alternatives from eligible local supply.",
    },
    map: {
      eyebrow: "LOCAL NETWORK · RECORDED GEOGRAPHY",
      title: "Know the ground you're building on.",
      description:
        "Explore the actual locations, partner channels and supply that make this market useful.",
    },
    messaging: {
      eyebrow: "UPTICK MEMBERSHIP · DELIVERY OPERATIONS",
      title: "A useful message. A truthful record.",
      description:
        "Configure the Uptick sender, prepare permissioned weekly messages and inspect each delivery outcome.",
    },
  };
  const title = titles[active];
  return (
    <Shell
      actor={actor}
      active="network"
      name={data.market?.name || "Local demand network"}
    >
      <div className="network-operations">
        <PageHeading
          {...title}
          action={
            <ButtonLink href="/operator/tap" quiet>
              Uptick Tap
            </ButtonLink>
          }
        />
        <nav className="network-tabs" aria-label="Network operations">
          {tabs.map(([key, label]) => (
            <Link
              key={key}
              href={href(key, data.market?.id || "")}
              className={active === key ? "active" : ""}
              aria-current={active === key ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        {active !== "messaging" && (
          <MarketSelect data={data} section={active} />
        )}
        {messaging ? (
          <MembershipMessaging data={messaging} />
        ) : active === "members" && !data.market ? (
          <NetworkMemberLookup />
        ) : !data.market ? (
          <div className="network-grid equal">
            <section className="panel network-panel">
              <p className="eyebrow">01 / THE FIRST MARKET CELL</p>
              <h2>Draw the operating boundary.</h2>
              <p>
                Create a real local market before adding membership sources and
                Drop supply.
              </p>
              <MarketForm />
            </section>
            <section className="panel network-panel">
              <MapPin size={28} />
              <h2>One tight market, built deliberately.</h2>
              <ol className="network-step-list">
                <li>
                  <span>01</span>
                  <div>
                    <strong>Define useful geography</strong>
                    <p>
                      Name the market, served ZIPs and the local movement that
                      makes its destinations relevant.
                    </p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Add supply and acquisition</strong>
                    <p>
                      Connect merchant locations, free Drops and partners with
                      concentrated local audiences.
                    </p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Observe the real loop</strong>
                    <p>
                      Join, verify, allocate, claim and redeem. Use the recorded
                      evidence to improve the next week.
                    </p>
                  </div>
                </li>
              </ol>
            </section>
          </div>
        ) : active === "markets" ? (
          <Markets data={data} />
        ) : active === "supply" ? (
          <Supply data={data} />
        ) : active === "acquisition" ? (
          <Acquisition data={data} />
        ) : active === "members" ? (
          <>
            <Members data={data} />
            <NetworkMemberLookup />
          </>
        ) : active === "allocation" ? (
          <Allocation data={data} />
        ) : active === "map" ? (
          <Map data={data} />
        ) : (
          <Today data={data} />
        )}
      </div>
    </Shell>
  );
}
