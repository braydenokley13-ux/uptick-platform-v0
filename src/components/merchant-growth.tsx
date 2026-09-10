"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Coffee,
  Gift,
  MapPin,
  Radio,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import type { GrowthSupply, MerchantGrowth } from "@/lib/merchant-growth";
import { Badge, Empty, Metric, PageHeading } from "./ui";

const objectives = [
  ["store_visits", "More store visits"],
  ["morning_traffic", "Busier mornings"],
  ["afternoon_traffic", "Busier afternoons"],
  ["trial", "Trial of a product"],
  ["repeat_visits", "More return visits"],
];
const money = (n: number | null | undefined) =>
  n == null
    ? "Not set"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(Number(n));
const date = (s: string, timezone: string, time = false) =>
  new Date(s).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(time ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: timezone,
  });
const policy = (value: string, approved = false) =>
  value === "staff_tap"
    ? "Cashier presents Uptick Tap"
    : value === "public_tap"
      ? "Public Uptick Tap"
      : approved
        ? "Approved self-confirmation"
        : "Self-confirmation · approval required";
function localValue(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function isoValue(value: string, timezone: string) {
  const nominal = Date.parse(`${value}Z`);
  if (!Number.isFinite(nominal))
    throw Error("Choose a valid start and end time.");
  let epoch = nominal;
  for (let i = 0; i < 3; i++)
    epoch +=
      nominal -
      Date.parse(`${localValue(new Date(epoch).toISOString(), timezone)}Z`);
  if (localValue(new Date(epoch).toISOString(), timezone) !== value)
    throw Error("Choose a time that exists in the store’s time zone.");
  return new Date(epoch).toISOString();
}
async function save(body: object) {
  let response;
  try {
    response = await fetch("/api/merchant-growth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw Error("We couldn’t connect. Check your connection and try again.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("Uptick is temporarily unavailable. Please try again.");
  }
  if (!response.ok)
    throw Error(data.error || "Check the details and try again.");
  return data;
}
const number = (form: FormData, name: string) =>
  form.get(name) === "" || form.get(name) === null
    ? null
    : Number(form.get(name));

function GrowthPlanForm({ data }: { data: MerchantGrowth }) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await save({
        action: "preferences",
        organizationId: data.organization.id,
        objective: form.get("objective"),
        objectiveNote: form.get("objectiveNote"),
        fixedFeeBudget: number(form, "fixedFeeBudget"),
        rewardSpendCap: number(form, "rewardSpendCap"),
        verificationPreference: form.get("verificationPreference"),
      });
      setMessage("Your priorities are saved for Uptick’s review.");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="mg-form" onSubmit={submit}>
      <label>
        Your main objective
        <select name="objective" defaultValue={data.plan.objective}>
          {objectives.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        What would a better week look like?
        <textarea
          name="objectiveNote"
          rows={3}
          maxLength={1000}
          defaultValue={data.plan.objective_note}
          placeholder="For example, more people in the store Thursday morning."
        />
      </label>
      <div className="mg-form-pair">
        <label>
          Fixed Growth fee planning amount
          <input
            type="number"
            name="fixedFeeBudget"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={data.plan.fixed_fee_budget ?? ""}
            placeholder="Not agreed yet"
          />
        </label>
        <label>
          Reward inventory budget per Drop
          <input
            type="number"
            name="rewardSpendCap"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={data.plan.reward_spend_cap ?? ""}
            placeholder="Add your limit"
          />
        </label>
      </div>
      <p className="fine-print">
        Planning amounts only. Saving a plan does not start billing or agree a
        Growth fee. You fund reward inventory; the fixed service fee is
        separate.
      </p>
      <label>
        Preferred way to redeem
        <select
          name="verificationPreference"
          defaultValue={data.plan.verification_preference}
        >
          <option value="staff_tap">
            Cashier checks the offer, then presents Uptick Tap
          </option>
          <option value="public_tap">
            Public Uptick Tap for a no-purchase offer
          </option>
          <option value="self_confirm">
            Request self-confirmation for a low-risk offer
          </option>
        </select>
      </label>
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : "Save my Growth priorities"}
        <ArrowRight size={17} />
      </button>
      {message && (
        <p className="mg-feedback" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function CommitmentForm({
  data,
  selectedOfferId,
}: {
  data: MerchantGrowth;
  selectedOfferId?: string;
}) {
  const router = useRouter(),
    [selected, setSelected] = useState(
      data.drafts.some((offer) => offer.id === selectedOfferId)
        ? selectedOfferId!
        : data.drafts[0]?.id || "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const offer = data.drafts.find((o) => o.id === selected) || data.drafts[0],
    existing = data.supplies.find((s) => s.offer_id === offer?.id);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!offer) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await save({
        action: "supply",
        offerId: offer.id,
        marketId: form.get("marketId"),
        startsAt: isoValue(
          String(form.get("startsAt")),
          data.organization.timezone,
        ),
        expiresAt: isoValue(
          String(form.get("expiresAt")),
          data.organization.timezone,
        ),
        inventoryPolicy: form.get("inventoryPolicy"),
        quantity: number(form, "quantity"),
        reservationMinutes: number(form, "reservationMinutes"),
        verificationPreference: form.get("verificationPreference"),
        staffInstructions: form.get("staffInstructions"),
        fallbackPlan: form.get("fallbackPlan"),
        rewardCost: number(form, "rewardCost"),
        fixedFeeBudget: number(form, "fixedFeeBudget"),
        rewardSpendCap: number(form, "rewardSpendCap"),
        submit:
          (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
            "value",
          ) === "review",
      });
      setNotice(
        "Your commitment is saved. Uptick’s final approval is required before members can receive it.",
      );
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!data.markets.length)
    return (
      <Empty title="We’re connecting your local market.">
        Uptick needs to connect your store to a Market Cell before a network
        Drop can be submitted. You can prepare your offer in Offer Studio now.
      </Empty>
    );
  if (!offer)
    return (
      <Empty title="Start with something worth stopping for.">
        Create a free-perk offer in Offer Studio, then return here to choose the
        quantity, budget and counter instructions.
      </Empty>
    );
  return (
    <>
      <label className="mg-select-offer">
        Choose a saved offer
        <select
          value={offer.id}
          onChange={(e) => {
            setSelected(e.target.value);
            setError("");
            setNotice("");
          }}
        >
          {data.drafts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      </label>
      <form
        className="mg-form"
        onSubmit={submit}
        key={`${offer.id}-${offer.current_version}`}
      >
        <div className="mg-offer-promise">
          <Gift size={24} />
          <div>
            <strong>{offer.reward}</strong>
            <p>{offer.qualification}</p>
            <Link
              href={`/merchant/create?id=${offer.id}`}
              className="text-link"
            >
              Edit the reward and terms <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
        <label>
          Your local market
          <select
            name="marketId"
            defaultValue={existing?.market_id || data.markets[0].id}
          >
            {data.markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mg-form-pair">
          <label>
            Starts · {data.organization.timezone}
            <input
              type="datetime-local"
              name="startsAt"
              required
              defaultValue={localValue(
                offer.starts_at,
                data.organization.timezone,
              )}
            />
          </label>
          <label>
            Ends · store local time
            <input
              type="datetime-local"
              name="expiresAt"
              required
              defaultValue={localValue(
                offer.expires_at,
                data.organization.timezone,
              )}
            />
          </label>
        </div>
        <label>
          How availability works
          <select
            name="inventoryPolicy"
            defaultValue={existing?.inventory_policy || "redemption"}
          >
            <option value="redemption">
              First completed redemptions · no item reserved
            </option>
            <option value="claim">
              Reserve an item when the member claims
            </option>
            <option value="timed">Reserve an item for a short window</option>
            <option value="unlimited">
              No quantity cap · subject to store availability
            </option>
          </select>
        </label>
        <div className="mg-form-pair">
          <label>
            Reward quantity
            <input
              type="number"
              name="quantity"
              min="1"
              max="1000000"
              step="1"
              defaultValue={existing?.quantity || offer.quantity || 50}
            />
          </label>
          <label>
            Timed reservation · minutes
            <input
              type="number"
              name="reservationMinutes"
              min="5"
              max="10080"
              step="1"
              defaultValue={existing?.reservation_minutes || 60}
            />
          </label>
        </div>
        <div className="mg-form-pair">
          <label>
            Estimated cost per free item
            <input
              type="number"
              name="rewardCost"
              min="0"
              max="1000000"
              step="0.01"
              defaultValue={existing?.reward_cost ?? offer.reward_cost ?? ""}
              placeholder="Your cost, not retail price"
            />
          </label>
          <label>
            Reward inventory spend limit
            <input
              type="number"
              name="rewardSpendCap"
              min="0"
              max="1000000"
              step="0.01"
              defaultValue={
                existing?.spend_cap ?? data.plan.reward_spend_cap ?? ""
              }
            />
          </label>
        </div>
        <label>
          Fixed Growth fee planning amount
          <input
            type="number"
            name="fixedFeeBudget"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={
              existing?.growth_fee ?? data.plan.fixed_fee_budget ?? ""
            }
          />
        </label>
        <p className="fine-print">
          Reward cost × quantity must fit your inventory budget. The separate
          Growth fee is a planning amount until agreed with Uptick. None of
          these amounts represent measured revenue or profit.
        </p>
        <label>
          How your team wants to verify
          <select
            name="verificationPreference"
            defaultValue={
              existing?.verification_mode || data.plan.verification_preference
            }
          >
            <option value="staff_tap">
              Cashier checks condition, then presents Uptick Tap
            </option>
            <option value="public_tap">
              Public Uptick Tap for a no-purchase Drop
            </option>
            <option value="self_confirm">
              Request low-risk self-confirmation
            </option>
          </select>
        </label>
        <label>
          Instructions for the cashier
          <textarea
            name="staffInstructions"
            minLength={10}
            maxLength={1500}
            rows={3}
            required
            defaultValue={
              existing?.staff_instructions ||
              offer.staff_instructions ||
              "Check the offer, present Uptick Tap, wait for the green REDEEMED screen, then give one reward."
            }
          />
        </label>
        <label>
          If stock or the Tap is unavailable
          <textarea
            name="fallbackPlan"
            maxLength={1500}
            rows={2}
            defaultValue={existing?.fallback_plan || ""}
            placeholder="Who replenishes stock? What should staff tell the customer?"
          />
        </label>
        <div className="mg-action-row">
          <button
            type="submit"
            className="button secondary"
            value="draft"
            disabled={busy}
          >
            Save draft
          </button>
          <button
            type="submit"
            className="button"
            value="review"
            disabled={busy}
          >
            {busy ? "Saving…" : "Send commitment to Uptick"}
            <ArrowRight size={16} />
          </button>
        </div>
        {notice && (
          <p className="mg-feedback" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </>
  );
}

function SupplyCard({
  supply,
  timezone,
}: {
  supply: GrowthSupply;
  timezone: string;
}) {
  return (
    <article className="mg-supply-card">
      <div className="mg-card-top">
        <p className="eyebrow">
          {supply.market} · {supply.location}
        </p>
        <Badge tone={supply.state === "approved" ? "mint" : "neutral"}>
          {supply.state === "review" ? "With Uptick" : supply.state}
        </Badge>
      </div>
      <div className="mg-supply-reward">
        <span>
          <Coffee size={29} />
        </span>
        <div>
          <h3>{supply.reward}</h3>
          <p>{supply.qualification}</p>
        </div>
      </div>
      <div className="mg-detail-grid">
        <div>
          <span>Offer window</span>
          <strong>
            {date(supply.starts_at, timezone, true)} →{" "}
            {date(supply.expires_at, timezone, true)}
          </strong>
        </div>
        <div>
          <span>Remaining quantity</span>
          <strong>
            {supply.usage.remaining === null
              ? "No set cap"
              : `${supply.usage.remaining} of ${supply.usage.quantity}`}
          </strong>
        </div>
        <div>
          <span>Redemption policy</span>
          <strong>
            {policy(supply.verification_mode, supply.self_confirm_approved)}
          </strong>
        </div>
        <div>
          <span>Recorded response</span>
          <strong>
            {supply.claims} claimed · {supply.redemptions} redeemed
          </strong>
        </div>
      </div>
      <details>
        <summary>Staff commitment & cost plan</summary>
        <p>{supply.staff_instructions}</p>
        <p>Fallback: {supply.fallback_plan || "Not recorded"}</p>
        <p>
          Per-item cost: {money(supply.reward_cost)} · Inventory budget:{" "}
          {money(supply.spend_cap)} · Separate fixed fee planning amount:{" "}
          {money(supply.growth_fee)}
        </p>
        <p className="fine-print">
          This is the saved operating plan. Expenses are estimates; redemptions
          do not establish incremental profit.
        </p>
      </details>
    </article>
  );
}
function Results({ data }: { data: MerchantGrowth }) {
  const m = data.metrics;
  return (
    <>
      <div className="mg-metrics">
        <Metric
          label="Saved Drop claims"
          value={m.claims}
          note="A member saved your Drop."
        />
        <Metric
          label="Recorded redemptions"
          value={m.redemptions}
          note="Completed redemption records."
          accent
        />
        <Metric
          label="Members who redeemed"
          value={m.visitors}
          note="Distinct members with a completed record."
        />
        <Metric
          label="Members with 2+ redemptions"
          value={m.returns}
          note="Repeat records at this merchant."
        />
      </div>
      <section className="mg-panel">
        <p className="eyebrow">HOW THE REDEMPTION WAS RECORDED</p>
        <h2>Evidence you can understand.</h2>
        <div className="mg-evidence">
          <div>
            <Radio size={19} />
            <span>Location QR</span>
            <strong>{m.qr}</strong>
          </div>
          <div>
            <ShieldCheck size={19} />
            <span>Authenticated NFC</span>
            <strong>{m.secure}</strong>
          </div>
          <div>
            <Check size={19} />
            <span>Approved self-confirmation</span>
            <strong>{m.self_reported}</strong>
          </div>
          <div>
            <Users size={19} />
            <span>Operator exception</span>
            <strong>{m.overrides}</strong>
          </div>
        </div>
        <p className="fine-print">
          QR records use of a store credential; it can be copied. Secure NFC
          adds tag authentication and replay protection. Cashier-presented
          access describes the counter policy. Purchases and incremental sales
          are not digitally verified.
        </p>
      </section>
    </>
  );
}
function Network({ data }: { data: MerchantGrowth }) {
  return (
    <>
      <div className="mg-market-grid">
        {data.markets.map((m) => (
          <article className="mg-panel" key={m.id}>
            <p className="eyebrow">YOUR MARKET CELL</p>
            <h2>{m.name}</h2>
            <Badge
              tone={
                m.state === "live" || m.state === "pilot" ? "mint" : "neutral"
              }
            >
              {m.state}
            </Badge>
            <p>{m.boundary_note}</p>
            <div className="mg-network-path">
              <span>
                <Users size={22} />
                {m.partners} acquisition partners
              </span>
              <ArrowRight size={18} />
              <span>
                <Gift size={22} />
                {m.members} permissioned members
              </span>
              <ArrowRight size={18} />
              <span>
                <MapPin size={22} />
                {data.organization.name}
              </span>
            </div>
            <p className="fine-print">
              Your market connects {m.locations} participating locations. Member
              counts are an aggregate of verified, currently permissioned Uptick
              members in this Market Cell; they are not a guaranteed audience
              for a particular Drop.
            </p>
          </article>
        ))}
      </div>
      {!data.markets.length && (
        <Empty title="A local market is taking shape.">
          Uptick will connect your store to a focused Market Cell based on
          nearby customer movement.
        </Empty>
      )}
      <section className="mg-panel">
        <p className="eyebrow">MORE THAN SCREENS</p>
        <h2>Useful places to discover Uptick.</h2>
        {data.channels.length ? (
          <div className="mg-channel-list">
            {data.channels.map((c) => (
              <div key={c.channel}>
                <strong>{c.channel.replaceAll("_", " ")}</strong>
                <span>{c.sources} active acquisition sources</span>
              </div>
            ))}
          </div>
        ) : (
          <p>
            Partner distribution is not yet recorded for your market. Uptick
            will add real acquisition channels as they are ready.
          </p>
        )}
        <p className="fine-print">
          Partners introduce people to Uptick membership. Uptick chooses the
          distribution and eligible audience for each Drop.
        </p>
      </section>
    </>
  );
}

export function MerchantGrowthView({
  data,
  section,
  selectedOfferId,
}: {
  data: MerchantGrowth;
  section: string;
  selectedOfferId?: string;
}) {
  const current = data.supplies.find(
      (s) =>
        s.state === "approved" &&
        (s.usage.remaining === null || s.usage.remaining > 0) &&
        data.markets.some(
          (market) =>
            market.id === s.market_id &&
            ["pilot", "live"].includes(market.state),
        ) &&
        new Date(s.starts_at) <= new Date(data.asOf) &&
        new Date(s.expires_at) > new Date(data.asOf),
    ),
    upcoming = data.supplies
      .filter(
        (s) =>
          !["ended", "paused"].includes(s.state) &&
          new Date(s.expires_at) > new Date(data.asOf) &&
          new Date(s.starts_at) <
            new Date(Date.parse(data.asOf) + 30 * 86400000),
      )
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)),
    next = data.supplies
      .filter(
        (s) =>
          !["ended", "paused"].includes(s.state) &&
          new Date(s.starts_at) > new Date(data.asOf),
      )
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0],
    review = data.supplies.filter((s) => s.state === "review").length;
  const header: Record<string, [string, string, string]> = {
    home: [
      "YOUR MANAGED GROWTH PLAN",
      "Good things. More reasons to stop.",
      `Uptick brings nearby members a useful reason to visit ${data.organization.name}. You choose the offer and operating limits.`,
    ],
    plan: [
      "YOUR GROWTH PLAN",
      "Tell us what a better week looks like.",
      "Choose your objective and guardrails. Uptick plans the audience, distribution and timing around your store.",
    ],
    drops: [
      "YOUR DROP",
      "A good reason to make the stop.",
      "Create the reward, commit the inventory, and prepare the counter. Uptick reviews the plan before members receive it.",
    ],
    audience: [
      "LOCAL DEMAND",
      "Part of something nearby.",
      "Uptick members belong to the local network. These aggregate counts describe your connected market, not a contact list.",
    ],
    network: [
      "YOUR NETWORK",
      "Around the corner. All connected.",
      "A focused Market Cell connects acquisition partners, Uptick members and participating stores.",
    ],
    results: [
      "OBSERVED RESULTS",
      "Know what the program recorded.",
      "Network Drop activity at your stores, with each redemption’s evidence made clear.",
    ],
    calendar: [
      "UPCOMING ACTIVATIONS",
      "Make next week worth the stop.",
      "Your saved windows, quantities and review status. An approved plan is required before a Drop becomes available.",
    ],
    activity: [
      "YOUR GROWTH ACTIVITY",
      "A clear record of progress.",
      "Saved plans, inventory decisions and completed redemptions for your merchant.",
    ],
    loop: [
      "HOW UPTICK GROWTH WORKS",
      "Nearby people. Useful reasons to visit.",
      "Uptick builds permissioned local membership. Your store supplies a worthwhile perk, and the counter records its redemption.",
    ],
  };
  const h = header[section] || header.home;
  const recommendation = !data.markets.length
    ? [
        "Prepare your market connection",
        "Save your objective and reward budget while Uptick connects this store to its local market.",
        "/merchant/plan",
        "Set your priorities",
      ]
    : review
      ? [
          "Keep the counter ready for review",
          "Uptick has your commitment. Check the saved instructions and fallback plan so your team knows exactly what to do.",
          "/merchant/drops",
          "Review your commitment",
        ]
      : !current && !next
        ? [
            "Give next week one useful reason to visit",
            "Start with a free item your store can reliably supply. Set a quantity that fits your reward budget.",
            "/merchant/create",
            "Prepare a Drop",
          ]
        : !data.points.some((point) => point.state === "active") &&
            (current || next)?.verification_mode !== "self_confirm"
          ? [
              "Prepare the redemption counter",
              "Ask Uptick to configure a location Tap point. Save clear staff instructions before the first member arrives.",
              "/merchant/drops",
              "Check the staff plan",
            ]
          : data.metrics.claims > 0 && data.metrics.redemptions === 0
            ? [
                "Check the handoff before changing the offer",
                "Members have saved a Drop, but no completed redemption is recorded yet. Confirm the offer window, stock and staff instructions.",
                "/merchant/drops",
                "Review the counter plan",
              ]
            : [
                "Let the first records guide the next Drop",
                "Review claims and the exact redemption evidence, then keep the next offer within your saved quantity and reward budget.",
                "/merchant/results",
                "Review recorded results",
              ];

  return (
    <div className="merchant-growth">
      <PageHeading
        eyebrow={h[0]}
        title={<>{h[1]}</>}
        description={h[2]}
        action={
          <Link className="button" href="/merchant/create">
            Create a Drop
            <ArrowUpRight size={16} />
          </Link>
        }
      />
      {section === "home" && (
        <>
          <section className="mg-mission">
            <div>
              <p className="eyebrow">WHAT UPTICK IS DOING NOW</p>
              <h2>
                {current
                  ? "Your Drop is ready for local members."
                  : review
                    ? "We’re reviewing your next good stop."
                    : next
                      ? "Your next activation is taking shape."
                      : "Let’s give the neighborhood a reason to visit."}
              </h2>
              <p>
                {current
                  ? `${current.reward}. Available through ${date(current.expires_at, data.organization.timezone)}.`
                  : review
                    ? `${review} ${review === 1 ? "commitment is" : "commitments are"} with Uptick. Your saved terms and budgets remain visible below.`
                    : "Start with one useful free perk. Choose your quantity and dates, then let Uptick handle the local distribution."}
              </p>
              <Link className="text-link" href="/merchant/drops">
                Review your Drop <ArrowRight size={16} />
              </Link>
            </div>
            <div className="mg-mission-art">
              <Coffee size={62} strokeWidth={1} />
              <span>
                MAKE THE
                <br />
                <em>next stop.</em>
              </span>
            </div>
          </section>
          <div className="mg-metrics">
            <Metric
              label="Included in Drop choices"
              value={data.metrics.allocated}
              note="Times your supply was included in saved member choices."
            />
            <Metric
              label="Claimed"
              value={data.metrics.claims}
              note="Members selected your offer."
            />
            <Metric
              label="Redeemed"
              value={data.metrics.redemptions}
              note="Completed redemption records."
              accent
            />
            <Metric
              label="Local market"
              value={data.markets.length}
              note="Connected Market Cells."
            />
          </div>
          <div className="mg-two-col">
            <section className="mg-panel">
              <p className="eyebrow">YOUR PRIORITY</p>
              <h2>
                {objectives.find(([v]) => v === data.plan.objective)?.[1]}
              </h2>
              <p>
                {data.plan.objective_note ||
                  "One clear objective helps Uptick recommend the right perk and operating window."}
              </p>
              <Link className="text-link" href="/merchant/plan">
                Shape your Growth Plan
                <ArrowRight size={16} />
              </Link>
            </section>
            <section className="mg-panel">
              <p className="eyebrow">READY AT THE COUNTER</p>
              <h2>
                {data.points.some((p) => p.state === "active")
                  ? "A simple handoff for your team."
                  : "Prepare the in-store moment."}
              </h2>
              <p>
                {data.points.some((p) => p.state === "active")
                  ? `${data.points.filter((p) => p.state === "active").length} active redemption ${data.points.filter((p) => p.state === "active").length === 1 ? "point" : "points"} recorded. Staff check the offer, present Uptick Tap and wait for the green result.`
                  : "Uptick will set up a permanent Tap point. Your staff instructions should explain the qualifying condition and the reward handoff."}
              </p>
              <Link className="text-link" href="/merchant/drops">
                Review staff commitment
                <ArrowRight size={16} />
              </Link>
            </section>
          </div>
          <section className="mg-panel mg-next-step">
            <div>
              <p className="eyebrow">THE NEXT USEFUL STEP</p>
              <h2>{recommendation[0]}</h2>
              <p>{recommendation[1]}</p>
            </div>
            <Link className="text-link" href={recommendation[2]}>
              {recommendation[3]}
              <ArrowRight size={16} />
            </Link>
          </section>
          {(current || next) && (
            <SupplyCard
              supply={(current || next)!}
              timezone={data.organization.timezone}
            />
          )}
        </>
      )}
      {section === "plan" && (
        <div className="mg-two-col">
          <section className="mg-panel">
            <p className="eyebrow">START WITH YOUR STORE</p>
            <h2>Your priorities.</h2>
            <GrowthPlanForm data={data} />
          </section>
          <section className="mg-panel mg-plan-note">
            <Target size={32} />
            <h2>
              You set the direction.
              <br />
              Uptick handles the distribution.
            </h2>
            <ul>
              <li>You choose the objective, reward, quantity and dates.</li>
              <li>You set reward cost and spend guardrails.</li>
              <li>You choose from approved verification options.</li>
              <li>
                Uptick manages member eligibility, distribution, frequency and
                final review.
              </li>
            </ul>
            <div className="mg-cost-note">
              <p className="eyebrow">THE ECONOMIC MODEL</p>
              <strong>Fixed Growth fee + reward inventory.</strong>
              <p>
                Your reward budget limits planned item cost. Revenue and
                incremental profit remain unmeasured until supported by stronger
                evidence.
              </p>
            </div>
          </section>
        </div>
      )}
      {section === "drops" && (
        <>
          <div className="mg-workflow">
            <span>
              <b>1</b>Make an offer
            </span>
            <ArrowRight size={15} />
            <span>
              <b>2</b>Commit the inventory
            </span>
            <ArrowRight size={15} />
            <span>
              <b>3</b>Uptick reviews
            </span>
            <ArrowRight size={15} />
            <span>
              <b>4</b>Welcome members
            </span>
          </div>
          <div className="mg-two-col">
            <section className="mg-panel">
              <p className="eyebrow">YOUR OPERATING COMMITMENT</p>
              <h2>Clear before it goes live.</h2>
              <CommitmentForm
                key={selectedOfferId || "saved-offer"}
                data={data}
                selectedOfferId={selectedOfferId}
              />
            </section>
            <div>
              {data.supplies.map((s) => (
                <SupplyCard
                  key={s.id}
                  supply={s}
                  timezone={data.organization.timezone}
                />
              ))}
              {!data.supplies.length && (
                <Empty title="Your first network Drop starts here.">
                  Your saved commitments and their review status appear here.
                  Creating a draft never sends a message.
                </Empty>
              )}
            </div>
          </div>
        </>
      )}
      {["audience", "network"].includes(section) && <Network data={data} />}{" "}
      {section === "results" && (
        <>
          <Results data={data} />
          <div className="mg-supply-list">
            {data.supplies.map((s) => (
              <SupplyCard
                key={s.id}
                supply={s}
                timezone={data.organization.timezone}
              />
            ))}
          </div>
        </>
      )}
      {section === "calendar" && (
        <>
          {upcoming.map((s) => (
            <SupplyCard
              key={s.id}
              supply={s}
              timezone={data.organization.timezone}
            />
          ))}
          {!upcoming.length && (
            <Empty title="A new week is an opportunity.">
              Prepare your next Drop in Offer Studio and submit the operating
              commitment for review.
            </Empty>
          )}
        </>
      )}
      {section === "activity" && (
        <section className="mg-panel">
          <ul className="mg-activity">
            {data.activity.map((event) => (
              <li key={event.id}>
                <span>
                  {event.action
                    .replace(/^growth\./, "")
                    .replaceAll(/[._]/g, " ")}
                </span>
                <time>
                  {date(event.created_at, data.organization.timezone, true)}
                </time>
              </li>
            ))}
          </ul>
          {!data.activity.length && (
            <Empty title="Your Growth record starts with the first saved plan.">
              Plans, submitted commitments and redemptions will appear here.
            </Empty>
          )}
        </section>
      )}
      {section === "loop" && (
        <>
          <div className="mg-loop">
            {[
              [
                Users,
                "People join Uptick",
                "Partners and local channels introduce a free membership.",
              ],
              [
                Gift,
                "A relevant Drop",
                "Uptick includes suitable perks in member choices.",
              ],
              [
                MapPin,
                "A reason to visit",
                "The member chooses a destination and saves a private pass.",
              ],
              [
                Radio,
                "A recorded handoff",
                "The pass follows the store’s approved verification policy and records how redemption was completed.",
              ],
            ].map(([Icon, title, copy], i) => {
              const Symbol = Icon as typeof Users;
              return (
                <section className="mg-panel" key={String(title)}>
                  <p className="eyebrow">0{i + 1}</p>
                  <Symbol size={26} />
                  <h2>{String(title)}</h2>
                  <p>{String(copy)}</p>
                </section>
              );
            })}
          </div>
          <Results data={data} />
        </>
      )}
      <footer className="mg-footer">
        <ShieldCheck size={15} />
        <span>
          Managed by Uptick · Updated{" "}
          {date(data.asOf, data.organization.timezone, true)} · Network Drop
          records
        </span>
        <Link href="/merchant/anchor">
          Legacy Anchor details
          <ArrowUpRight size={13} />
        </Link>
      </footer>
    </div>
  );
}
