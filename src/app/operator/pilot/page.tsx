import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  dataKinds,
  economicCategories,
  pilotOperations,
  pilotWeeks,
} from "@/lib/pilot-operations";
import { Shell } from "@/components/shell";
import { Badge, Metric, PageHeading } from "@/components/ui";
import { PilotForm } from "@/components/pilot-form";
import { CommandCentre } from "@/components/command-centre";
import { commandCentre } from "@/lib/command-centre";
import { operatorReadinessRows } from "@/lib/operator-readiness";
import "@/components/network-operations.css";
import "@/components/command-centre.css";
export const dynamic = "force-dynamic";
const label = (value: string) => value.replaceAll("_", " ");
const money = (value: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value),
  );
const stamp = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
export default async function PilotPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; view?: string; week?: string }>;
}) {
  const actor = await requireActor(true),
    db = await getDb(),
    query = await searchParams,
    data = await pilotOperations(db, actor, query.run);
  const { run, detail } = data;
  const view = ["supply", "results", "setup"].includes(query.view || "")
    ? query.view!
    : "overview";
  const viewHref = (next: string) =>
    `/operator/pilot?${new URLSearchParams({ ...(run ? { run: run.id } : {}), view: next })}`;
  const titles: Record<string, [string, string]> = {
    overview: [
      "A clear view of today.",
      "Choose what you need to do. We’ll take you straight there.",
    ],
    supply: [
      "A benefit for every week.",
      "Review your four weeks of backing and update future supply.",
    ],
    results: [
      "See what happened.",
      "Recorded activity for this pilot. Sample results stay clearly labeled.",
    ],
    setup: [
      "Set up your pilot.",
      "Launch checks, people, partners, and finances. Open only what you need.",
    ],
  };
  const [admissionChoices, programChoices, classificationChoices] =
    await Promise.all([
      db.query<{
        id: string;
        phone_hint: string;
        home_zip: string;
        data_kind: string;
      }>(
        "select m.id,right(c.phone,4) phone_hint,m.home_zip,m.data_kind from uptick_members m join customers c on c.id=m.customer_id where m.verified_at is not null and m.state='active' and m.market_id=$1 and m.data_kind=$2 and not exists(select 1 from member_erasure_records e where e.member_id=m.id) order by m.created_at desc limit 500",
        [run?.market_id || null, run?.data_kind || null],
      ),
      db.query<{ id: string; name: string; buyer: string }>(
        "select p.id,v.name,o.name buyer from growth_programs p join growth_program_versions v on v.program_id=p.id and v.version=p.current_version join organizations o on o.id=p.buyer_organization_id where p.market_id=$1 order by v.name",
        [run?.market_id || null],
      ),
      db.query<{ entity: string; id: string; name: string; data_kind: string }>(
        "select 'market_cells' entity,id,name,data_kind from market_cells union all select 'acquisition_partners',id,name,data_kind from acquisition_partners union all select 'acquisition_sources',id,name,data_kind from acquisition_sources order by entity,name",
      ),
    ]);
  // The command centre is the overview. Everything it needs is assembled here so
  // the view itself stays a pure rendering of already-decided facts.
  const centre =
    run && view === "overview"
      ? await commandCentre(db, actor, run, query.week)
      : null;
  const readinessRows = centre ? await operatorReadinessRows(db) : [];
  const marketName =
    data.markets.find((m) => m.id === run?.market_id)?.name ||
    "your Market Cell";
  const operatorFirstName = (run?.operator_owner || "there").split(/\s+/)[0];
  const weekHref = (week: string) =>
    `/operator/pilot?${new URLSearchParams({ ...(run ? { run: run.id } : {}), view: "overview", week })}`;
  const payers = await db.query<{ id: string; name: string }>(
    "select id,name from organizations where ($1::text<>'real' or not is_demo) order by name",
    [run?.data_kind || "internal"],
  );
  const amendments = run
    ? await db.query<{
        id: string;
        week_key: string;
        previous: string;
        replacement: string;
        reason: string;
        financial_evidence: string;
        program_implications: string;
        protection_review: string;
        created_by: string;
      }>(
        "select a.*,old.name previous,next.name replacement from pilot_supply_amendments a join network_drop_supplies os on os.id=a.previous_supply_id join organizations old on old.id=os.organization_id join network_drop_supplies ns on ns.id=a.replacement_supply_id join organizations next on next.id=ns.organization_id where a.run_id=$1 order by a.created_at",
        [run.id],
      )
    : [];
  return (
    <Shell actor={actor} active="pilot" name={run?.name || "Pilot operations"}>
      <div className="network-operations">
        {view !== "overview" && (
          <PageHeading
            eyebrow="FOUR WEEKS · ONE ACCOUNTABLE SERVICE"
            title={titles[view][0]}
            description={titles[view][1]}
          />
        )}
        <nav
          className="network-tabs pilot-view-tabs"
          aria-label="Pilot workspace"
        >
          {[
            ["overview", "Overview"],
            ["supply", "Weekly supply"],
            ["results", "Results"],
            ["setup", "Setup"],
          ].map(([key, title]) => (
            <Link
              key={key}
              href={viewHref(key)}
              className={view === key ? "active" : undefined}
              aria-current={view === key ? "page" : undefined}
            >
              {title}
            </Link>
          ))}
        </nav>
        {data.runs.length > 1 && (
          <form className="network-form pilot-picker" method="get">
            <input type="hidden" name="view" value={view} />
            <label>
              Current pilot
              <select name="run" defaultValue={run?.id}>
                {data.runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.data_kind} · {r.state}
                  </option>
                ))}
              </select>
            </label>
            <button className="button secondary">Open pilot</button>
          </form>
        )}
        {run && detail && (
          <>
            {view === "overview" && centre && (
              <CommandCentre
                centre={centre}
                run={run}
                marketName={marketName}
                operatorName={operatorFirstName}
                constraints={detail.constraints}
                readiness={readinessRows}
                weekHref={weekHref}
              />
            )}
            {view === "setup" && (
              <section id="today" className="panel network-panel">
                <p className="eyebrow">NEEDS ACTION</p>
                <h2>
                  {detail.constraints.length
                    ? `${detail.constraints.length} launch or distribution items need attention.`
                    : "Launch checklist recorded. Check today’s fulfillment exceptions."}
                </h2>
                <div className="network-status-row">
                  <Badge tone={detail.ready ? "mint" : "amber"}>
                    {detail.ready ? "Pilotable checklist" : "Not ready"}
                  </Badge>
                  <Badge>
                    {run.data_kind === "real"
                      ? "Real pilot records"
                      : `${run.data_kind} rehearsal records`}
                  </Badge>
                  <p>
                    Health:{" "}
                    {detail.scorecard.matured
                      ? "Review evidence and renewal before declaring healthy"
                      : "Insufficient evidence"}
                    .
                  </p>
                </div>
                {detail.constraints.length > 0 && (
                  <div className="pilot-action-list">
                    <ul>
                      {detail.constraints.slice(0, 3).map((c) => (
                        <li key={`${c.category}-${c.text}`}>{c.text}</li>
                      ))}
                    </ul>
                    {detail.constraints.length > 3 && (
                      <details>
                        <summary>
                          Review all {detail.constraints.length} items
                        </summary>
                        <ul>
                          {detail.constraints.slice(3).map((c) => (
                            <li key={`${c.category}-${c.text}`}>{c.text}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
                <p className="pilot-quick-links">
                  <Link href="/operator/network/messaging">
                    Check message delivery
                  </Link>{" "}
                  ·{" "}
                  <Link href="/operator/pilot/support">
                    Open member support
                  </Link>{" "}
                  ·{" "}
                  <Link href="/operator/pilot/fulfillment">
                    Destination readiness, incidents and recovery
                  </Link>
                </p>
              </section>
            )}
            {view === "setup" && (
              <section id="run" className="panel network-panel">
                <p className="eyebrow">CURRENT PILOT</p>
                <h2>{run.name}</h2>
                <p>
                  {String(run.starts_on).slice(0, 10)} through{" "}
                  {String(run.ends_on).slice(0, 10)} (end exclusive),{" "}
                  {run.timezone}. State: {run.state}.
                </p>
                <p>
                  Operator: {run.operator_owner}. Support: {run.support_owner}.
                  Backup: {run.backup_support_owner}. Budget allowance:{" "}
                  {money(run.budget)}.
                </p>
                <details>
                  <summary>Review launch checks and update state</summary>
                  <PilotForm
                    action="run-state"
                    extra={{ runId: run.id }}
                    button="Save reviewed state"
                  >
                    <label>
                      Next state
                      <select name="state">
                        <option value="enrolling">
                          Accept backed admissions
                        </option>
                        <option value="live">Begin fixed-cohort pilot</option>
                        <option value="paused">Pause new operations</option>
                        <option value="complete">
                          Complete after reconciliation
                        </option>
                      </select>
                    </label>
                    {[
                      [
                        "ownerAgreements",
                        "Owner approvals and four-week commitments recorded",
                      ],
                      [
                        "staffRehearsal",
                        "Staff and phone-to-counter rehearsal completed",
                      ],
                      [
                        "recoveryFunded",
                        "Recovery authority and funded capacity confirmed",
                      ],
                      [
                        "supportCoverage",
                        "Primary and backup support owners available",
                      ],
                      [
                        "partnerDistribution",
                        "Partner distribution plan agreed",
                      ],
                      [
                        "privacyIdentity",
                        "Legal identity, contact and privacy process confirmed",
                      ],
                      [
                        "releaseVerified",
                        "Hosted release and safety checks verified",
                      ],
                    ].map(([key, title]) => (
                      <label className="network-check" key={key}>
                        <input
                          type="checkbox"
                          name={key}
                          defaultChecked={!!run.checklist[key]}
                        />
                        {title}
                      </label>
                    ))}
                    <label>
                      Verified release SHA
                      <input
                        name="releaseSha"
                        defaultValue={run.release_sha}
                        maxLength={80}
                      />
                    </label>
                  </PilotForm>
                </details>
                <details>
                  <summary>Admit a verified member</summary>
                  <p>
                    Joining and promotional consent are separate. Admission
                    checks four weeks of confirmed supply. Starting the run
                    freezes the evaluation cohort.
                  </p>
                  <PilotForm action="admit" button="Check capacity and admit">
                    <label>
                      Verified member
                      <select name="memberId" required defaultValue="">
                        <option value="" disabled>
                          Choose the member requesting admission
                        </option>
                        {admissionChoices.map((member) => (
                          <option key={member.id} value={member.id}>
                            Phone ending {member.phone_hint} · ZIP{" "}
                            {member.home_zip} · {member.data_kind}
                          </option>
                        ))}
                      </select>
                    </label>
                  </PilotForm>
                </details>
              </section>
            )}
            {view === "supply" && (
              <section id="supply" className="panel network-panel">
                <p className="eyebrow">SUPPLY COMMITMENTS</p>
                <h2>Every week has its own capacity.</h2>
                <p>
                  A supply commitment can back one pilot week. Before Monday’s
                  release, confirm current stock, readiness and fallback.
                </p>
                <div className="network-table-wrap">
                  <table className="network-table">
                    <thead>
                      <tr>
                        <th>Week beginning</th>
                        <th>Backed planning capacity</th>
                        <th>Committed supply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.capacity.weeks.map((w) => (
                        <tr key={w.week}>
                          <td>{w.week}</td>
                          <td>{w.capacity}</td>
                          <td>
                            {detail.plans
                              .filter((p) => p.week_key === w.week)
                              .map(
                                (p) =>
                                  `${p.merchant}: ${p.reward} (${p.committed_quantity})`,
                              )
                              .join("; ") || "No supply confirmed"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary>Commit approved weekly supply</summary>
                  <PilotForm
                    action="supply-commit"
                    extra={{ runId: run.id }}
                    button="Confirm this week’s capacity"
                  >
                    <label>
                      Week
                      <select name="weekKey">
                        {pilotWeeks(run).map((w) => (
                          <option key={w}>{w}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Supply
                      <select name="supplyId" required>
                        <option value="">Choose approved, unused supply</option>
                        {data.supplies
                          .filter(
                            (s) =>
                              s.market_id === run.market_id &&
                              s.data_kind === run.data_kind &&
                              s.state === "approved" &&
                              !s.week_key,
                          )
                          .map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.merchant} · {s.reward} · {s.quantity} units
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Committed units
                      <input
                        name="quantity"
                        type="number"
                        min={1}
                        max={200}
                        required
                      />
                    </label>
                  </PilotForm>
                </details>
                <p>
                  <Link
                    href={`/operator/pilot/fulfillment?run=${encodeURIComponent(run.id)}`}
                  >
                    Prepare and publish this week’s backed benefits →
                  </Link>
                </p>
                <details>
                  <summary>Replace unreleased future-week supply</summary>
                  <p>
                    First prepare the replacement’s exact terms, stock, staff
                    readiness and fallback. For paid supply, link the
                    replacement to a prospective version of the same Growth
                    Program. Save this amendment, then approve that version
                    before the week is published.
                  </p>
                  <PilotForm
                    action="supply-amend"
                    extra={{ runId: run.id, requestKey: randomUUID() }}
                    button="Record future-week replacement"
                  >
                    <label>
                      Future week
                      <select name="weekKey" required>
                        {pilotWeeks(run).map((week) => (
                          <option key={week}>{week}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Current commitment
                      <select name="previousSupplyId" required>
                        <option value="">
                          Choose the commitment being replaced
                        </option>
                        {detail.plans.map((plan) => (
                          <option key={plan.supply_id} value={plan.supply_id}>
                            {plan.week_key} · {plan.merchant} · {plan.reward}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Replacement supply
                      <select name="replacementSupplyId" required>
                        <option value="">
                          Choose prepared, uncommitted supply
                        </option>
                        {data.supplies
                          .filter(
                            (supply) =>
                              supply.market_id === run.market_id &&
                              supply.data_kind === run.data_kind &&
                              supply.state === "approved" &&
                              !supply.week_key,
                          )
                          .map((supply) => (
                            <option key={supply.id} value={supply.id}>
                              {supply.merchant} · {supply.reward} ·{" "}
                              {supply.quantity} units
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Replacement units
                      <input
                        name="quantity"
                        type="number"
                        min={1}
                        max={200}
                        required
                      />
                    </label>
                    <label>
                      Reason
                      <textarea
                        name="reason"
                        minLength={10}
                        maxLength={1500}
                        required
                      />
                    </label>
                    <label>
                      Accountable payer
                      <select name="payerOrganizationId" required>
                        <option value="">Choose payer</option>
                        {payers.map((organization) => (
                          <option key={organization.id} value={organization.id}>
                            {organization.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Costs and credits
                      <textarea
                        name="financialEvidence"
                        placeholder="Record the agreed cost, or explain why it stays unchanged. Link any separately recorded credit."
                        minLength={10}
                        maxLength={1500}
                        required
                      />
                    </label>
                    <label>
                      Growth Program implications
                      <textarea
                        name="programImplications"
                        placeholder="Name the prospective Program version and approval needed, or record that this remains organic supply."
                        minLength={10}
                        maxLength={1500}
                        required
                      />
                    </label>
                    <label>
                      Commercial protection review
                      <textarea
                        name="protectionReview"
                        placeholder="Record how any location/category protection is handled. Payment cannot override suitability or existing obligations."
                        minLength={10}
                        maxLength={1500}
                        required
                      />
                    </label>
                  </PilotForm>
                </details>
                {amendments.length > 0 && (
                  <details>
                    <summary>
                      View preserved supply amendment history (
                      {amendments.length})
                    </summary>
                    {amendments.map((amendment) => (
                      <article key={amendment.id}>
                        <h3>
                          {amendment.week_key}: {amendment.previous} →{" "}
                          {amendment.replacement}
                        </h3>
                        <p>{amendment.reason}</p>
                        <p>Costs: {amendment.financial_evidence}</p>
                        <p>Program: {amendment.program_implications}</p>
                        <p>Protection: {amendment.protection_review}</p>
                        <p className="fine">
                          Recorded by {amendment.created_by}. Original
                          commitment remains in history.
                        </p>
                      </article>
                    ))}
                  </details>
                )}
              </section>
            )}
            {view === "setup" && (
              <details
                id="partners"
                className="panel network-panel pilot-setup-detail"
              >
                <summary>Partner distribution</summary>
                <p className="eyebrow">PARTNER DISTRIBUTION</p>
                <h2>A planned audience is not measured reach.</h2>
                {detail.commitments.map((c) => (
                  <article key={c.id}>
                    <h3>
                      {c.partner} · {label(c.channel)}
                    </h3>
                    <p>
                      {stamp(c.planned_at)} · Owner: {c.owner} · {c.state}
                    </p>
                    {c.evidence && <p>{c.evidence}</p>}
                    {c.state === "planned" && (
                      <details>
                        <summary>Record actual distribution</summary>
                        <PilotForm
                          action="partner-complete"
                          extra={{ commitmentId: c.id }}
                          button="Record outcome"
                        >
                          <label>
                            Outcome
                            <select name="state">
                              <option value="completed">Completed</option>
                              <option value="missed">Missed</option>
                              <option value="canceled">Canceled</option>
                            </select>
                          </label>
                          <label>
                            Evidence or reason
                            <input name="evidence" required maxLength={1000} />
                          </label>
                          <label>
                            Reported delivered recipients, if known
                            <input
                              name="reportedDelivered"
                              type="number"
                              min={0}
                            />
                          </label>
                        </PilotForm>
                      </details>
                    )}
                  </article>
                ))}
                <details>
                  <summary>Add a distribution commitment</summary>
                  <PilotForm
                    action="partner-plan"
                    extra={{ runId: run.id }}
                    button="Save partner commitment"
                  >
                    <label>
                      Partner
                      <select name="partnerId" required>
                        {Array.from(
                          new Map(
                            data.sources
                              .filter(
                                (s) =>
                                  s.market_id === run.market_id &&
                                  s.data_kind === run.data_kind,
                              )
                              .map((s) => [s.partner_id, s]),
                          ).values(),
                        ).map((s) => (
                          <option value={s.partner_id} key={s.partner_id}>
                            {s.partner}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Tracked source
                      <select name="sourceId" required>
                        {data.sources
                          .filter(
                            (s) =>
                              s.market_id === run.market_id &&
                              s.data_kind === run.data_kind,
                          )
                          .map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.partner} · {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Channel
                      <select name="channel">
                        {[
                          "resident_email",
                          "newsletter",
                          "lobby_card",
                          "front_desk",
                          "move_in",
                          "partner_screen",
                        ].map((c) => (
                          <option key={c} value={c}>
                            {label(c)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Planned time (include time zone)
                      <input
                        name="plannedAt"
                        type="text"
                        placeholder="2026-10-05T09:00:00-04:00"
                        required
                      />
                    </label>
                    <label>
                      Accountable owner/contact
                      <input name="owner" required />
                    </label>
                    <label>
                      Intended population estimate, if known
                      <input name="intendedPopulation" type="number" min={0} />
                    </label>
                  </PilotForm>
                </details>
                {detail.partners.length > 0 && (
                  <div className="network-table-wrap">
                    <table className="network-table">
                      <thead>
                        <tr>
                          <th>Partner</th>
                          <th>Intended population estimate</th>
                          <th>Distributions executed</th>
                          <th>Verified admitted members</th>
                          <th>Repeated digital use</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.partners.map((p) => (
                          <tr key={p.partner_id}>
                            <td>{p.name}</td>
                            <td>{p.intended_population ?? "Unknown"}</td>
                            <td>{p.executed}</td>
                            <td>{p.verified_members}</td>
                            <td>
                              {p.retained_members ?? "Small cohort · withheld"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            )}
            {view === "setup" && (
              <details
                id="economics"
                className="panel network-panel pilot-setup-detail"
              >
                <summary>Finances & time</summary>
                <p className="eyebrow">ECONOMICS & LABOR</p>
                <h2>Keep cash, exposure and reserved funds separate.</h2>
                <p>
                  Negotiated fees belong to the approved Growth Program once.
                  These entries record actual cash, benefit exposure, reserved
                  recovery liquidity and retail value separately. An allowance
                  or reservation is not an expense.
                </p>
                <div className="network-grid equal">
                  <details>
                    <summary>Record an economic entry</summary>
                    <PilotForm
                      action="economic-entry"
                      extra={{ runId: run.id }}
                      button="Append economic entry"
                    >
                      <label>
                        Category
                        <select name="category">
                          {economicCategories.map((c) => (
                            <option key={c} value={c}>
                              {label(c)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Basis
                        <select name="basis">
                          <option value="actual">Actual</option>
                          <option value="committed">Committed</option>
                        </select>
                      </label>
                      <label>
                        Amount in USD
                        <input
                          name="amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                        />
                      </label>
                      <label>
                        Payer
                        <input name="payer" required />
                      </label>
                      <label>
                        Payee
                        <input name="payee" required />
                      </label>
                      <label>
                        Date
                        <input name="occurredOn" type="date" required />
                      </label>
                      <label>
                        Growth Program, if relevant
                        <select name="programId" defaultValue="">
                          <option value="">No Growth Program applies</option>
                          {programChoices.map((program) => (
                            <option key={program.id} value={program.id}>
                              {program.name} · {program.buyer}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Evidence/reference
                        <input name="evidence" required />
                      </label>
                      <label>
                        Unique transaction reference
                        <input name="dedupKey" required />
                      </label>
                    </PilotForm>
                  </details>
                  <details>
                    <summary>Record time worked or on call</summary>
                    <PilotForm
                      action="labor-entry"
                      extra={{ runId: run.id }}
                      button="Append labor entry"
                    >
                      <label>
                        Worker
                        <input name="worker" required />
                      </label>
                      <label>
                        Minutes
                        <input
                          name="minutes"
                          type="number"
                          min={1}
                          max={1440}
                          required
                        />
                      </label>
                      <label>
                        Type
                        <select name="kind">
                          <option value="operations">Active operations</option>
                          <option value="setup">One-time setup</option>
                          <option value="on_call">On-call coverage</option>
                        </select>
                      </label>
                      <label>
                        Date
                        <input name="occurredOn" type="date" required />
                      </label>
                      <label>
                        Work performed
                        <input name="note" required />
                      </label>
                    </PilotForm>
                  </details>
                </div>
                <div className="network-table-wrap">
                  <table className="network-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Basis</th>
                        <th>Recorded amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Negotiated Program fees</td>
                        <td>Committed once per approved Program</td>
                        <td>{money(detail.scorecard.programFeeCents / 100)}</td>
                      </tr>
                      <tr>
                        <td>Program credits</td>
                        <td>Recorded contractual adjustments</td>
                        <td>{money(detail.scorecard.creditsCents / 100)}</td>
                      </tr>
                      {detail.scorecard.totals.map((t) => (
                        <tr key={`${t.category}:${t.basis}`}>
                          <td>{label(t.category)}</td>
                          <td>{t.basis}</td>
                          <td>{money(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary>Inspect or reverse ledger entries</summary>
                  {detail.ledger.map((e) => (
                    <article key={e.id}>
                      <p>
                        {String(e.occurred_on).slice(0, 10)} ·{" "}
                        {label(e.category)} · {money(e.amount)} · {e.basis} ·{" "}
                        {e.payer} → {e.payee}
                      </p>
                      <p>{e.evidence}</p>
                      {Number(e.amount) > 0 && !e.reversed && (
                        <PilotForm
                          action="economic-reverse"
                          extra={{ entryId: e.id }}
                          button="Append reversal"
                        >
                          <label>
                            Reason/evidence
                            <input name="evidence" required />
                          </label>
                        </PilotForm>
                      )}
                    </article>
                  ))}
                </details>
              </details>
            )}
            {view === "results" && (
              <section id="scorecard" className="panel network-panel">
                <p className="eyebrow">
                  FIXED COHORT · {detail.scorecard.denominator} MEMBERS
                </p>
                <h2>Evaluate the full four weeks.</h2>
                <p>
                  Members who stop texts or stop visiting remain in the
                  denominator.{" "}
                  {run.data_kind === "real"
                    ? "Internal and synthetic records are excluded."
                    : "This is a rehearsal scorecard, not real pilot evidence."}
                </p>
                <div className="network-metrics">
                  <Metric
                    label="FIRST DIGITAL USE"
                    value={detail.scorecard.firstUse}
                    note={`Target ≥50% of ${detail.scorecard.denominator}`}
                  />
                  <Metric
                    label="TWO OR MORE WEEKS"
                    value={detail.scorecard.repeatUse}
                    note={`Target ≥30% of ${detail.scorecard.denominator}`}
                  />
                  <Metric
                    label="WEEK FOUR"
                    value={detail.scorecard.weekFour ?? "Not mature"}
                    note={`Evaluate ≥25% after week four ends`}
                  />
                </div>
                <p>{detail.scorecard.evidence}</p>
                <p>
                  Active operations target by week four: 180 minutes per week,
                  excluding setup. Recorded time:{" "}
                  {detail.scorecard.labor
                    .map((l) => `${label(l.kind)} ${l.minutes} minutes`)
                    .join("; ") || "None yet"}
                  .
                </p>
                <p>
                  Management criteria guide the renew / repair / stop decision;
                  they are not scientific benchmarks.
                </p>
              </section>
            )}
          </>
        )}
        {(view === "setup" || !run) && (
          <>
            <section className="panel network-panel">
              <details open={!run}>
                <summary>Create a four-week pilot run</summary>
                <p>
                  First create the Market Cell, approved supply and partner
                  sources. Choose a Monday, record accountable people, then
                  confirm all four weeks before accepting members.
                </p>
                <PilotForm action="run-create" button="Create draft pilot">
                  <label>
                    Name
                    <input
                      name="name"
                      placeholder="Westchester pilot — October 2026"
                      required
                    />
                  </label>
                  <label>
                    Market Cell
                    <select name="marketId" required>
                      {data.markets.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} · {m.data_kind}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Data classification
                    <select name="dataKind">
                      {dataKinds.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Monday start
                    <input name="startsOn" type="date" required />
                  </label>
                  <label>
                    Target verified adults
                    <input
                      name="targetMembers"
                      type="number"
                      min={1}
                      max={200}
                      defaultValue={150}
                      required
                    />
                  </label>
                  <label>
                    Hard cap
                    <input
                      name="hardCap"
                      type="number"
                      min={1}
                      max={200}
                      defaultValue={200}
                      required
                    />
                  </label>
                  <label>
                    Paid featured guidance (0–1)
                    <input
                      name="paidLoadGuidance"
                      type="number"
                      min={0}
                      max={1}
                      step=".01"
                      defaultValue=".6"
                      required
                    />
                  </label>
                  <label>
                    Operator owner
                    <input name="operatorOwner" required />
                  </label>
                  <label>
                    Primary support owner
                    <input name="supportOwner" required />
                  </label>
                  <label>
                    Backup support owner
                    <input name="backupSupportOwner" required />
                  </label>
                  <label>
                    Budget allowance in USD
                    <input
                      name="budget"
                      type="number"
                      min={0}
                      step=".01"
                      required
                    />
                  </label>
                </PilotForm>
              </details>
            </section>
            <section className="panel network-panel">
              <details>
                <summary>Classify a new Market Cell, partner or source</summary>
                <p>
                  New records begin as internal. Record evidence before
                  designating a real pilot record. Records with existing member
                  or pilot obligations cannot be relabeled here.
                </p>
                {(
                  [
                    ["market_cells", "Market Cell"],
                    ["acquisition_partners", "Partner"],
                    ["acquisition_sources", "Source"],
                  ] as const
                ).map(([entity, entityLabel]) => (
                  <PilotForm
                    key={entity}
                    action="classify"
                    extra={{ entity }}
                    button={`Record ${entityLabel.toLowerCase()} classification`}
                  >
                    <label>
                      {entityLabel}
                      <select name="entityId" required defaultValue="">
                        <option value="" disabled>
                          Choose the {entityLabel.toLowerCase()}
                        </option>
                        {classificationChoices
                          .filter((record) => record.entity === entity)
                          .map((record) => (
                            <option key={record.id} value={record.id}>
                              {record.name} · {record.data_kind}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Classification
                      <select name="dataKind">
                        {dataKinds.map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Evidence
                      <input name="evidence" required />
                    </label>
                  </PilotForm>
                ))}
              </details>
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
