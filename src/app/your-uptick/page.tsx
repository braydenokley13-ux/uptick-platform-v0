import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowUpRight, Check, Clock3 } from "lucide-react";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/security";
import { memberHome } from "@/lib/member-experience";
import { MEMBER_SESSION_COOKIE } from "@/lib/member-session";
import {
  DropCard,
  MemberFrame,
  MemberInvite,
  PerkIllustration,
} from "@/components/member-ui";
import {
  MemberAccountControls,
  MemberHelp,
  MemberPreferences,
} from "@/components/member-controls";

export const dynamic = "force-dynamic";

export default async function YourUptick({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const credential = (await cookies()).get(MEMBER_SESSION_COOKIE)?.value;
  if (!credential) redirect("/join");
  let data;
  try {
    data = await memberHome(await getDb(), credential);
  } catch {
    redirect("/join");
  }
  const { view } = await searchParams;
  const current = data.current as
    | (NonNullable<typeof data.current> & {
        grant?: {
          id: string;
          state: string;
          expires_at?: string;
          member_snapshot?: { reward?: string; terms?: string };
        } | null;
        recovery?: {
          state: string;
          expires_at?: string;
          member_snapshot?: {
            merchant?: string;
            address?: string;
            exact_item?: string;
            size_label?: string;
            usable_hours?: string;
            instructions?: string;
          };
        } | null;
      })
    | null;
  const saved = data.saved;
  const currentRecoveryPass = current?.recovery
    ? data.outstandingRecoveries.find(
        (recovery) => recovery.id === current.recovery?.id,
      )
    : null;
  const earlierRecoveries = data.outstandingRecoveries.filter(
    (recovery) => !recovery.current_week,
  );
  const currentRecoveryStatus =
    current?.recovery?.state === "issued" && !currentRecoveryPass
      ? "expired"
      : current?.recovery?.state;

  return (
    <MemberFrame privateView>
      <nav className="member-tabs">
        <Link aria-current={!view ? "page" : undefined} href="/your-uptick">
          Your Uptick
        </Link>
        <Link
          aria-current={view === "history" ? "page" : undefined}
          href="/your-uptick?view=history"
        >
          Your good things
        </Link>
        <Link
          aria-current={view === "preferences" ? "page" : undefined}
          href="/your-uptick?view=preferences"
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
            Your ZIPs help us choose a useful local market. Your promotional
            text choice is separate from your free membership.
          </p>
          <MemberPreferences
            homeZip={data.member.home_zip}
            workZip={data.member.work_zip}
            subscribed={data.marketingSubscribed}
          />
          <MemberAccountControls />
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
            data.history.map((item) => (
              <Link
                className="member-history-row"
                key={item.id}
                href={`/p/${decrypt(item.token_encrypted)}`}
              >
                <span className="member-round-icon">
                  {item.state === "redeemed" ? (
                    <Check size={20} />
                  ) : (
                    <Clock3 size={20} />
                  )}
                </span>
                <div>
                  <strong>{item.snapshot.reward}</strong>
                  <p>{item.snapshot.merchant}</p>
                  <small>
                    {item.state === "redeemed"
                      ? "Recorded redemption"
                      : item.state === "invalidated"
                        ? "Pass voided"
                        : "Saved pass"}
                  </small>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            ))
          ) : (
            <div className="member-empty">
              <p>Your first issued Uptick will appear here.</p>
            </div>
          )}
          <MemberHelp />
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
            <p>Your free membership stays active with or without texts.</p>
          </header>

          {earlierRecoveries.length > 0 && (
            <section className="member-saved">
              <p className="eyebrow">EARLIER UPTICK RECOVERY</p>
              <h2>Your outstanding make-good is still ready.</h2>
              <p>
                A recovery stays connected to the original week and private
                pass. It does not replace this week’s benefit.
              </p>
              {earlierRecoveries.map((recovery) => (
                <div key={recovery.id} className="member-history-row">
                  <span className="member-round-icon">
                    <Clock3 size={20} />
                  </span>
                  <div>
                    <strong>
                      {recovery.member_snapshot.exact_item || "Backed recovery"}
                    </strong>
                    <p>
                      {recovery.member_snapshot.merchant ||
                        "Participating location"}
                    </p>
                    <small>
                      Original week {recovery.week_key} · no purchase or member
                      fee required
                    </small>
                  </div>
                  <Link
                    href={`/p/${decrypt(recovery.token_encrypted)}`}
                    aria-label={`Open recovery pass for ${recovery.member_snapshot.exact_item || "your make-good"}`}
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                </div>
              ))}
            </section>
          )}

          {current?.recovery && (
            <section className="member-saved">
              <p className="eyebrow">UPTICK RECOVERY</p>
              <h2>
                {current.recovery.member_snapshot?.exact_item ||
                  "Your make-good is ready"}
              </h2>
              <p>
                {current.recovery.member_snapshot?.merchant}
                {current.recovery.member_snapshot?.address
                  ? ` · ${current.recovery.member_snapshot.address}`
                  : ""}
              </p>
              <p>
                This recovery preserves the original week and does not replace
                or erase its history.
              </p>
              {current.recovery.member_snapshot?.usable_hours && (
                <p>{current.recovery.member_snapshot.usable_hours}</p>
              )}
              {current.recovery.member_snapshot?.instructions && (
                <p>{current.recovery.member_snapshot.instructions}</p>
              )}
              <p className="fine">
                Status: {currentRecoveryStatus}. No purchase or member fee is
                required.
              </p>
              {currentRecoveryPass && current.recovery.state === "issued" && (
                <Link
                  href={`/p/${decrypt(currentRecoveryPass.token_encrypted)}`}
                  className="button"
                >
                  Open my recovery pass <ArrowUpRight size={16} />
                </Link>
              )}
            </section>
          )}

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
            </section>
          ) : current?.options.length ? (
            <DropCard supply={current.options[0]} available />
          ) : data.admission.state === "waitlisted" ? (
            <div className="member-empty">
              <h2>You’re a member and on the pilot waitlist.</h2>
              <p>
                Your membership is active. We have not promised a weekly benefit
                until backed four-week capacity opens for you.
              </p>
            </div>
          ) : data.admission.state === "admitted" ? (
            <div className="member-empty">
              <PerkIllustration />
              <h2>Your pilot place is confirmed.</h2>
              <p>
                Uptick is preparing the backed benefit for this week. It will
                appear here after the reviewed weekly release.
              </p>
            </div>
          ) : (
            <div className="member-empty">
              <PerkIllustration />
              <h2>Your free membership is active.</h2>
              <p>
                A backed pilot place is not available for this account yet. We
                will show admission here when capacity is confirmed.
              </p>
            </div>
          )}

          <MemberHelp
            grantId={current?.grant?.id || null}
            recoveryState={currentRecoveryStatus || null}
          />
          {data.admission.state === "admitted" &&
            ["pilot", "live"].includes(data.market?.state || "") && (
              <MemberInvite supplyId={data.shareableSupplyId} />
            )}
        </>
      )}
    </MemberFrame>
  );
}
