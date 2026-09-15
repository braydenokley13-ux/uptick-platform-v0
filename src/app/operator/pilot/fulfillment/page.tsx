import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { pilotOperations, pilotWeeks } from "@/lib/pilot-operations";
import { pilotPromiseOperations } from "@/lib/pilot-promise";
import { PilotPromiseControls } from "@/components/pilot-promise-controls";
import { WeeklyReleaseForm } from "@/components/weekly-release-form";
import { Shell } from "@/components/shell";
import { PageHeading } from "@/components/ui";
import { PilotForm } from "@/components/pilot-form";
import "@/components/network-operations.css";

export const dynamic = "force-dynamic";
export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const actor = await requireActor(true),
    db = await getDb();
  const operations = await pilotOperations(db, actor, (await searchParams).run);
  const { run, detail } = operations;
  // Keep uncommitted supplies available here so their free terms can be certified before commitment.
  const data = await pilotPromiseOperations(db, actor);
  const organizations = await db.query<{ id: string; name: string }>(
    "select id,name from organizations order by name",
  );
  const destinations = run
    ? await db.query<{ id: string; merchant: string; address: string }>(
        "select l.id,o.name merchant,l.address from market_locations ml join locations l on l.id=ml.location_id join organizations o on o.id=l.organization_id where ml.market_id=$1 order by o.name,l.id",
        [run.market_id],
      )
    : [];
  const outages = await db.query<{
    id: string;
    merchant: string;
    reason: string;
    closed_at: string | null;
  }>(
    "select x.*,o.name merchant from location_outages x join locations l on l.id=x.location_id join organizations o on o.id=l.organization_id order by x.opened_at desc limit 50",
  );
  const affected = await db.query<{
    outage_id: string;
    grant_id: string;
    member_id: string;
    week_key: string;
    incident_id: string | null;
    recovery_state: string | null;
  }>(`select q.outage_id,q.grant_id,g.member_id,g.week_key,
    (select i.id from fulfillment_incidents i where i.grant_id=g.id order by i.created_at desc limit 1) incident_id,
    (select r.state from recovery_grants r where r.original_grant_id=g.id and r.superseded_at is null) recovery_state
    from location_outage_obligations q join fulfillment_grants g on g.id=q.grant_id join location_outages x on x.id=q.outage_id
    where x.closed_at is null order by g.week_key,g.member_id limit 1000`);
  const grants = run
    ? await db.query<{
        id: string;
        member_id: string;
        week_key: string;
        state: string;
        merchant: string;
      }>(
        "select g.id,g.member_id,g.week_key,g.state,o.name merchant from fulfillment_grants g join weekly_releases w on w.id=g.release_id join organizations o on o.id=g.organization_id where w.run_id=$1 order by g.week_key desc,g.member_id limit 800",
        [run.id],
      )
    : [];
  return (
    <Shell actor={actor} active="pilot" name="Pilot fulfillment">
      <div className="network-operations">
        <PageHeading
          eyebrow="CONFIRM · RESERVE · REPAIR"
          title="Keep each member’s promise."
          description="Confirm exact terms and readiness, publish one backed grant per member, and repair fulfillment failures."
        />
        <p>
          <Link href="/operator/pilot">← Pilot Today</Link> ·{" "}
          <Link href="/operator/pilot/support">Member support</Link> ·{" "}
          <Link href="/operator/network/supply">Create or approve supply</Link>
        </p>
        {operations.runs.length > 0 && (
          <form className="network-form" method="get">
            <label>
              Pilot run
              <select name="run" defaultValue={run?.id}>
                {operations.runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.data_kind}
                  </option>
                ))}
              </select>
            </label>
            <button className="button secondary">Open pilot</button>
          </form>
        )}
        {run && detail ? (
          <section className="panel network-panel">
            <h2>Review and publish a weekly release</h2>
            <p>
              {run.name} · {run.data_kind} records
            </p>
            <WeeklyReleaseForm run={run} weeks={pilotWeeks(run)} />
            <details>
              <summary>Record travel suitability before recommending</summary>
              <p>
                Use member-stated travel relevance or reviewed cell geography.
                Do not enter home addresses, inferred income or tracked
                location. A paid placement has the same fit rules as organic
                supply.
              </p>
              <PilotForm
                endpoint="/api/pilot-promise"
                action="review_suitability"
                extra={{ scope: "pilot", runId: run.id }}
                button="Save cell suitability review"
              >
                <label className="network-check">
                  <input name="allDestinationsFit" type="checkbox" />
                  All participating destinations fit every operational member in
                  this small cell
                </label>
                <label>
                  Maximum useful drive estimate in minutes
                  <input
                    name="maxDriveMinutes"
                    type="number"
                    min={1}
                    max={60}
                    defaultValue={20}
                    required
                  />
                </label>
                <label>
                  Review evidence and usable-hours relevance
                  <textarea
                    name="evidence"
                    minLength={10}
                    maxLength={1500}
                    required
                  />
                </label>
              </PilotForm>
              <PilotForm
                endpoint="/api/pilot-promise"
                action="review_suitability"
                extra={{ scope: "member" }}
                button="Save member destination review"
              >
                <label>
                  Member
                  <select name="memberId" required defaultValue="">
                    <option value="" disabled>
                      Choose the member
                    </option>
                    {detail.admissions.map((m) => (
                      <option key={m.member_id} value={m.member_id}>
                        Phone ending {m.phone_hint} · ZIP {m.home_zip} ·{" "}
                        {m.data_kind}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Destination
                  <select name="locationId" required defaultValue="">
                    <option value="" disabled>
                      Choose the reviewed destination
                    </option>
                    {destinations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.merchant} · {s.address}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Travel fit
                  <select name="suitable" required defaultValue="">
                    <option value="" disabled>
                      Choose the actual fit
                    </option>
                    <option value="true">
                      Suitable — member relevance confirmed
                    </option>
                    <option value="false">Unsuitable — do not assign</option>
                  </select>
                </label>
                <label>
                  Member-specific drive estimate (optional)
                  <input name="driveMinutes" type="number" min={0} max={180} />
                </label>
                <label>
                  Member preference and hours evidence
                  <textarea
                    name="evidence"
                    minLength={10}
                    maxLength={1500}
                    required
                  />
                </label>
              </PilotForm>
            </details>
          </section>
        ) : (
          <section className="panel network-panel">
            <h2>Start with a pilot run</h2>
            <p>
              Create the run from Pilot Today. You can certify supply below
              before committing it to four weeks.
            </p>
          </section>
        )}
        <section className="panel network-panel">
          <h2>Issued promises</h2>
          <p>
            Choose the member’s benefit in the incident form below. These
            records show digital status; they do not prove the item was handed
            over.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Member reference</th>
                  <th>Merchant</th>
                  <th>Status</th>
                  <th>Grant ID</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td>{g.week_key}</td>
                    <td>{g.member_id.slice(-8)}</td>
                    <td>{g.merchant}</td>
                    <td>{g.state}</td>
                    <td>
                      <code>{g.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel network-panel">
          <h2>Whole-location failure</h2>
          <p>
            Opening an outage stops new distribution and directions to that
            location, suspends its readiness, and queues affected promises for
            recovery review. It does not claim that each member experienced a
            failure.
          </p>
          <PilotForm
            endpoint="/api/pilot-promise"
            action="open_location_outage"
            extra={{ requestKey: randomUUID() }}
            button="Stop routing and open outage"
          >
            <label>
              Destination
              <select name="locationId" required>
                <option value="">Choose a destination</option>
                {destinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.merchant} · {d.address}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Outage owner
              <input name="owner" required maxLength={200} />
            </label>
            <label>
              What failed and what is known?
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={1500}
              />
            </label>
          </PilotForm>
          {outages.map((outage) => (
            <article className="panel network-panel" key={outage.id}>
              <h3>
                {outage.merchant} ·{" "}
                {outage.closed_at
                  ? "Closed; readiness must be rechecked"
                  : "Open outage"}
              </h3>
              <p>{outage.reason}</p>
              {affected
                .filter((row) => row.outage_id === outage.id)
                .map((row) => (
                  <div className="panel network-panel" key={row.grant_id}>
                    <p>
                      Member {row.member_id.slice(-8)} · original week{" "}
                      {row.week_key} · recovery{" "}
                      {row.recovery_state || "needs review"}
                    </p>
                    {!row.incident_id && (
                      <PilotForm
                        endpoint="/api/pilot-promise"
                        action="report_incident"
                        extra={{
                          grantId: row.grant_id,
                          incidentType: "unexpected_closure",
                          severity: "high",
                          occurredAt: new Date().toISOString(),
                          owner: "Uptick outage support",
                          note: `Location outage review: ${outage.reason}. Physical handoff remains unknown.`,
                          idempotencyKey: `outage:${outage.id}:${row.grant_id}`,
                        }}
                        button="Open this member’s recovery incident"
                      />
                    )}
                    {row.incident_id && (
                      <p>
                        Incident recorded. Choose this member’s incident in the
                        backed recovery form below.
                      </p>
                    )}
                  </div>
                ))}
              {!outage.closed_at && (
                <PilotForm
                  endpoint="/api/pilot-promise"
                  action="close_location_outage"
                  extra={{ outageId: outage.id }}
                  button="Close outage; keep routing paused"
                >
                  <label>
                    Resolution evidence
                    <textarea
                      name="evidence"
                      minLength={10}
                      maxLength={1500}
                      required
                    />
                  </label>
                </PilotForm>
              )}
            </article>
          ))}
          <p>
            After closing: recheck physical stock, hours, staff QR and fallback
            below, then reactivate the destination and supply from{" "}
            <Link href="/operator/network/supply">supply operations</Link>.
          </p>
        </section>
        <section className="panel network-panel">
          <h2>Readiness and recovery controls</h2>
          <PilotPromiseControls data={data} organizations={organizations} />
        </section>
      </div>
    </Shell>
  );
}
