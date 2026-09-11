import Link from "next/link";
import { Coffee, Gift, MapPin, ArrowUpRight, Check, Radio } from "lucide-react";
import { Brand, Badge } from "./ui";
import {
  ClaimUptick,
  InviteMember,
  MemberViewEvent,
  NavigationLinks,
  PairUptick,
} from "./member-controls";
import { TapRedeemButton } from "./tap-controls";
import { passState } from "@/lib/domain";
import { getDb } from "@/lib/db";
import { localMode } from "@/lib/config";
import type { Supply, networkPass } from "@/lib/network";
import "./member.css";
export function MemberFrame({
  children,
  privateView = false,
}: {
  children: React.ReactNode;
  privateView?: boolean;
}) {
  return (
    <div className="member-world">
      <header className="member-header">
        <Brand />
        <Link href={privateView ? "/your-uptick" : "/join"}>
          {privateView ? "Your Uptick" : "Free. Local. Yours."}
          <span className="member-status-dot" />
        </Link>
      </header>
      {localMode() && (
        <div className="member-local-label">
          LOCAL PILOT · SAMPLE PLACES · NO REAL SMS
        </div>
      )}
      <main id="main" className="member-main">
        {children}
      </main>
      <footer className="member-footer">
        <Brand small />
        <p>Good things come around.</p>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/sms">Help & SMS</Link>
          <Link href="/login">For businesses</Link>
        </div>
      </footer>
    </div>
  );
}
export function PerkIllustration({
  reward = "coffee",
  compact = false,
}: {
  reward?: string;
  compact?: boolean;
}) {
  const Icon = /coffee|drink|beverage/i.test(reward) ? Coffee : Gift;
  return (
    <div
      className={`perk-illustration ${compact ? "compact" : ""}`}
      aria-hidden="true"
    >
      <div className="perk-orbit outer" />
      <div className="perk-orbit inner" />
      <span className="perk-spark spark-one">✦</span>
      <span className="perk-spark spark-two">✦</span>
      <div className="perk-icon">
        <Icon strokeWidth={0.9} />
      </div>
      <span className="perk-art-label">A LITTLE SOMETHING GOOD</span>
    </div>
  );
}
export function DropCard({
  supply,
  token,
  alternative = false,
  available = true,
}: {
  supply: Supply;
  token: string;
  alternative?: boolean;
  available?: boolean;
}) {
  const end = new Date(supply.expires_at).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: supply.timezone,
  });
  return (
    <MemberViewEvent token={token} supplyId={supply.id}>
      <article className={`member-drop ${alternative ? "alternative" : ""}`}>
        <div className="member-drop-top">
          <p className="eyebrow">
            {alternative ? "ANOTHER GOOD OPTION" : "YOUR UPTICK"}
          </p>
          <Badge tone="amber">On the house</Badge>
        </div>
        <div className="member-drop-content">
          <div>
            <p className="member-destination">{supply.merchant}</p>
            <h2>{supply.reward.replace(/^Get (a |an )?/i, "")}</h2>
            <p className="member-condition">{supply.qualification}</p>
            <p className="member-distance">
              <MapPin size={13} />
              {supply.drive_minutes
                ? `About ${supply.drive_minutes} min · local estimate`
                : "In your local Market"}
            </p>
          </div>
          <PerkIllustration reward={supply.reward} compact={alternative} />
        </div>
        <div className="member-drop-bottom">
          <span>Ends {end}</span>
          {supply.inventory_policy === "unlimited" ? (
            <span>While available</span>
          ) : (
            <span>Limited quantity</span>
          )}
        </div>
        <ClaimUptick token={token} supplyId={supply.id} disabled={!available} />
        <details className="member-fine-details">
          <summary>The details</summary>
          <p>{supply.terms}</p>
          <p>
            {supply.inventory_policy === "timed"
              ? `Your claim reserves one for ${supply.reservation_minutes} minutes, within the Drop’s dates.`
              : supply.inventory_policy === "claim"
                ? "Your claim reserves one until this Drop ends."
                : "A claim saves your pass. The item is available until the redemption quantity is reached."}
          </p>
          <p>{supply.address}</p>
          <p className="fine">
            Chosen for your local area
            {typeof supply.reason?.recentMerchantRedemptions28d === "number"
              ? " and variety across your recent Uptick visits"
              : ""}
            . Travel time is an operator estimate, not live routing.
          </p>
        </details>
        {!alternative && (
          <NavigationLinks
            address={supply.address}
            latitude={supply.latitude}
            longitude={supply.longitude}
            token={token}
            supplyId={supply.id}
          />
        )}
      </article>
    </MemberViewEvent>
  );
}
export async function NetworkPass({
  data,
  token,
}: {
  data: NonNullable<Awaited<ReturnType<typeof networkPass>>>;
  token: string;
}) {
  const { claim, supply, mapping } = data;
  const reservationExpired =
    mapping.reserved_until && new Date(mapping.reserved_until) <= new Date();
  const state =
    claim.state === "active" && reservationExpired
      ? "expired"
      : passState(claim);
  const [evidence] = await (
    await getDb()
  ).query<{
    method: string;
    verification_level: number;
    staff_gated: boolean;
  }>("select * from redemption_evidence where claim_id=$1", [claim.id]);
  const active = state === "active";
  return (
    <MemberFrame privateView>
      <div className="member-pass-heading">
        <Link href="/your-uptick">← Your Uptick</Link>
        <p className="eyebrow">YOUR PRIVATE PASS</p>
      </div>
      <article
        className={`member-pass ${state === "redeemed" ? "member-pass-redeemed" : ""}`}
      >
        <div className="member-drop-top">
          <p className="eyebrow">{claim.snapshot.merchant}</p>
          <Badge tone={state === "redeemed" || active ? "mint" : "neutral"}>
            {state === "redeemed"
              ? "Redeemed"
              : active
                ? "Ready to visit"
                : state}
          </Badge>
        </div>
        {state === "redeemed" ? (
          <div className="member-redemption-success" role="status">
            <span>
              <Check size={42} />
            </span>
            <p className="eyebrow">UPTICK REDEEMED</p>
            <h1>
              Good things.
              <br />
              <em>Enjoy yours.</em>
            </h1>
            <p>{claim.snapshot.reward}</p>
            <strong>
              {new Date(claim.redeemed_at!).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
                timeZone: claim.snapshot.timezone,
              })}
            </strong>
            <p>
              {evidence?.method === "secure_nfc"
                ? "Authenticated NFC credential recorded"
                : evidence?.method === "qr"
                  ? "Location QR credential recorded"
                  : evidence?.method === "self_confirm"
                    ? "Self-confirmed redemption"
                    : evidence?.method === "operator_override"
                      ? "Operator exception recorded"
                      : "Redemption recorded"}
            </p>
            <p className="fine">
              One redemption recorded. This pass cannot be used again.
            </p>
          </div>
        ) : (
          <>
            <PerkIllustration reward={claim.snapshot.reward} />
            <h1>{claim.snapshot.reward.replace(/^Get (a |an )?/i, "")}</h1>
            <p className="member-condition">{claim.snapshot.qualification}</p>
            <p className="member-address">
              <MapPin size={14} />
              {claim.snapshot.address}
            </p>
            <div className="member-perforation" />
            <div className="member-tap-instructions">
              <span className="member-round-icon">
                <Radio size={25} />
              </span>
              <h2>{active ? "At the store?" : "This pass has ended."}</h2>
              <p>
                {active
                  ? "Tap the Uptick sign or scan its QR. Your saved pass and the store’s redemption point work together."
                  : reservationExpired
                    ? "The reservation window ended. No redemption was recorded."
                    : "Check Your Uptick for your current local perk."}
              </p>
              {active && (
                <>
                  <ol>
                    <li>
                      {supply.verification_mode === "staff_tap"
                        ? "Show the cashier your qualifying purchase."
                        : "Head to the participating store."}
                    </li>
                    <li>
                      {supply.verification_mode === "staff_tap"
                        ? "The cashier presents the Uptick sign."
                        : "Find the Uptick sign at the counter."}
                    </li>
                    <li>Tap or scan. Wait for the green redeemed screen.</li>
                  </ol>
                  <PairUptick token={token} />
                  {supply.verification_mode === "self_confirm" &&
                    supply.self_confirm_approved && (
                      <div className="member-self-confirm">
                        <p className="fine">
                          This store and Uptick approved self-confirmation for
                          this Drop.
                        </p>
                        <TapRedeemButton passToken={token} selfConfirm />
                      </div>
                    )}
                </>
              )}
            </div>
          </>
        )}
        <div className="member-pass-facts">
          <div>
            <span>Pass reference</span>
            <strong>UP-{claim.id.slice(-6).toUpperCase()}</strong>
          </div>
          <div>
            <span>
              {mapping.reserved_until ? "Reserved until" : "Available through"}
            </span>
            <strong>
              {new Date(
                mapping.reserved_until || claim.snapshot.expires_at,
              ).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZone: claim.snapshot.timezone,
              })}
            </strong>
          </div>
        </div>
        <details className="member-fine-details">
          <summary>Offer terms</summary>
          <p>{claim.snapshot.terms}</p>
          <p>
            {supply.inventory_policy === "redemption"
              ? "Your pass does not reserve inventory. Available until the recorded redemption limit is reached."
              : "This pass follows the reservation terms saved when you claimed."}
          </p>
        </details>
        {active && (
          <NavigationLinks
            address={claim.snapshot.address}
            latitude={supply.latitude}
            longitude={supply.longitude}
            passToken={token}
          />
        )}
      </article>
      <div className="member-next-note">
        <p className="eyebrow">THERE’S MORE GOOD TO COME</p>
        <h3>Your next Uptick starts here.</h3>
        <p>
          One local perk, chosen for you. Keep your private membership link for
          your next Drop.
        </p>
        <Link className="text-link" href="/your-uptick">
          Back to Your Uptick
          <ArrowUpRight size={15} />
        </Link>
      </div>
    </MemberFrame>
  );
}
export function MemberInvite({
  token,
  supplyId,
}: {
  token: string;
  supplyId?: string;
}) {
  return (
    <div className="member-invite">
      <div>
        <p className="eyebrow">GOOD THINGS TRAVEL</p>
        <h3>Better with someone nearby.</h3>
        <p>Invite a friend to discover their own Uptick.</p>
      </div>
      <InviteMember token={token} supplyId={supplyId} />
    </div>
  );
}
