import Link from "next/link";
import { getDb } from "@/lib/db";
import { referralLanding } from "@/lib/member-experience";
import { MemberFrame, PerkIllustration } from "@/components/member-ui";
import { JoinUptick } from "@/components/member-controls";
export const dynamic = "force-dynamic";
export default async function ReferralPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let data;
  try {
    data = await referralLanding(await getDb(), token);
  } catch {
    return (
      <MemberFrame>
        <div className="member-empty">
          <h1>
            Good things
            <br />
            <em>move quickly.</em>
          </h1>
          <p>
            This invitation has ended. You can still join Uptick for your own
            local perks.
          </p>
          <Link className="button" href="/join">
            Join Uptick
          </Link>
        </div>
      </MemberFrame>
    );
  }
  return (
    <MemberFrame>
      <div className="member-join-grid">
        <section className="member-join-story">
          <p className="eyebrow">SOMEONE THOUGHT OF YOU</p>
          <h1>
            Good things
            <br />
            are better
            <br />
            <em>shared.</em>
          </h1>
          <p className="member-lead">
            You’re invited to Uptick in {data.referral.market}. Your free
            membership comes with a reason to go local.
          </p>
          <div className="member-preview-perk">
            <div>
              <p className="eyebrow">
                {data.supply ? "THE SHARED UPTICK" : "YOUR NEIGHBORHOOD"}
              </p>
              <h2>{data.supply?.reward || "A little something good."}</h2>
              <p>{data.supply?.merchant || "A local perk, chosen for you."}</p>
            </div>
            <PerkIllustration compact reward={data.supply?.reward} />
          </div>
          <p className="fine">
            Joining doesn’t reserve an item. Your home or work ZIP must match
            the local market, and available inventory still applies.
          </p>
        </section>
        <section className="member-join-panel">
          <h2>
            Your own Uptick
            <br />
            <em>is one text away.</em>
          </h2>
          <JoinUptick referralToken={token} />
        </section>
      </div>
    </MemberFrame>
  );
}
