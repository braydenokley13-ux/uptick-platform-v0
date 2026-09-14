import Link from "next/link";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { pilotOperations, pilotWeeks } from "@/lib/pilot-operations";
import { pilotPromiseOperations } from "@/lib/pilot-promise";
import { PilotPromiseControls } from "@/components/pilot-promise-controls";
import { WeeklyReleaseForm } from "@/components/weekly-release-form";
import { Shell } from "@/components/shell";
import { PageHeading } from "@/components/ui";
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
            <WeeklyReleaseForm
              run={run}
              weeks={pilotWeeks(run)}
              members={detail.admissions.map((a) => a.member_id).sort()}
              plans={detail.plans.map((p) => ({
                ...p,
                label: `${p.merchant} — ${p.reward}`,
              }))}
            />
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
            Use the grant ID when opening an incident. These records show
            digital status; they do not prove the item was handed over.
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
          <h2>Readiness and recovery controls</h2>
          <PilotPromiseControls data={data} organizations={organizations} />
        </section>
      </div>
    </Shell>
  );
}
