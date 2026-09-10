import { redirect } from "next/navigation";
import { getPilotPrincipal } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { Brand } from "@/components/ui";
import { PilotWorkspaces } from "@/components/pilot-workspaces";
export const dynamic = "force-dynamic";
export default async function Pilot() {
  if (!(await getPilotPrincipal())) redirect("/login");
  const businesses = await (
    await getDb()
  ).query<{ id: string; name: string }>(
    "select id,name from organizations where is_demo and 'merchant'=any(capabilities) order by name",
  );
  return (
    <main id="main" className="login-page">
      <section className="login-story">
        <Brand />
        <div>
          <p className="eyebrow">PROTECTED PILOT</p>
          <h1>
            One market.
            <br />
            <em>Every perspective.</em>
          </h1>
          <p>
            Exercise the real Uptick flow with controlled sample workspaces.
          </p>
        </div>
      </section>
      <section className="login-panel">
        <div>
          <p className="eyebrow">STAGING WORKSPACES</p>
          <h2>Choose your workspace.</h2>
          <p className="muted">
            These options are available only to an approved pilot operator after
            sign-in.
          </p>
          <PilotWorkspaces businesses={businesses} />
        </div>
      </section>
    </main>
  );
}
