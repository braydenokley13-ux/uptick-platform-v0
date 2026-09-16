import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowUpRight, Check, Clock3, Gift, MapPin } from "lucide-react";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/security";
import { memberHome, memberPlaces } from "@/lib/member-experience";
import { MEMBER_SESSION_COOKIE } from "@/lib/member-session";
import { MemberPrivacyRequest } from "@/components/member-privacy";
import { memberPrivacyRequests } from "@/lib/privacy-admin";
import { MemberInvite } from "@/components/member-ui";
import { MemberPlaces } from "@/components/member-places";
import { activeMemberTab, memberView } from "@/lib/member-views";
import {
  MemberShell,
  MemberState,
  MemberNote,
  UptickReveal,
} from "@/components/member-home";
import {
  ClaimUptick,
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
  /* Anything that is not a real view is Home, including the greeting. An
     unrecognised value used to render Home with `greet` suppressed, so a typo
     or a stale link produced a subtly broken page rather than the home one. */
  const view = memberView((await searchParams).view);
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
  /* A make-good's own state and expiry decide this. It previously read
     "expired" whenever the recovery was missing from outstandingRecoveries —
     but that list is filtered to unsuperseded, unexpired rows that join
     through an original claim, and capped at ten, so absence from it means
     several different things and only one of them is expiry. A live make-good
     whose original_claim_id was never bound (the column is nullable) was being
     told to the member as expired while it was still usable. */
  const currentRecovery = current?.recovery;
  const currentRecoveryStatus = !currentRecovery
    ? undefined
    : currentRecovery.state === "redeemed"
      ? "redeemed"
      : currentRecovery.expires_at &&
          new Date(currentRecovery.expires_at) <= new Date()
        ? "expired"
        : "issued";

  return (
    <MemberShell
      /* Every tab in the bottom bar has to light its own view. `places` used
         to fall through to Home, so the one tab that changed nothing also
         looked like it had not been pressed. */
      active={activeMemberTab(view)}
      greet={!view}
      subtitle={
        data.serviceStatus?.blocks_future_release
          ? "Your future weekly releases are paused. Anything already issued still works."
          : saved?.state === "redeemed"
            ? "You picked this one up. Nice."
            : saved
              ? "Your pass is saved and ready."
              : current?.options.length
                ? "Your weekly Uptick is here."
                : "Your membership is active."
      }
    >
      {view === "places" ? (
        <MemberPlaces data={await memberPlaces(await getDb(), credential)} />
      ) : view === "preferences" ? (
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
          <MemberPrivacyRequest
            requests={await memberPrivacyRequests(
              await getDb(),
              data.member.id,
            )}
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
            <>
              <UptickReveal
                tone={saved.state === "redeemed" ? "redeemed" : "saved"}
                benefit={saved.snapshot.reward}
                merchant={saved.snapshot.merchant}
                endsLabel={
                  saved.state === "redeemed"
                    ? "Enjoyed this week"
                    : "Ready at the counter"
                }
                href={`/p/${decrypt(saved.token_encrypted)}`}
                cta={
                  saved.state === "redeemed"
                    ? "View my redemption"
                    : "Open my pass"
                }
              />
              <MemberNote />
            </>
          ) : current?.options.length ? (
            <>
              <UptickReveal
                benefit={current.options[0].reward}
                merchant={current.options[0].merchant}
                qualification={current.options[0].qualification}
                driveMinutes={current.options[0].drive_minutes}
                endsLabel={`Through ${new Date(
                  current.options[0].expires_at,
                ).toLocaleDateString("en-US", {
                  weekday: "long",
                  timeZone: current.options[0].timezone,
                })}`}
                /* Claiming writes a pass; it is not a page you can navigate
                   to. This previously linked to /u/<supplyId>, but /u/[token]
                   resolves a member access token, so the one CTA in the whole
                   member journey that turns a benefit into a pass led to a
                   URL that could never resolve. */
                action={<ClaimUptick supplyId={current.options[0].id} />}
              />
              <MemberNote />
            </>
          ) : data.serviceStatus?.blocks_future_release ? (
            <MemberState
              tone="care"
              icon={<Clock3 size={22} />}
              eyebrow="YOUR MEMBERSHIP IS SAFE"
              title="Your weekly Uptick is paused."
              action={{ href: "/sms", label: "Talk to us" }}
            >
              <p>
                Nothing you have already been given goes away, and your record
                stays exactly as it is.
              </p>
              <p>
                Status: {data.serviceStatus.kind.replaceAll("_", " ")}. Tell us
                whenever you would like to come back.
              </p>
            </MemberState>
          ) : data.admission.state === "waitlisted" ? (
            <MemberState
              tone="waiting"
              icon={<Clock3 size={22} />}
              eyebrow="YOU'RE A MEMBER"
              title="You're next in line."
              action={{
                href: "/your-uptick?view=preferences",
                label: "Check your ZIPs",
              }}
            >
              <p>
                Your membership is active. We only promise a weekly Uptick once
                a nearby store has actually backed one for you — so we have not
                promised you one yet.
              </p>
              <p>You will get a text the moment a place opens.</p>
            </MemberState>
          ) : data.admission.state === "admitted" ? (
            <MemberState
              tone="waiting"
              icon={<Gift size={22} />}
              eyebrow="YOUR PLACE IS CONFIRMED"
              title="Something good is on its way."
              action={{
                href: "/your-uptick?view=history",
                label: "See your good things",
              }}
            >
              <p>
                A nearby store is getting this week&rsquo;s Uptick ready. It
                lands here as soon as it is confirmed, and we will text you.
              </p>
            </MemberState>
          ) : (
            <MemberState
              icon={<MapPin size={22} />}
              eyebrow="YOUR MEMBERSHIP IS ACTIVE"
              title="We're still building your neighborhood."
              action={{
                href: "/your-uptick?view=preferences",
                label: "Update your ZIPs",
              }}
            >
              <p>
                Uptick runs one neighborhood at a time. Yours does not have a
                backed pilot place yet — we would rather tell you that than
                promise something no store has agreed to.
              </p>
            </MemberState>
          )}

          <MemberHelp
            grantId={current?.grant?.id || null}
            recoveryState={currentRecoveryStatus || null}
          />
          {data.admission.state === "admitted" &&
            !data.serviceStatus?.blocks_future_release &&
            ["pilot", "live"].includes(data.market?.state || "") && (
              <MemberInvite supplyId={data.shareableSupplyId} />
            )}
        </>
      )}
    </MemberShell>
  );
}
