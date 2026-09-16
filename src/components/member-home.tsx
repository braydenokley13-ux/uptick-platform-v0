/* The member's weekly moment.

   One good thing. One clear next action. Everything else gets out of the way.

   The reveal is the only place in Uptick that is allowed to feel like an
   occasion: it is the thing a member opens a text message to see. Every other
   member state reuses the same card so that a waitlist, a pause or an outage
   still feels like somewhere Uptick is looking after you — never a dead end,
   and never an error with no way forward. */
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Clock3,
  Coffee,
  Gift,
  Heart,
  House,
  LifeBuoy,
  MapPin,
  Ticket,
  User,
} from "lucide-react";
import { Brand } from "./ui";
import { localMode } from "@/lib/config";
import { memberTabs } from "@/lib/member-views";
import "./member-home.css";

/* The bar itself lives in src/lib/member-views.ts, alongside the views the
   page renders, so a tab cannot exist without somewhere to land. Icons are the
   only thing this file adds. */
const TAB_ICON: Record<string, typeof House> = {
  Home: House,
  Uptick: Ticket,
  Places: MapPin,
  Support: LifeBuoy,
  Profile: User,
};

/** App-like chrome. The bottom bar is the member's whole navigation. */
export function MemberShell({
  active = "Home",
  greet = false,
  subtitle,
  children,
}: {
  active?: string;
  /* Uptick stores no member name, so the greeting stays warm without inventing one. */
  greet?: boolean;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mh">
      <header className="mh-top">
        <Brand />
        <Link
          href="/sms"
          className="mh-bell"
          aria-label="Notifications and help"
        >
          <Bell size={18} />
        </Link>
      </header>
      {localMode() && (
        <p className="mh-label">LOCAL PILOT · SAMPLE PLACES · NO REAL SMS</p>
      )}
      <main id="main" className="mh-main">
        {greet && (
          <div className="mh-greet">
            <h1>{greeting()}.</h1>
            {subtitle && <p className="mj-lede">{subtitle}</p>}
          </div>
        )}
        {children}
      </main>
      <nav className="mh-tabs" aria-label="Member navigation">
        {memberTabs.map(({ href, label }) => {
          const Icon = TAB_ICON[label];
          return (
          <Link
            key={label}
            href={href}
            className={active === label ? "active" : undefined}
            aria-current={active === label ? "page" : undefined}
          >
            <Icon size={19} strokeWidth={1.7} />
            <span>{label}</span>
          </Link>
          );
        })}
      </nav>
    </div>
  );
}

