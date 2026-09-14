import Link from "next/link";
import { getDb } from "@/lib/db";
import { memberHome } from "@/lib/member-experience";
import { MemberFrame, PerkIllustration } from "@/components/member-ui";
import { ConfirmMembership } from "@/components/member-controls";

export const dynamic = "force-dynamic";

export default async function AccessLanding({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let data;
  try {
    data = await memberHome(await getDb(), token);
  } catch {
    return (
      <MemberFrame>
        <div className="member-empty">
          <h1>
            This access link
            <br />
            <em>isn’t available.</em>
          </h1>
          <p>
            It may have expired. Request a fresh link, or use a recovery code if
            you previously saved one.
          </p>
          <Link className="button" href="/join">
            Get membership access
          </Link>
        </div>
      </MemberFrame>
    );
  }

  if (data.access.consumed_at)
    return (
      <MemberFrame>
        <div className="member-empty">
          <h1>
            This link was
            <br />
            <em>already used.</em>
          </h1>
          <p>
            Access links work once. Open Your Uptick on the browser where you
            joined, or recover access with one of your saved codes.
          </p>
          <Link className="button" href="/your-uptick">
            Open Your Uptick
          </Link>
          <Link className="text-link" href="/join">
            Recovery and fresh-link options
          </Link>
        </div>
      </MemberFrame>
    );

  if (data.access.purpose === "drop")
    return (
      <MemberFrame>
        <div className="member-empty">
          <h1>
            Your Uptick has
            <br />
            <em>a safer home.</em>
          </h1>
          <p>
            Weekly links no longer carry account access. Open Your Uptick in a
            signed-in browser, or recover access from the join page.
          </p>
          <Link className="button" href="/your-uptick">
            Open Your Uptick
          </Link>
          <Link className="text-link" href="/join">
            Recover access
          </Link>
        </div>
      </MemberFrame>
    );

  return (
    <MemberFrame>
      <section className="member-welcome">
        <PerkIllustration />
        <p className="eyebrow">YOUR PRIVATE UPTICK ACCESS</p>
        <h1>
          Good to have
          <br />
          <em>you around.</em>
        </h1>
        <p>
          Confirm your phone-linked membership to keep private access in this
          browser. Simply viewing this page changes nothing.
        </p>
        <ConfirmMembership
          token={token}
          requested={data.access.consent_requested}
          disclosure={data.access.disclosure}
        />
      </section>
    </MemberFrame>
  );
}
