/* Places — "Where does Uptick work around me?"

   This tab existed in the navigation and led nowhere: `?view=places` fell
   through to Home, and Home stayed lit, so tapping it looked like the app had
   ignored you. The repair is a real surface, and a deliberately narrow one.

   What it is allowed to be: the neighbourhood Uptick actually runs in, whether
   it is running, and the counters genuinely backing this member's pilot week.

   What it must never become: a browsable list of deals, stores Uptick hopes to
   sign, photographs of places nobody has vouched for, or any figure about how
   many people saw something. A benefit is promised in exactly one place — the
   weekly pass — and nothing here promises one. */
import { MapPin, Store } from "lucide-react";
import type { memberPlaces } from "@/lib/member-experience";
import { MemberState } from "./member-home";

type Data = Awaited<ReturnType<typeof memberPlaces>>;

const TONE = {
  ready: "ok",
  not_ready: "warn",
  closed: "idle",
} as const;

export function MemberPlaces({ data }: { data: Data }) {
  const { market, coverage, places, admitted, inCoverage, homeZip } = data;

  /* No Market Cell at all. Uptick runs one neighbourhood at a time, and saying
     so is better than showing an empty map that implies one is coming. */
  if (!market)
    return (
      <section className="member-places">
        <p className="eyebrow">WHERE UPTICK WORKS</p>
        <h1>
          Not your
          <br />
          <em>neighborhood yet.</em>
        </h1>
        <MemberState
          icon={<MapPin size={22} />}
          eyebrow="NOTHING NEARBY"
          title="Uptick isn't running near you yet."
          action={{ href: "/your-uptick?view=preferences", label: "Check your ZIPs" }}
        >
          <p>
            Uptick opens one neighborhood at a time. Yours isn&rsquo;t one of
            them — we&rsquo;d rather tell you that than show you places that
            aren&rsquo;t really there.
          </p>
        </MemberState>
      </section>
    );

  const operating = ["pilot", "live"].includes(market.state);

  return (
    <section className="member-places">
      <p className="eyebrow">WHERE UPTICK WORKS</p>
      <h1>
        {market.name}.
        <br />
        <em>Your neighborhood.</em>
      </h1>
      <p>
        {operating
          ? "Uptick runs one neighborhood at a time. This is the one you're in."
          : "This neighborhood is set up but isn't running yet. Nothing is being handed out here right now."}
      </p>

      {coverage.length > 0 && (
        <div className="member-places-coverage">
          <strong>ZIPs in this neighborhood</strong>
          <p>{coverage.join(" · ")}</p>
          {!inCoverage && (
            <small>
              Your home ZIP ({homeZip}) isn&rsquo;t one of them. Update your ZIPs
              if that&rsquo;s wrong.
            </small>
          )}
        </div>
      )}

      {/* The counters, only when this member's own pilot week is backed by
          them. A waitlisted member has no backed counter, and showing someone
          else's would be a promise nobody made to them. */}
      {!admitted ? (
        <MemberState
          icon={<MapPin size={22} />}
          eyebrow="NOT YET"
          title="No place is holding one for you yet."
          action={{ href: "/your-uptick", label: "Back to my Uptick" }}
        >
          <p>
            We only show you a counter once a store has actually backed a week
            for you. Until then there is nothing here we can stand behind.
          </p>
        </MemberState>
      ) : places.length ? (
        <ul className="member-places-list">
          {places.map((place) => (
            <li key={place.supplyId} className="member-history-row">
              <span className="member-round-icon">
                <Store size={20} />
              </span>
              <div>
                <strong>{place.name}</strong>
                {place.address && <p>{place.address}</p>}
                <small className={`member-places-state ${TONE[place.state]}`}>
                  {place.why}
                  {place.driveMinutes !== null
                    ? ` · about ${place.driveMinutes} min away`
                    : ""}
                </small>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="member-empty">
          <p>
            No counter is set up for your week yet. When one is, it appears here
            and we text you.
          </p>
        </div>
      )}

      <p className="fine">
        Being open doesn&rsquo;t mean something is reserved for you. Your weekly
        Uptick, when there is one, is on your pass.
      </p>
    </section>
  );
}