function greeting(at = new Date()) {
  const hour = at.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/* A drawn scene behind the benefit name. Illustration rather than photography:
   Uptick never shows a picture of a store it cannot vouch for. */
function RevealScene({ reward }: { reward: string }) {
  const coffee = /coffee|drink|beverage|tea|water/i.test(reward);
  return (
    <div className="mh-scene" aria-hidden="true">
      <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="mh-morning" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0%" stopColor="#f6dfb4" />
            <stop offset="55%" stopColor="#e8c79a" />
            <stop offset="100%" stopColor="#c98f5e" />
          </linearGradient>
          <radialGradient id="mh-sun" cx="76%" cy="24%" r="34%">
            <stop offset="0%" stopColor="#fff3d6" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#fff3d6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="240" fill="url(#mh-morning)" />
        <circle cx="304" cy="58" r="120" fill="url(#mh-sun)" />
        {/* soft neighbourhood horizon */}
        <g opacity="0.24" fill="#5c3b1f">
          <rect x="0" y="150" width="70" height="90" />
          <rect x="74" y="168" width="52" height="72" />
          <rect x="132" y="142" width="80" height="98" />
          <rect x="218" y="172" width="58" height="68" />
          <rect x="282" y="156" width="66" height="84" />
          <rect x="352" y="176" width="48" height="64" />
        </g>
        {/* the thing itself */}
        <g transform="translate(200 128)">
          {coffee ? (
            <g>
              <ellipse cx="0" cy="66" rx="70" ry="10" fill="#0000001a" />
              <path
                d="M-40 -18h74v46a26 26 0 0 1-26 26h-22a26 26 0 0 1-26-26z"
                fill="#fffaf1"
                stroke="#8a5a32"
                strokeWidth="3"
              />
              <path
                d="M34 -6h13a17 17 0 0 1 0 34h-13"
                fill="none"
                stroke="#8a5a32"
                strokeWidth="3"
              />
              <path d="M-36 -8h66v12h-66z" fill="#c98f5e" opacity="0.5" />
              <g
                stroke="#fffaf1"
                strokeWidth="3.4"
                strokeLinecap="round"
                opacity="0.85"
                fill="none"
              >
                <path d="M-16 -34c6-8-6-14 0-22" />
                <path d="M2 -38c6-8-6-14 0-22" />
                <path d="M20 -34c6-8-6-14 0-22" />
              </g>
            </g>
          ) : (
            <g>
              <ellipse cx="0" cy="66" rx="70" ry="10" fill="#0000001a" />
              <rect
                x="-46"
                y="-10"
                width="92"
                height="72"
                rx="6"
                fill="#fffaf1"
                stroke="#8a5a32"
                strokeWidth="3"
              />
              <rect
                x="-46"
                y="-10"
                width="92"
                height="20"
                fill="#c98f5e"
                opacity="0.55"
              />
              <path d="M0 -10v72" stroke="#8a5a32" strokeWidth="3" />
              <path
                d="M0 -12c-16-22-42-8-26 6M0 -12c16-22 42-8 26 6"
                fill="none"
                stroke="#8a5a32"
                strokeWidth="3"
              />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}

/** The weekly reveal. */
export function UptickReveal({
  benefit,
  merchant,
  qualification,
  driveMinutes,
  endsLabel,
  href,
  action,
  cta = "View your pass",
  tone = "ready",
}: {
  benefit: string;
  merchant: string;
  qualification?: string;
  driveMinutes?: number | null;
  endsLabel?: string;
  /** Where to go when the pass already exists. */
  href?: string;
  /** What to do when it does not yet — claiming is a write, not a link. */
  action?: React.ReactNode;
  cta?: string;
  tone?: "ready" | "saved" | "redeemed" | "recovery";
}) {
  return (
    <article className={`mh-reveal ${tone} u-rise`}>
      <RevealScene reward={benefit} />
      <div className="mh-reveal-body">
        <p className="mh-reveal-eyebrow">
          {tone === "recovery"
            ? "YOUR MAKE-GOOD"
            : tone === "redeemed"
              ? "ENJOYED"
              : tone === "saved"
                ? "SAVED AND READY"
                : "YOUR WEEKLY UPTICK"}
        </p>
        <h2>{benefit}</h2>
        <p className="mh-reveal-where">at {merchant}</p>
        <p className="mh-reveal-meta">
          {/* An operator types this estimate in when a location joins a market
              cell; nothing measures it. "12 min away" reads as a measurement,
              so it says "about" — the same word the Places tab uses. */}
          {driveMinutes ? <span>about {driveMinutes} min away</span> : null}
          {endsLabel ? <span>{endsLabel}</span> : null}
          {qualification ? <span>{qualification}</span> : null}
        </p>
        {action ??
          (href ? (
            <Link href={href} className="mh-cta">
              {cta}
              <ArrowRight size={17} />
            </Link>
          ) : null)}
      </div>
    </article>
  );
}

/** Every non-reveal state. Always warm, always with a next action. */
export function MemberState({
  eyebrow,
  title,
  children,
  icon,
  action,
  tone = "calm",
}: {
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  action?: { href: string; label: string };
  tone?: "calm" | "waiting" | "care";
}) {
  return (
    <section className={`mh-state ${tone} u-rise`}>
      <span className="mh-state-mark">{icon || <Gift size={22} />}</span>
      {eyebrow && <p className="mh-reveal-eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      <div className="mh-state-body">{children}</div>
      {action && (
        <Link href={action.href} className="mh-cta ghost">
          {action.label}
          <ArrowRight size={16} />
        </Link>
      )}
    </section>
  );
}

/** The quiet line under the reveal. */
export function MemberNote() {
  return (
    <div className="mh-note">
      <span>
        <Heart size={15} />
      </span>
      <div>
        <strong>A little good goes a long way.</strong>
        <small>Every Uptick is backed by a real store nearby.</small>
      </div>
    </div>
  );
}

export const MemberIcons = { Coffee, Clock3, MapPin, Gift };
