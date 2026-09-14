import { getDb } from "@/lib/db";
import {
  acquisitionSource,
  supplySelect,
  supplyUsage,
  type Supply,
} from "@/lib/network";
import { MemberFrame, PerkIllustration } from "@/components/member-ui";
import { JoinUptick, RecoverMemberAccess } from "@/components/member-controls";
import { Badge } from "@/components/ui";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function JoinPage({
  params,
}: {
  params: Promise<{ source?: string[] }>;
}) {
  const { source: segments } = await params;
  const sourceToken = segments?.[0],
    db = await getDb();
  let source: null | Awaited<ReturnType<typeof acquisitionSource>> = null;
  try {
    if (sourceToken) source = await acquisitionSource(db, sourceToken);
  } catch {
    return (
      <MemberFrame>
        <div className="member-empty">
          <h1>
            This invitation
            <br />
            <em>has taken a pause.</em>
          </h1>
          <p>
            You can still join Uptick to hear when a local perk is ready for
            you.
          </p>
          <Link className="button" href="/join">
            Join Uptick
          </Link>
        </div>
      </MemberFrame>
    );
  }
  const candidates = await db.query<Supply>(
    `${supplySelect} where s.state='approved' and ml.active and exists(select 1 from market_cells k where k.id=s.market_id and k.state in ('pilot','live')) and s.starts_at<=now() and s.expires_at>now()${source ? " and s.market_id=$1" : ""} order by s.created_at limit 8`,
    source ? [source.market_id] : [],
  );
  let example: Supply | undefined;
  for (const candidate of candidates) {
    const usage = await supplyUsage(db, candidate.id);
    if (usage.remaining === null || usage.remaining > 0) {
      example = candidate;
      break;
    }
  }
  return (
    <MemberFrame>
      <div className="member-join-grid">
        <section className="member-join-story">
          <p className="eyebrow">
            {source?.partner
              ? `UPTICK FOR ${source.partner}`
              : "YOUR NEIGHBORHOOD HAS SOMETHING FOR YOU"}
          </p>
          <h1>
            A little free.
            <br />A lot to <br />
            <em>look forward to.</em>
          </h1>
          <p className="member-lead">
            Your free local membership. A worthwhile perk at a nearby store. A
            new reason to come around.
          </p>
          <div className="member-join-benefits">
            <span>Free to join</span>
            <span>No app to download</span>
            <span>One good thing at a time</span>
          </div>
          <div className="member-preview-perk">
            <div>
              <Badge tone="amber">
                {example ? "In the local pilot" : "THE IDEA IS SIMPLE"}
              </Badge>
              <h2>
                {example?.reward.replace(/^Get (a |an )?/i, "") ||
                  "Something good. On us."}
              </h2>
              <p>
                {example
                  ? `${example.merchant} · ${example.qualification}`
                  : "Coffee. A cold drink. A little local extra."}
              </p>
            </div>
            <PerkIllustration compact reward={example?.reward} />
          </div>
          <p className="fine">
            {source?.market
              ? `This invitation connects you with ${source.market}.`
              : "Your home and work ZIPs help us keep Uptick local."}{" "}
            Your available Drop is shown after you join; quantities and terms
            apply.
          </p>
        </section>
        <section className="member-join-panel">
          <p className="eyebrow">WELCOME TO UPTICK LOCAL</p>
          <h2>
            Your next good thing
            <br />
            <em>starts here.</em>
          </h2>
          <p>
            We’ll text a one-time private link to confirm your phone and open
            your membership.
          </p>
          <JoinUptick sourceToken={sourceToken} />
          <p className="member-already">
            Already a member? Use the same number to get a fresh private link.
          </p>
          <RecoverMemberAccess />
        </section>
      </div>
      {source && <SourceVisit token={sourceToken!} />}
    </MemberFrame>
  );
}
import { SourceVisit } from "@/components/member-source-visit";
