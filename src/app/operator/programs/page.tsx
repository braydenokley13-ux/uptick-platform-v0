import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { operatorGrowthProgramWorkspace } from "@/lib/growth-programs";
import {
  GrowthProgramOperatorControls,
  GrowthPrograms,
} from "@/components/growth-programs";
import { Shell } from "@/components/shell";
import { Empty } from "@/components/ui";
import "@/components/merchant.css";
import "@/components/growth-programs.css";

export const dynamic = "force-dynamic";

export default async function OperatorPrograms({
  searchParams,
}: {
  searchParams: Promise<{ organization?: string }>;
}) {
  const [actor, query] = await Promise.all([requireActor(true), searchParams]);
  const data = await operatorGrowthProgramWorkspace(
    await getDb(),
    actor,
    query.organization,
  );
  return (
    <Shell actor={actor} active="programs" name="Growth Programs">
      <div className="growth-programs">
        <form className="gp-panel gp-form" method="get">
          <label>
            Merchant buyer workspace
            <select
              name="organization"
              defaultValue={data.selectedOrganizationId || ""}
            >
              {data.organizations.map((organization) => (
                <option value={organization.id} key={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary">Open buyer workspace</button>
        </form>
        {data.workspace ? (
          <>
            <GrowthPrograms data={data.workspace} section="program" />
            <GrowthProgramOperatorControls data={data} />
          </>
        ) : (
          <Empty title="No merchant workspace is ready yet.">
            Add a merchant location to a Market Cell before creating its Growth
            Program.
          </Empty>
        )}
      </div>
    </Shell>
  );
}
