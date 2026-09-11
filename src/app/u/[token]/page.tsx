import Link from "next/link";
import { getDb } from "@/lib/db";
import { memberHome } from "@/lib/member-experience";
import { eligibleDrops } from "@/lib/network";
import { decrypt } from "@/lib/security";
import {
  MemberFrame,
  DropCard,
  MemberInvite,
  PerkIllustration,
} from "@/components/member-ui";
import {
  ConfirmMembership,
  MemberPreferences,
} from "@/components/member-controls";
import { ArrowUpRight, Check, Clock3 } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function YourUptick({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { token } = await params,
    { view } = await searchParams,
    db = await getDb();
  let data;
  try {
    data = await memberHome(db, token);
  } catch {
    return (
      <MemberFrame>
        <div className="member-empty">
          <h1>
            Your next good thing
            <br />
            <em>is one text away.</em>
          </h1>
          <p>
            This private link has expired or isn’t complete. Use your phone
            number to get a fresh link.
          </p>
          <Link className="button" href="/join">
            Get my Uptick link
          </Link>
        </div>
      </MemberFrame>
    );
  }
  if (!data.access.confirmed_at)
    return (
      <MemberFrame>
        <section className="member-welcome">
          <PerkIllustration />
          <p className="eyebrow">A PRIVATE INVITATION, JUST FOR YOU</p>
          <h1>
            {data.access.consent_requested ? (
              <>
                Good to have
                <br />
                <em>you around.</em>
              </>
            ) : (
              <>
                Your Uptick
                <br />
                <em>is waiting.</em>
              </>
            )}
          </h1>
          <p>
            {data.access.consent_requested
              ? "Confirm the membership choice below. We’ll find something good near your home or work."
              : "Open your private membership to see your local Drop and saved passes."}
          </p>
          <ConfirmMembership
            token={token}
            requested={data.access.consent_requested}
            disclosure={data.access.disclosure}
          />
        </section>
      </MemberFrame>
    );
  const eligible = new Set(
    (await eligibleDrops(db, data.member.id)).map((s) => s.id),
  );
  const saved = data.saved;
  return (
    <MemberFrame privateView>
      <nav className="member-tabs">
        <Link aria-current={!view ? "page" : undefined} href={`/u/${token}`}>
          Your Uptick
        </Link>
        <Link
          aria-current={view === "history" ? "page" : undefined}
          href={`/u/${token}?view=history`}
        >
          Your good things
        </Link>
        <Link
          aria-current={view === "preferences" ? "page" : undefined}
          href={`/u/${token}?view=preferences`}
        >
          Preferences
        </Link>
      </nav>
      {view === "preferences" ? (
        <section className="member-settings">
          <p className="eyebrow">LOCAL, ON YOUR TERMS</p>
          <h1>
            Make it
            <br />
            <em>your Uptick.</em>
          </h1>
          <p>
            Your ZIPs help us choose a useful local market. No continuous
            location tracking.
          </p>
          <MemberPreferences
            token={token}
            homeZip={data.member.home_zip}
            workZip={data.member.work_zip}
            subscribed={data.member.state === "active"}
          />
        </section>
      ) : view === "history" ? (
        <section className="member-history">
          <p className="eyebrow">YOUR GOOD THINGS</p>
          <h1>
            A little history.
            <br />
            <em>A lot of local.</em>
          </h1>
          {data.history.length ? (
            data.history.map((h) => (
              <Link
                className="member-history-row"
                key={h.id}
                href={`/p/${decrypt(h.token_encrypted)}`}
              >
                <span className="member-round-icon">
                  {h.state === "redeemed" ? (
                    <Check size={20} />
                  ) : (
                    <Clock3 size={20} />
                  )}
                </span>
                <div>
                  <strong>{h.snapshot.reward}</strong>
                  <p>{h.snapshot.merchant}</p>
                  <small>
                    {h.state === "redeemed"
                      ? "Recorded redemption"
                      : h.state === "revoked"
                        ? "Pass voided"
                        : new Date(h.reserved_until || h.snapshot.expires_at) <=
                            new Date()
                          ? h.reserved_until
                            ? "Reservation ended"
                            : "Offer ended"
                          : "Saved pass"}{" "}
                    ·{" "}
                    {new Date(h.redeemed_at || h.created_at).toLocaleDateString(
                      "en-US",
                      {
                        month: "short",
                        day: "numeric",
                        timeZone: h.snapshot.timezone,
                      },
                    )}
                  </small>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            ))
          ) : (
            <div className="member-empty">
              <p>
                Your first Uptick starts your story. Claim a local perk and it
                will appear here.
              </p>
              <Link className="button" href={`/u/${token}`}>
                Find my Uptick
              </Link>
            </div>
          )}
          <p className="fine">
            These are your recorded Uptick interactions. They don’t represent
            every store visit or purchase.
          </p>
        </section>
      ) : (
        <>
          <header className="member-your-heading">
            <p className="eyebrow">
              {data.market?.name || "YOUR LOCAL MEMBERSHIP"}
            </p>
            <h1>
              What’s your
              <br />
              <em>Uptick this week?</em>
            </h1>
            <p>A little something free. A good reason to go nearby.</p>
          </header>
          {saved ? (
            <section className="member-saved">
              <p className="eyebrow">
                {saved.state === "redeemed"
                  ? "THIS WEEK, ENJOYED"
                  : "YOUR UPTICK IS SAVED"}
              </p>
              <PerkIllustration reward={saved.snapshot.reward} />
              <h2>{saved.snapshot.reward}</h2>
              <p>{saved.snapshot.merchant}</p>
              <Link
                href={`/p/${decrypt(saved.token_encrypted)}`}
                className="button"
              >
                {saved.state === "redeemed"
                  ? "View my redemption"
                  : "Open my pass"}
                <ArrowUpRight size={16} />
              </Link>
              <p className="fine">
                You chose this week’s Uptick. Come around again for your next
                local perk.
              </p>
            </section>
          ) : data.member.state !== "active" ? (
            <div className="member-empty">
              <h2>Your membership texts are paused.</h2>
              <p>
                Your saved passes still work. Resume your membership when you’re
                ready for another Uptick.
              </p>
              <Link className="button" href={`/u/${token}?view=preferences`}>
                My preferences
              </Link>
            </div>
          ) : data.current?.options.length ? (
            <>
              <DropCard
                token={token}
                supply={data.current.options[0]}
                available={eligible.has(data.current.options[0].id)}
              />
              {data.current.options.length > 1 && (
                <section className="member-alternatives">
                  <p className="eyebrow">SAME WEEK. YOUR CHOICE.</p>
                  <h2>
                    Rather have
                    <br />
                    <em>something else?</em>
                  </h2>
                  <p>
                    Choose one Uptick this week. These are your other local
                    options.
                  </p>
                  {data.current.options.slice(1).map((s) => (
                    <DropCard
                      key={s.id}
                      token={token}
                      supply={s}
                      alternative
                      available={eligible.has(s.id)}
                    />
                  ))}
                </section>
              )}
            </>
          ) : (
            <div className="member-empty">
              <PerkIllustration />
              <h2>
                We’re lining up
                <br />
                <em>something good.</em>
              </h2>
              <p>
                {data.member.market_id
                  ? "There isn’t an available Drop for you right now. Uptick is checking the local supply."
                  : "We’re building the network around your ZIP. We’ll text when your local Uptick is ready."}
              </p>
              <Link className="text-link" href={`/u/${token}?view=preferences`}>
                Check my local area
                <ArrowUpRight size={15} />
              </Link>
            </div>
          )}
          <div className="member-next-note">
            <p className="eyebrow">THE GOOD KIND OF ROUTINE</p>
            <h3>
              One local perk.
              <br />A new reason to come around.
            </h3>
            <p>
              We’ll text your next available Uptick. No endless scrolling, no
              app to manage.
            </p>
          </div>
          {data.member.state === "active" &&
            ["pilot", "live"].includes(data.market?.state || "") && (
              <MemberInvite token={token} supplyId={data.shareableSupplyId} />
            )}
        </>
      )}
    </MemberFrame>
  );
}
