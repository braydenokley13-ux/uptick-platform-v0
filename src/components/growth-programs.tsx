"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Gift,
  MapPin,
  ShieldCheck,
  Store,
} from "lucide-react";
import type {
  GrowthProgramWorkspace,
  OperatorGrowthProgramWorkspace,
} from "@/lib/growth-programs";
import { Badge, Empty, Metric, PageHeading } from "./ui";

type Program = GrowthProgramWorkspace["programs"][number];
const objectives = [
  ["introduce_store", "Introduce the store"],
  ["introduce_breakfast", "Introduce breakfast"],
  ["introduce_product", "Introduce a product"],
  ["morning_discovery", "Increase relevant morning discovery"],
  ["quieter_period", "Support a defined quieter period"],
] as const;
const money = (cents: number | null | undefined) =>
  cents == null
    ? "Still being negotiated"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Number(cents) / 100);
const readable = (value: unknown) => String(value || "").replaceAll("_", " ");
const date = (value: unknown) =>
  new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
const value = (form: FormData, name: string) =>
  String(form.get(name) || "").trim();
const integer = (form: FormData, name: string) => Number(form.get(name));

async function save(body: object) {
  let response: Response;
  try {
    response = await fetch("/api/growth-programs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw Error("We couldn’t connect. Check your connection and try again.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw Error(result?.error || "Check the Program details and try again.");
  return result;
}

function Feedback({ notice, error }: { notice: string; error: string }) {
  return (
    <>
      {notice && (
        <p className="gp-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function ProgramForm({
  data,
  existing,
  close,
}: {
  data: GrowthProgramWorkspace;
  existing?: Program;
  close?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [protectedPlacement, setProtectedPlacement] = useState(
    Boolean(existing?.protection),
  );
  const ownFulfillment =
    !existing || existing.fulfiller_organization_id === data.organization.id;
  const selectedLocations = new Set(
    existing?.locations.map((location) => location.id),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const locationIds = data.locations
      .filter((location) => form.get(`location-${location.id}`) === "on")
      .map((location) => location.id);
    const weekPlans = [1, 2, 3, 4]
      .map((index) => ({
        weekKey: value(form, `week${index}Key`),
        plannedPlacements: integer(form, `week${index}Placements`),
      }))
      .filter((week) => week.weekKey && week.plannedPlacements > 0);
    const fee = value(form, "negotiatedFee");
    const placementCategory = value(form, "placementCategory");
    const fulfillerOrganizationId =
      existing?.fulfiller_organization_id || data.organization.id;
    const funderOrganizationId =
      existing?.funder_organization_id || data.organization.id;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await save({
        action: existing ? "amend_program" : "create_program",
        programId: existing?.id,
        buyerOrganizationId: data.organization.id,
        marketId: existing?.market_id || value(form, "marketId"),
        name: value(form, "name"),
        objective: value(form, "objective"),
        objectiveNote: value(form, "objectiveNote"),
        placementCategory,
        startsOn: value(form, "startsOn"),
        endsOn: value(form, "endsOn"),
        funderOrganizationId,
        fulfillerOrganizationId,
        negotiatedFeeCents: fee ? Math.round(Number(fee) * 100) : null,
        commercialStatus: value(form, "commercialStatus"),
        benefitCeiling: integer(form, "benefitCeiling"),
        operatingConstraints: value(form, "operatingConstraints"),
        evaluationPlan: value(form, "evaluationPlan"),
        locationIds,
        weekPlans,
        protection: protectedPlacement
          ? {
              protectedLocationId: value(form, "protectedLocationId"),
              competingCategory: placementCategory,
              radiusMiles: Number(form.get("radiusMiles")),
              startsOn: value(form, "protectionStartsOn"),
              endsOn: value(form, "protectionEndsOn"),
              placementScope: "paid_featured",
              exceptions: value(form, "protectionExceptions")
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
              terminationConditions: value(form, "terminationConditions"),
            }
          : null,
      });
      setNotice(
        existing
          ? "The amendment is saved as a prospective version. The approved version and issued member benefits have not changed."
          : "The Program proposal is saved for Uptick’s capacity and protection review.",
      );
      router.refresh();
      close?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!ownFulfillment)
    return (
      <Empty title="Uptick manages this amendment with the fulfiller.">
        This Program names another organization as the fulfiller. Uptick must
        confirm their locations and obligations before proposing a new version.
      </Empty>
    );
  return (
    <form className="gp-form" onSubmit={submit}>
      <div className="gp-form-grid">
        <label>
          Program name
          <input
            name="name"
            required
            minLength={3}
            maxLength={120}
            defaultValue={existing?.name || ""}
            placeholder="October breakfast introduction"
          />
        </label>
        <label>
          Objective
          <select
            name="objective"
            defaultValue={existing?.objective || "introduce_store"}
          >
            {objectives.map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        What should this Program accomplish?
        <textarea
          name="objectiveNote"
          maxLength={1000}
          rows={2}
          defaultValue={existing?.objective_note || ""}
          placeholder="A short, bounded outcome we can evaluate after four weeks."
        />
      </label>
      <label>
        Paid placement category
        <input
          name="placementCategory"
          required
          minLength={2}
          maxLength={80}
          defaultValue={existing?.placement_category || ""}
          placeholder="For example: convenience store"
        />
        <span className="fine-print">
          Uptick uses this category to honor existing paid placement protection,
          whether or not this Program requests its own protection.
        </span>
      </label>
      <div className="gp-form-grid">
        <label>
          Market Cell
          <select
            name="marketId"
            defaultValue={existing?.market_id || data.markets[0]?.id}
            disabled={Boolean(existing)}
          >
            {data.markets.map((market) => (
              <option value={market.id} key={market.id}>
                {market.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Participating locations</legend>
          <div className="gp-checks">
            {data.locations.map((location) => (
              <label key={location.id}>
                <input
                  type="checkbox"
                  name={`location-${location.id}`}
                  defaultChecked={
                    !existing || selectedLocations.has(location.id)
                  }
                />
                {location.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="gp-form-grid">
        <label>
          Start date
          <input
            type="date"
            name="startsOn"
            required
            defaultValue={String(existing?.starts_on || "").slice(0, 10)}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            name="endsOn"
            required
            defaultValue={String(existing?.ends_on || "").slice(0, 10)}
          />
        </label>
      </div>
      <div className="gp-form-grid">
        <label>
          Negotiated Growth fee
          <input
            type="number"
            name="negotiatedFee"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={
              existing?.negotiated_fee_cents == null
                ? ""
                : Number(existing.negotiated_fee_cents) / 100
            }
            placeholder="Still being negotiated"
          />
        </label>
        <label>
          Commercial status
          <select
            name="commercialStatus"
            defaultValue={existing?.commercial_status || "negotiating"}
          >
            <option value="negotiating">Negotiating</option>
            <option value="agreed">Agreed</option>
            <option value="invoiced">Invoiced</option>
            <option value="paid">Paid</option>
            <option value="credited">Credited</option>
            <option value="waived">Waived by Uptick</option>
          </select>
        </label>
      </div>
      <p className="fine-print">
        The fee is recorded once on the approved Program. It is never copied to
        each weekly benefit. Saving this proposal does not approve capacity or
        start billing.
      </p>
      <label>
        Maximum benefit commitment
        <input
          type="number"
          name="benefitCeiling"
          required
          min="1"
          max="1000000"
          defaultValue={existing?.benefit_ceiling || 200}
        />
      </label>
      <fieldset>
        <legend>Planned weekly featured placements</legend>
        <p className="fine-print">
          Use one row for each week this Program is meant to run. Uptick
          verifies these plans against stored inventory and pilot member
          capacity.
        </p>
        <div className="gp-weeks">
          {[1, 2, 3, 4].map((index) => {
            const week = existing?.week_plans[index - 1];
            return (
              <div key={index}>
                <label>
                  Week {index}
                  <input
                    type="date"
                    name={`week${index}Key`}
                    defaultValue={String(week?.week_key || "").slice(0, 10)}
                  />
                </label>
                <label>
                  Placements
                  <input
                    type="number"
                    name={`week${index}Placements`}
                    min="1"
                    max="200"
                    defaultValue={week?.planned_placements || ""}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>
      <label>
        Operating constraints
        <textarea
          name="operatingConstraints"
          required
          minLength={10}
          maxLength={2000}
          rows={3}
          defaultValue={
            existing?.operating_constraints ||
            "Featured delivery remains subject to confirmed free-benefit inventory, store readiness and member relevance."
          }
        />
      </label>
      <label>
        Evaluation plan
        <textarea
          name="evaluationPlan"
          required
          minLength={10}
          maxLength={2000}
          rows={3}
          defaultValue={
            existing?.evaluation_plan ||
            "Review issued placements, claims and recorded redemptions after the Program. Do not infer purchases or incrementality."
          }
        />
      </label>
      <label className="gp-protection-toggle">
        <input
          type="checkbox"
          checked={protectedPlacement}
          onChange={(event) => setProtectedPlacement(event.target.checked)}
        />
        Request bounded paid featured placement protection
      </label>
      {protectedPlacement && (
        <div className="gp-protection-fields">
          <div className="gp-form-grid">
            <label>
              Protected location
              <select
                name="protectedLocationId"
                defaultValue={String(
                  existing?.protection?.protected_location_id ||
                    data.locations[0]?.id,
                )}
              >
                {data.locations.map((location) => (
                  <option value={location.id} key={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="gp-form-grid three">
            <label>
              Radius in straight-line miles
              <input
                type="number"
                name="radiusMiles"
                min="0.1"
                max="1.5"
                step="0.1"
                required
                defaultValue={String(existing?.protection?.radius_miles || 1)}
              />
            </label>
            <label>
              Protection starts
              <input
                type="date"
                name="protectionStartsOn"
                required
                defaultValue={String(
                  existing?.protection?.starts_on || existing?.starts_on || "",
                ).slice(0, 10)}
              />
            </label>
            <label>
              Protection ends
              <input
                type="date"
                name="protectionEndsOn"
                required
                defaultValue={String(
                  existing?.protection?.ends_on || existing?.ends_on || "",
                ).slice(0, 10)}
              />
            </label>
          </div>
          <label>
            Explicit exceptions
            <input
              name="protectionExceptions"
              defaultValue={
                Array.isArray(existing?.protection?.exceptions)
                  ? existing.protection.exceptions.join(", ")
                  : ""
              }
              placeholder="For example: organization:existing-brand-partner"
            />
          </label>
          <label>
            Termination conditions
            <textarea
              name="terminationConditions"
              required
              minLength={10}
              maxLength={1500}
              rows={2}
              defaultValue={String(
                existing?.protection?.termination_conditions ||
                  "Protection may end for suspended readiness, unavailable inventory or repeated fulfillment failure.",
              )}
            />
          </label>
          <p className="fine-print">
            Protection applies only to conflicting paid featured placements
            within the dates, category, place and approved radius. Organic
            supply, issued benefits and member recovery remain available.
          </p>
        </div>
      )}
      <div className="gp-actions">
        {close && (
          <button type="button" className="button secondary" onClick={close}>
            Cancel
          </button>
        )}
        <button
          className="button"
          disabled={busy || !data.locations.length || !data.markets.length}
        >
          {busy
            ? "Saving…"
            : existing
              ? "Propose amendment"
              : "Send Program for review"}
          <ArrowRight size={16} />
        </button>
      </div>
      <Feedback notice={notice} error={error} />
    </form>
  );
}

function ProgramCard({
  program,
  edit,
}: {
  program: Program;
  edit: () => void;
}) {
  const planned = program.week_plans.reduce(
    (total, week) => total + Number(week.planned_placements),
    0,
  );
  return (
    <article className="gp-card">
      <div className="gp-card-head">
        <div>
          <p className="eyebrow">
            {program.market_name} · VERSION {program.current_version}
          </p>
          <h2>{program.name}</h2>
        </div>
        <Badge
          tone={
            program.status === "approved" || program.status === "active"
              ? "mint"
              : "neutral"
          }
        >
          {readable(program.status)}
        </Badge>
      </div>
      <p>{program.objective_note || readable(program.objective)}</p>
      <div className="gp-facts">
        <div>
          <CalendarDays size={18} />
          <span>Dates</span>
          <strong>
            {date(program.starts_on)} – {date(program.ends_on)}
          </strong>
        </div>
        <div>
          <CircleDollarSign size={18} />
          <span>Negotiated fee</span>
          <strong>{money(program.negotiated_fee_cents)}</strong>
        </div>
        <div>
          <Gift size={18} />
          <span>Planned / ceiling</span>
          <strong>
            {planned} / {program.benefit_ceiling}
          </strong>
        </div>
        <div>
          <Store size={18} />
          <span>Locations</span>
          <strong>
            {program.locations.map((location) => location.name).join(", ")}
          </strong>
        </div>
      </div>
      <div className="gp-role-row">
        <span>Paid category: {program.placement_category}</span>
        <span>Buyer: {program.buyer_organization_id}</span>
        <span>Funder: {program.funder_organization_id}</span>
        <span>Fulfiller: {program.fulfiller_organization_id}</span>
      </div>
      {program.approved_version && program.pending_version && (
        <div className="gp-callout">
          <strong>
            Currently approved obligation: version {program.approved_version}
          </strong>
          {program.approved_obligation && (
            <span>
              {date(program.approved_obligation.starts_on)} –{" "}
              {date(program.approved_obligation.ends_on)} ·{" "}
              {program.approved_obligation.week_plans.reduce(
                (total, week) => total + Number(week.planned_placements),
                0,
              )}{" "}
              planned placements ·{" "}
              {money(program.approved_obligation.negotiated_fee_cents)}
            </span>
          )}
          <span>
            Version {program.pending_version} is prospective. Issued member
            benefits keep their original approved terms.
          </span>
        </div>
      )}
      {program.protection && (
        <p className="gp-protection">
          <ShieldCheck size={17} /> Paid featured protection requested for{" "}
          {String(program.protection.radius_miles)} straight-line miles. Organic
          supply and member recovery remain available.
        </p>
      )}
      <details>
        <summary>Constraints and evaluation</summary>
        <p>
          <strong>Operating constraints:</strong>{" "}
          {program.operating_constraints}
        </p>
        <p>
          <strong>Evaluation:</strong> {program.evaluation_plan}
        </p>
        <p>
          <strong>Commercial status:</strong>{" "}
          {readable(program.commercial_status)} · Credits:{" "}
          {money(program.credit_cents)}
        </p>
      </details>
      {program.viewer_role === "buyer" && program.status !== "terminated" && (
        <button className="text-button" onClick={edit}>
          Propose changes to this Program
        </button>
      )}
    </article>
  );
}

function ProgramSection({ data }: { data: GrowthProgramWorkspace }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <>
      <PageHeading
        eyebrow="PROGRAM"
        title={
          <>
            What are we <em>doing?</em>
          </>
        }
        description="One clear objective, one negotiated commercial agreement, a bounded weekly plan and an honest evaluation."
      />
      <div className="gp-explainer">
        <div>
          <ClipboardCheck size={21} />
          <strong>Plan</strong>
          <span>Objective, dates and locations</span>
        </div>
        <div>
          <Gift size={21} />
          <strong>Fulfill</strong>
          <span>Backed inventory and store readiness</span>
        </div>
        <div>
          <CheckCircle2 size={21} />
          <strong>Review</strong>
          <span>Observed results and a renewal decision</span>
        </div>
      </div>
      {data.programs.map((program) =>
        editing === program.id ? (
          <section className="gp-panel" key={program.id}>
            <p className="eyebrow">PROSPECTIVE AMENDMENT</p>
            <h2>Propose the next version.</h2>
            <ProgramForm
              data={data}
              existing={program}
              close={() => setEditing(null)}
            />
          </section>
        ) : (
          <ProgramCard
            key={program.id}
            program={program}
            edit={() => setEditing(program.id)}
          />
        ),
      )}
      {!data.programs.length && (
        <Empty title="No Growth Program is on file yet.">
          Use the form below to make the commercial plan concrete. Uptick still
          must verify supply, readiness, protection and pilot capacity before
          approval.
        </Empty>
      )}
      <section className="gp-panel">
        <p className="eyebrow">
          {data.programs.length
            ? "PROPOSE ANOTHER PROGRAM"
            : "NEW GROWTH PROGRAM"}
        </p>
        <h2>A simple agreement the store can run.</h2>
        <ProgramForm data={data} />
      </section>
    </>
  );
}

function SupplyForm({ data }: { data: GrowthProgramWorkspace }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const linked = value(form, "program");
    const [programId, version] = linked ? linked.split(":") : [null, null];
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await save({
        action: "submit_supply",
        programId,
        programVersion: version ? Number(version) : null,
        supplierOrganizationId: data.organization.id,
        funderOrganizationId: data.organization.id,
        fulfillerOrganizationId: data.organization.id,
        fallbackPayerOrganizationId: data.organization.id,
        marketId: value(form, "marketId"),
        locationId: value(form, "locationId"),
        exactItem: value(form, "exactItem"),
        itemIdentifier: value(form, "itemIdentifier"),
        usableHours: value(form, "usableHours"),
        startsOn: value(form, "startsOn"),
        endsOn: value(form, "endsOn"),
        quantity: integer(form, "quantity"),
        fallbackSubstitute: value(form, "fallbackSubstitute"),
        fallbackInstructions: value(form, "fallbackInstructions"),
      });
      setNotice(
        linked
          ? "The supply proposal is attached to the Program for Uptick’s operational review."
          : "The organic supply proposal is with Uptick. There is no Growth fee or guaranteed placement.",
      );
      event.currentTarget.reset();
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="gp-form" onSubmit={submit}>
      <label>
        Participation path
        <select name="program" defaultValue="">
          <option value="">Organic benefit supply · no Growth fee</option>
          {data.programs
            .filter(
              (program) =>
                program.fulfiller_organization_id === data.organization.id,
            )
            .map((program) => (
              <option
                value={`${program.id}:${program.current_version}`}
                key={program.id}
              >
                Growth Program · {program.name} · version{" "}
                {program.current_version}
              </option>
            ))}
        </select>
      </label>
      <div className="gp-form-grid">
        <label>
          Market Cell
          <select name="marketId" defaultValue={data.markets[0]?.id}>
            {data.markets.map((market) => (
              <option value={market.id} key={market.id}>
                {market.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fulfilling location
          <select name="locationId" defaultValue={data.locations[0]?.id}>
            {data.locations.map((location) => (
              <option value={location.id} key={location.id}>
                {location.name} · {location.address}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="gp-form-grid">
        <label>
          Exact free item
          <input
            name="exactItem"
            required
            minLength={3}
            maxLength={200}
            placeholder="16 oz hot coffee"
          />
        </label>
        <label>
          SKU or item identifier
          <input name="itemIdentifier" maxLength={100} placeholder="Optional" />
        </label>
      </div>
      <label>
        Usable hours
        <input
          name="usableHours"
          required
          minLength={3}
          maxLength={500}
          placeholder="Monday–Sunday, 6:00 AM–11:00 AM"
        />
      </label>
      <div className="gp-form-grid three">
        <label>
          Starts
          <input type="date" name="startsOn" required />
        </label>
        <label>
          Ends
          <input type="date" name="endsOn" required />
        </label>
        <label>
          Maximum quantity
          <input type="number" name="quantity" min="1" max="1000000" required />
        </label>
      </div>
      <div className="gp-free-promise">
        <Gift size={20} />
        <p>
          <strong>Member price: $0. Required spend: $0.</strong>
          <br />
          This direct proposal is for the core weekly membership benefit, so a
          purchase condition cannot be added.
        </p>
      </div>
      <label>
        Independent fallback item
        <input
          name="fallbackSubstitute"
          required
          minLength={3}
          maxLength={200}
          placeholder="16 oz bottled beverage"
        />
      </label>
      <label>
        Fallback instructions
        <textarea
          name="fallbackInstructions"
          required
          minLength={10}
          maxLength={1500}
          rows={3}
          placeholder="If the primary item is unavailable, give the approved substitute at no charge and follow the same QR flow."
        />
      </label>
      <button
        className="button"
        disabled={busy || !data.locations.length || !data.markets.length}
      >
        {busy ? "Sending…" : "Send supply proposal to Uptick"}
        <ArrowRight size={16} />
      </button>
      <Feedback notice={notice} error={error} />
    </form>
  );
}

function FulfillmentSection({ data }: { data: GrowthProgramWorkspace }) {
  return (
    <>
      <PageHeading
        eyebrow="FULFILLMENT"
        title={
          <>
            What must the store <em>actually do?</em>
          </>
        }
        description="Name the exact free item, usable hours, real quantity, cashier instructions and an independent fallback."
      />
      <section className="gp-panel">
        <p className="eyebrow">DIRECT SUPPLY PROPOSAL</p>
        <h2>No Offer Studio required.</h2>
        <p>
          Submitting gives Uptick a concrete item to review. The number entered
          here is not approved capacity until Uptick confirms inventory,
          readiness, fallback and a staff rehearsal.
        </p>
        <SupplyForm data={data} />
      </section>
      <div className="gp-list">
        {data.proposals.map((proposal) => (
          <article className="gp-card compact" key={String(proposal.id)}>
            <div className="gp-card-head">
              <div>
                <p className="eyebrow">
                  {proposal.program_id
                    ? "PROGRAM SUPPLY PROPOSAL"
                    : "ORGANIC SUPPLY · NO GROWTH FEE"}
                </p>
                <h2>{String(proposal.exact_item)}</h2>
              </div>
              <Badge>{readable(proposal.state)}</Badge>
            </div>
            <p>
              <MapPin size={14} /> {String(proposal.location_name)} ·{" "}
              {String(proposal.usable_hours)}
            </p>
            <div className="gp-facts">
              <div>
                <Gift size={18} />
                <span>Proposed quantity</span>
                <strong>{String(proposal.quantity)}</strong>
              </div>
              <div>
                <CheckCircle2 size={18} />
                <span>Fallback</span>
                <strong>{String(proposal.fallback_substitute)}</strong>
              </div>
              <div>
                <CircleDollarSign size={18} />
                <span>Member / Growth fee</span>
                <strong>$0 / $0</strong>
              </div>
            </div>
            <p className="fine-print">
              Proposal only. Uptick has not counted this merchant-entered
              quantity as available inventory.
            </p>
          </article>
        ))}
      </div>
      {!data.proposals.length && (
        <Empty title="No supply proposal is on file.">
          A merchant can contribute an organic benefit without buying Growth.
          Organic participation can be eligible for allocation, but it does not
          guarantee placement, targeting, schedule control or protection.
        </Empty>
      )}
    </>
  );
}

function ResultsSection({ data }: { data: GrowthProgramWorkspace }) {
  const totals = data.executions.reduce<{
    issued: number;
    claims: number;
    redemptions: number;
  }>(
    (sum, execution) => ({
      issued: sum.issued + Number(execution.issued || 0),
      claims: sum.claims + Number(execution.claims || 0),
      redemptions: sum.redemptions + Number(execution.redemptions || 0),
    }),
    { issued: 0, claims: 0, redemptions: 0 },
  );
  return (
    <>
      <PageHeading
        eyebrow="RESULTS"
        title={
          <>
            What actually <em>happened?</em>
          </>
        }
        description="A small evidence record for Program and organic supply, without member identities or shopping history."
      />
      <div className="gp-metrics">
        <Metric
          label="Backed placements issued"
          value={totals.issued}
          note="Recorded member-week placements."
        />
        <Metric
          label="Benefits claimed"
          value={totals.claims}
          note="Members who saved an issued benefit."
        />
        <Metric
          label="Recorded redemptions"
          value={totals.redemptions}
          note="Completed redemption records."
          accent
        />
      </div>
      <section className="gp-panel">
        <p className="eyebrow">EVIDENCE BOUNDARY</p>
        <h2>Useful results, stated carefully.</h2>
        <p>{data.reportingNote}</p>
      </section>
      <div className="gp-list">
        {data.executions.map((execution) => (
          <article
            className="gp-card compact"
            key={`${String(execution.program_id)}-${String(execution.supply_id)}`}
          >
            <div className="gp-card-head">
              <div>
                <p className="eyebrow">WEEK OF {date(execution.week_key)}</p>
                <h2>{String(execution.exact_item)}</h2>
              </div>
              <Badge tone={execution.state === "approved" ? "mint" : "neutral"}>
                {readable(execution.state)}
              </Badge>
            </div>
            <p>
              {String(execution.fulfiller_name)} ·{" "}
              {String(execution.usable_hours)}
            </p>
            <div className="gp-facts">
              <div>
                <span>Issued</span>
                <strong>{String(execution.issued)}</strong>
              </div>
              <div>
                <span>Claimed</span>
                <strong>{String(execution.claims)}</strong>
              </div>
              <div>
                <span>Redeemed</span>
                <strong>{String(execution.redemptions)}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!data.executions.length && (
        <Empty title="No execution results yet.">
          Results begin only after Uptick links approved, ready supply to an
          approved Program version and issues backed placements.
        </Empty>
      )}
    </>
  );
}

export function GrowthPrograms({
  data,
  section,
}: {
  data: GrowthProgramWorkspace;
  section: "program" | "fulfillment" | "results";
}) {
  return (
    <div className="growth-programs">
      {section === "program" && <ProgramSection data={data} />}
      {section === "fulfillment" && <FulfillmentSection data={data} />}
      {section === "results" && <ResultsSection data={data} />}
    </div>
  );
}

export function GrowthProgramOperatorControls({
  data,
}: {
  data: OperatorGrowthProgramWorkspace;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const workspace = data.workspace;
  if (!workspace) return null;
  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: string,
    body: (form: FormData) => object,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(action);
    setNotice("");
    setError("");
    try {
      await save({ action, ...body(form) });
      setNotice("The Program record was updated and audited.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy("");
    }
  }
  const pending = workspace.programs.filter(
    (program) => program.pending_version !== null,
  );
  const approved = workspace.programs.filter(
    (program) => program.approved_version !== null,
  );
  return (
    <section className="gp-panel gp-operator-controls">
      <p className="eyebrow">OPERATOR REVIEW</p>
      <h2>Connect the commercial promise to real execution.</h2>
      <p>
        These controls accept stored supply and pilot records. Merchant proposal
        quantities never satisfy approval.
      </p>
      <div className="gp-operator-grid">
        <form
          className="gp-form"
          onSubmit={(event) =>
            submit(event, "link_supply", (form) => {
              const [programId, programVersion] = value(form, "program").split(
                ":",
              );
              return {
                programId,
                programVersion: Number(programVersion),
                supplyId: value(form, "supplyId"),
                weekKey: value(form, "weekKey"),
              };
            })
          }
        >
          <h3>1. Link approved supply</h3>
          <label>
            Prospective Program version
            <select name="program">
              {pending.map((program) => (
                <option
                  value={`${program.id}:${program.pending_version}`}
                  key={program.id}
                >
                  {program.name} · version {program.pending_version}
                </option>
              ))}
            </select>
          </label>
          <label>
            Approved pilot supply
            <select name="supplyId">
              {data.supplies.map((supply) => (
                <option value={supply.id} key={supply.id}>
                  {supply.exact_item} · {supply.quantity} units
                </option>
              ))}
            </select>
          </label>
          <label>
            Planned week
            <input type="date" name="weekKey" required />
          </label>
          <button
            className="button secondary"
            disabled={busy !== "" || !pending.length || !data.supplies.length}
          >
            {busy === "link_supply" ? "Linking…" : "Link stored supply"}
          </button>
        </form>
        <form
          className="gp-form"
          onSubmit={(event) =>
            submit(event, "approve_program", (form) => {
              const [programId, programVersion] = value(form, "program").split(
                ":",
              );
              return {
                programId,
                programVersion: Number(programVersion),
                runId: value(form, "runId"),
                note: value(form, "note"),
                attentionExceptionReason:
                  value(form, "attentionExceptionReason") || null,
              };
            })
          }
        >
          <h3>2. Approve after checks</h3>
          <label>
            Prospective Program version
            <select name="program">
              {pending.map((program) => (
                <option
                  value={`${program.id}:${program.pending_version}`}
                  key={program.id}
                >
                  {program.name} · version {program.pending_version}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pilot run
            <select name="runId">
              {data.runs.map((run) => (
                <option value={run.id} key={run.id}>
                  {run.name} · cap {run.hard_cap} · guidance{" "}
                  {Math.round(Number(run.paid_load_guidance) * 100)}%
                </option>
              ))}
            </select>
          </label>
          <label>
            Approval note
            <textarea
              name="note"
              required
              minLength={10}
              rows={2}
              placeholder="What was reviewed and accepted?"
            />
          </label>
          <label>
            Paid-load exception reason
            <textarea
              name="attentionExceptionReason"
              minLength={10}
              rows={2}
              placeholder="Leave blank unless the plan exceeds guidance."
            />
          </label>
          <button
            className="button"
            disabled={busy !== "" || !pending.length || !data.runs.length}
          >
            {busy === "approve_program"
              ? "Approving…"
              : "Approve reviewed Program"}
          </button>
        </form>
        <form
          className="gp-form"
          onSubmit={(event) =>
            submit(event, "record_credit", (form) => ({
              programId: value(form, "programId"),
              amountCents: Math.round(Number(form.get("amount")) * 100),
              reason: value(form, "reason"),
              reference: value(form, "reference"),
            }))
          }
        >
          <h3>Record a service credit</h3>
          <label>
            Approved Program
            <select name="programId">
              {approved.map((program) => (
                <option value={program.id} key={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Credit amount
            <input
              type="number"
              name="amount"
              min="0.01"
              step="0.01"
              required
            />
          </label>
          <label>
            Reason
            <textarea name="reason" required minLength={10} rows={2} />
          </label>
          <label>
            Incident or evidence reference
            <input name="reference" maxLength={300} />
          </label>
          <button
            className="button secondary"
            disabled={busy !== "" || !approved.length}
          >
            {busy === "record_credit" ? "Recording…" : "Record credit"}
          </button>
        </form>
        <form
          className="gp-form"
          onSubmit={(event) =>
            submit(event, "terminate_program", (form) => ({
              programId: value(form, "programId"),
              reason: value(form, "reason"),
            }))
          }
        >
          <h3>Terminate future commercial distribution</h3>
          <label>
            Program
            <select name="programId">
              {workspace.programs
                .filter((program) => program.status !== "terminated")
                .map((program) => (
                  <option value={program.id} key={program.id}>
                    {program.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Reason
            <textarea name="reason" required minLength={10} rows={2} />
          </label>
          <p className="fine-print">
            Termination ends future paid distribution and protection. Already
            issued benefits, organic supply and member recovery remain
            available.
          </p>
          <button
            className="button secondary"
            disabled={busy !== "" || !workspace.programs.length}
          >
            {busy === "terminate_program"
              ? "Terminating…"
              : "Terminate future Program activity"}
          </button>
        </form>
      </div>
      <Feedback notice={notice} error={error} />
    </section>
  );
}
