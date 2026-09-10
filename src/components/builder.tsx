"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Gift,
  Monitor,
  Smartphone,
  MessageSquare,
  ChevronDown,
  ArrowUpRight,
  Info,
} from "lucide-react";
import type { Offer } from "@/lib/domain";
import {
  defaultMetadata,
  offerGoals,
  offerTemplates,
  qualityReview,
  offerSmsPreview,
  type OfferMetadata,
  type OfferTemplate,
} from "@/lib/product";
import "./merchant.css";
function localValue(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function isoValue(value: string, timezone: string) {
  const nominal = Date.parse(`${value}Z`);
  if (!Number.isFinite(nominal))
    throw Error("Choose a valid start and end time.");
  let epoch = nominal;
  for (let i = 0; i < 3; i++) {
    const represented = Date.parse(`${localValue(new Date(epoch), timezone)}Z`);
    epoch += nominal - represented;
  }
  if (localValue(new Date(epoch), timezone) !== value)
    throw Error(
      "This time does not exist in your time zone. Choose another time.",
    );
  return new Date(epoch).toISOString();
}
function money(value: number | null) {
  return value === null
    ? "Add an estimate"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value);
}
export function Builder({
  organizationId,
  merchant,
  offer,
  metadata,
  operator = false,
  timezone = "America/New_York",
}: {
  organizationId: string;
  merchant: string;
  offer?: Offer;
  metadata?: OfferMetadata;
  operator?: boolean;
  timezone?: string;
}) {
  const meta = metadata || defaultMetadata;
  const [goal, setGoal] = useState(meta.goal),
    [selected, setSelected] = useState(
      meta.templateId || (!offer ? "breakfast" : null),
    ),
    [category, setCategory] = useState("Recommended"),
    [library, setLibrary] = useState(false);
  const [title, setTitle] = useState(offer?.title || "The breakfast Drop"),
    [buy, setBuy] = useState(
      offer?.qualification || "Buy a breakfast sandwich",
    ),
    [get, setGet] = useState(offer?.reward || "Get a free large coffee"),
    [terms, setTerms] = useState(
      offer?.terms ||
        "One per customer. Same-visit qualifying purchase required. Show your receipt and pass to the cashier.",
    );
  const [initialStart] = useState(() => {
    const day = new Date(Date.now() + 7 * 86400000);
    return `${localValue(day, timezone).slice(0, 10)}T09:00`;
  });
  const [start, setStart] = useState(
      offer ? localValue(new Date(offer.starts_at), timezone) : initialStart,
    ),
    [end, setEnd] = useState(
      offer
        ? localValue(new Date(offer.expires_at), timezone)
        : `${initialStart.slice(0, 10)}T17:00`,
    );
  const [limit, setLimit] = useState(offer?.limit_mode || "unlimited"),
    [quantity, setQuantity] = useState(offer?.quantity || 50),
    [kind, setKind] = useState(offer?.kind || "drop");
  const [customerValue, setCustomerValue] = useState<number | null>(
      meta.customerValue,
    ),
    [rewardCost, setRewardCost] = useState<number | null>(meta.rewardCost),
    [requiredPurchase, setRequiredPurchase] = useState<number | null>(
      meta.requiredPurchase,
    ),
    [staffInstructions, setStaffInstructions] = useState(
      meta.staffInstructions,
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  const dates = useMemo(() => {
    try {
      return {
        startsAt: isoValue(start, timezone),
        expiresAt: isoValue(end, timezone),
      };
    } catch {
      return { startsAt: "", expiresAt: "" };
    }
  }, [start, end, timezone]);
  const checks = qualityReview({
    qualification: buy,
    reward: get,
    terms,
    ...dates,
    customerValue,
    rewardCost,
    requiredPurchase,
    staffInstructions,
  });
  const recommended = offerTemplates.filter((t) => t.goals.includes(goal));
  const visible = library
    ? category === "Recommended"
      ? recommended
      : category === "All templates"
        ? offerTemplates
        : offerTemplates.filter((t) => t.category === category)
    : recommended.slice(0, 3);
  const currentTemplate = offerTemplates.find((t) => t.id === selected);
  function selectTemplate(t: OfferTemplate) {
    setSelected(t.id);
    setTitle(t.name);
    setBuy(t.qualification);
    setGet(t.reward);
    if (operator) setKind(t.bestAs === "anchor" ? "anchor" : "drop");
    if (t.limit) {
      setLimit(t.id === "supplies" ? "redemption" : "claim");
      setQuantity(t.limit);
    } else setLimit("unlimited");
  }
  async function save(submit: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: offer?.id,
          organizationId,
          title,
          qualification: buy,
          reward: get,
          terms,
          startsAt: isoValue(start, timezone),
          expiresAt: isoValue(end, timezone),
          limitMode: limit,
          quantity: limit === "unlimited" ? null : quantity,
          submit,
          kind,
          productMetadata: {
            goal,
            templateId: selected,
            customerValue,
            rewardCost,
            requiredPurchase,
            staffInstructions,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Your draft could not be saved.");
      router.push(result.redirect);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="offer-studio">
      <div className="studio-intro">
        <span>
          <Monitor size={16} /> Screen
        </span>
        <ArrowRight size={14} />
        <span>
          <Smartphone size={16} /> Private pass
        </span>
        <ArrowRight size={14} />
        <span>
          <MessageSquare size={16} /> Weekly Drop
        </span>
        <p>One offer. Every customer touchpoint.</p>
      </div>
      <section className="studio-step">
        <div className="studio-step-heading">
          <span className="step-count">01</span>
          <div>
            <h2>What should this offer do?</h2>
            <p>A useful goal makes the next choices simpler.</p>
          </div>
        </div>
        <div className="goal-options">
          {offerGoals.map((g) => (
            <button
              type="button"
              key={g.id}
              onClick={() => {
                setGoal(g.id);
                setCategory("Recommended");
              }}
              className={goal === g.id ? "selected" : ""}
              aria-pressed={goal === g.id}
            >
              {g.label}
              {goal === g.id && <Check size={14} />}
            </button>
          ))}
        </div>
        <p className="goal-hint">
          {offerGoals.find((g) => g.id === goal)?.hint}
        </p>
      </section>
      <section className="studio-step">
        <div className="studio-step-heading">
          <span className="step-count">02</span>
          <div>
            <h2>Start with a good structure.</h2>
            <p>Recommended for your goal. Change every detail below.</p>
          </div>
          <button
            type="button"
            className="text-link library-toggle"
            onClick={() => setLibrary(!library)}
          >
            {library
              ? "Show recommended"
              : `Browse all ${offerTemplates.length} templates`}
            <ChevronDown size={16} />
          </button>
        </div>
        {library && (
          <div className="template-filters" aria-label="Template categories">
            {[
              "Recommended",
              "All templates",
              "Acquisition",
              "Morning traffic",
              "Slow hours",
              "Return",
              "Limited",
            ].map((c) => (
              <button
                type="button"
                key={c}
                aria-pressed={category === c}
                className={category === c ? "selected" : ""}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <div className="studio-template-grid">
          {visible.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`studio-template ${selected === t.id ? "selected" : ""}`}
              onClick={() => selectTemplate(t)}
              aria-pressed={selected === t.id}
            >
              <span className="eyebrow">
                {t.category}
                <span>
                  {t.bestAs === "both"
                    ? "Anchor / Drop"
                    : t.bestAs === "anchor"
                      ? "Anchor"
                      : "Weekly Drop"}
                </span>
              </span>
              <strong>{t.name}</strong>
              <p>{t.goodFor}</p>
              <span className="template-example">
                {t.qualification}
                <br />
                <b>{t.reward}</b>
              </span>
              <small>
                {selected === t.id ? (
                  <>
                    <Check size={13} /> Selected structure
                  </>
                ) : (
                  <>
                    Use this structure <ArrowUpRight size={13} />
                  </>
                )}
              </small>
            </button>
          ))}
        </div>
        {currentTemplate && (
          <div className="template-explainer">
            <Info size={17} />
            <p>
              <strong>{currentTemplate.how}</strong> You change:{" "}
              {currentTemplate.fields.toLowerCase()}.
              {!operator && currentTemplate.bestAs === "anchor"
                ? " This Anchor structure will be adapted to your Weekly Drop."
                : ""}
            </p>
          </div>
        )}
      </section>
      <section className="studio-step">
        <div className="studio-step-heading">
          <span className="step-count">03</span>
          <div>
            <h2>Make it yours. See it take shape.</h2>
            <p>
              The screen, pass, and text below use these same offer details.
            </p>
          </div>
        </div>
        <div className="studio-workspace">
          <div className="studio-edit-stack">
            <section className="panel studio-fields">
              <div className="stack-form">
                {operator && (
                  <label>
                    Offer type
                    <select
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as "anchor" | "drop")
                      }
                    >
                      <option value="drop">Weekly Drop</option>
                      <option value="anchor">Acquisition Anchor</option>
                    </select>
                  </label>
                )}
                <label>
                  Give it a name
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    placeholder="The breakfast Drop"
                  />
                </label>
                <label>
                  <span className="field-number">A</span> What should they do to
                  earn it?
                  <input
                    value={buy}
                    onChange={(e) => setBuy(e.target.value)}
                    maxLength={160}
                    placeholder="Buy a breakfast sandwich"
                  />
                  <small>One purchase, spend, or clearly defined visit.</small>
                </label>
                <label>
                  <span className="field-number amber">B</span> What can you
                  give them free?
                  <input
                    value={get}
                    onChange={(e) => setGet(e.target.value)}
                    maxLength={160}
                    placeholder="Get a free large coffee"
                  />
                  <small>
                    Choose a reward people want that you can comfortably honor.
                  </small>
                </label>
                <div className="field-pair">
                  <label>
                    Offer starts
                    <input
                      type="datetime-local"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </label>
                  <label>
                    Offer ends
                    <input
                      type="datetime-local"
                      value={end}
                      min={start}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </label>
                </div>
                <p className="fine">
                  <Clock size={13} /> All times are{" "}
                  {timezone.replaceAll("_", " ")}. Uptick confirms the message
                  schedule separately.
                </p>
                <label>
                  Simple customer terms
                  <textarea
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    rows={3}
                    maxLength={1000}
                  />
                </label>
                <label>
                  Staff instructions <span className="muted">· Optional</span>
                  <textarea
                    value={staffInstructions}
                    onChange={(e) => setStaffInstructions(e.target.value)}
                    rows={3}
                    maxLength={1500}
                    placeholder="Check the qualifying receipt. Have the customer redeem while you watch. Give one free large coffee."
                  />
                  <small>For Uptick and the printable staff sheet.</small>
                </label>
                <details className="studio-details">
                  <summary>
                    Availability limit <span className="muted">· Optional</span>
                  </summary>
                  <label>
                    How availability works
                    <select
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                    >
                      <option value="unlimited">No quantity limit</option>
                      <option value="claim">
                        Reserve a reward when claimed
                      </option>
                      <option value="redemption">
                        First N completed redemptions
                      </option>
                    </select>
                  </label>
                  {limit !== "unlimited" && (
                    <label>
                      Number available
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        value={quantity}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                      />
                    </label>
                  )}
                </details>
              </div>
            </section>
            <section className="panel studio-economics">
              <p className="eyebrow">OFFER ECONOMICS · OPTIONAL</p>
              <h3>A little extra. A clear cost.</h3>
              <p>
                Enter your own estimates to make the tradeoff easier to see.
              </p>
              <div className="economics-inputs">
                {[
                  {
                    label: "Reward retail value",
                    value: customerValue,
                    set: setCustomerValue,
                  },
                  {
                    label: "Your estimated reward cost",
                    value: rewardCost,
                    set: setRewardCost,
                  },
                  {
                    label: "Required purchase",
                    value: requiredPurchase,
                    set: setRequiredPurchase,
                  },
                ].map((f) => (
                  <label key={f.label}>
                    {f.label}
                    <div className="money-input">
                      <span>$</span>
                      <input
                        type="number"
                        min={0}
                        max={1000000}
                        step="0.01"
                        value={f.value ?? ""}
                        onChange={(e) =>
                          f.set(
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                          )
                        }
                        placeholder="0.00"
                      />
                    </div>
                  </label>
                ))}
              </div>
              <div className="economics-summary">
                <span>
                  Customer value<strong>{money(customerValue)}</strong>
                </span>
                <span>
                  Reward cost<strong>{money(rewardCost)}</strong>
                </span>
                <span>
                  Required purchase<strong>{money(requiredPurchase)}</strong>
                </span>
              </div>
              <p className="fine">
                Merchant-entered estimates. These do not calculate profit,
                incremental sales, or ROI.
              </p>
            </section>
          </div>
          <aside className="studio-previews">
            <p className="eyebrow">
              <span className="status-dot" /> PREVIEWS · UPDATES AS YOU TYPE
            </p>
            <div className="screen-preview">
              <span className="preview-surface">
                <Monitor size={14} /> NEARBY SCREEN · LANDSCAPE
              </span>
              <div className="screen-preview-content">
                <p className="eyebrow">{merchant}</p>
                <h3>
                  {buy || "The qualifying purchase"}
                  <br />
                  <em>{get || "The free extra"}.</em>
                </h3>
                <div className="screen-bottom">
                  <span>
                    Something good.
                    <br />
                    Around the corner.
                  </span>
                  <div className="qr-placeholder">
                    QR assigned
                    <br />
                    by Uptick
                  </div>
                </div>
              </div>
            </div>
            <div className="phone-preview">
              <span className="preview-surface">
                <Smartphone size={14} /> PRIVATE CUSTOMER PASS
              </span>
              <div className="phone-preview-content">
                <div className="phone-speaker" />
                <span className="preview-label">
                  <Gift size={13} />{" "}
                  {kind === "drop" ? "YOUR WEEKLY DROP" : "YOUR NEARBY OFFER"}
                </span>
                <p className="eyebrow">{merchant}</p>
                <h3>{get || "The free reward"}.</h3>
                <p className="pass-qualification">
                  {buy || "With their qualifying purchase"}.
                </p>
                <div className="pass-preview-steps">
                  <span>01 · Make the qualifying purchase</span>
                  <span>02 · Show your receipt + pass</span>
                  <span>03 · Redeem with the cashier</span>
                </div>
                <div className="preview-pass-label">Redeem with cashier</div>
                <small>
                  {start.slice(0, 10)} → {end.slice(0, 10)}
                  <br />
                  {terms}
                </small>
              </div>
            </div>
            <div className="sms-preview">
              <span className="preview-surface">
                <MessageSquare size={14} /> FINAL SMS COPY
              </span>
              <p>{offerSmsPreview(merchant, buy, get, kind)}</p>
              <small>
                Your actual private pass URL replaces the bracketed link. No
                message is sent when you save or submit.
              </small>
            </div>
          </aside>
        </div>
      </section>
      <section className="panel studio-review">
        <div className="studio-step-heading">
          <span className="step-count">04</span>
          <div>
            <h2>A quick quality check.</h2>
            <p>
              Simple rules to make your offer easier to understand. Uptick
              reviews it next.
            </p>
          </div>
          <span className="badge neutral">
            {checks.filter((c) => c.tone === "watch").length} to consider
          </span>
        </div>
        <div className="quality-grid">
          {checks.map((c) => (
            <div className={`quality-check ${c.tone}`} key={c.key}>
              {c.tone === "strong" ? (
                <CheckCircle2 size={17} />
              ) : (
                <Info size={17} />
              )}
              <div>
                <span className="eyebrow">
                  {c.tone === "strong" ? "STRONG" : "WATCH"}
                </span>
                <strong>{c.label}</strong>
                <p>{c.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="studio-submit">
        <div>
          <strong>Your idea. Uptick’s second pair of eyes.</strong>
          <p>
            We review the offer, timing, and audience before anything goes out.
          </p>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => save(false)}
          >
            {busy ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => save(true)}
          >
            Submit to Uptick
            <ArrowRight size={17} />
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
