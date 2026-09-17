/* Uptick system primitives.
   Shared by member, merchant and operator so the three products read as one.
   Every primitive is data-driven: none of them can display a number without
   also displaying what that number is measured against. */
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type Tone = "ok" | "warn" | "bad" | "idle";

export function Dot({ tone = "idle" }: { tone?: Tone }) {
  return <span className={`u-dot ${tone}`} aria-hidden="true" />;
}

export function Pill({
  tone = "idle",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return <span className={`u-pill ${tone}`}>{children}</span>;
}

/** A number with its basis. `foot` is required: a bare figure is not a fact. */
export function Stat({
  label,
  value,
  foot,
  tone,
  attention,
}: {
  label: string;
  value: React.ReactNode;
  foot: React.ReactNode;
  tone?: Tone;
  attention?: boolean;
}) {
  return (
    <div className={attention ? "u-stat attention" : "u-stat"}>
      <span className="u-stat-label">{label}</span>
      <span className="u-stat-value">{value}</span>
      <span className={tone ? `u-stat-foot ${tone}` : "u-stat-foot"}>
        {foot}
      </span>
    </div>
  );
}

export function SectionHead({
  title,
  action,
  href,
}: {
  title: string;
  action?: string;
  href?: string;
}) {
  return (
    <div className="u-head">
      <h2>{title}</h2>
      {action &&
        (href ? (
          <Link href={href}>
            {action} <ChevronRight size={13} />
          </Link>
        ) : (
          <span className="u-head-action">{action}</span>
        ))}
    </div>
  );
}

/** Dot + what it is + why it is in that state. `why` carries the constraint. */
export function Row({
  tone,
  title,
  why,
  end,
}: {
  tone?: Tone;
  title: React.ReactNode;
  why?: React.ReactNode;
  end?: React.ReactNode;
}) {
  return (
    <div className="u-row">
      <Dot tone={tone} />
      <div className="u-row-body">
        <strong>{title}</strong>
        {why && <small>{why}</small>}
      </div>
      {end && <div className="u-row-end">{end}</div>}
    </div>
  );
}

export function Notice({
  tone = "calm",
  icon,
  title,
  children,
}: {
  tone?: Tone | "calm";
  icon?: React.ReactNode;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`u-notice ${tone}`}>
      {icon && <span className="u-notice-icon">{icon}</span>}
      <div>
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

export function Empty({
  mark,
  title,
  children,
}: {
  mark?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="u-empty">
      {mark && <span className="u-empty-mark">{mark}</span>}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Previous/next week. A missing href renders a disabled stub, never a dead link. */
export function WeekSwitch({
  label,
  prev,
  next,
}: {
  label: string;
  prev?: string;
  next?: string;
}) {
  return (
    <div className="u-weekswitch">
      {prev ? (
        <Link href={prev} aria-label="Previous week" scroll={false}>
          <ChevronLeft size={16} />
        </Link>
      ) : (
        <span className="u-weekswitch-stub" aria-hidden="true">
          <ChevronLeft size={16} />
        </span>
      )}
      <span className="u-weekswitch-label">{label}</span>
      {next ? (
        <Link href={next} aria-label="Next week" scroll={false}>
          <ChevronRight size={16} />
        </Link>
      ) : (
        <span className="u-weekswitch-stub" aria-hidden="true">
          <ChevronRight size={16} />
        </span>
      )}
    </div>
  );
}

/* A drawn row of local storefronts under a warm sky. Illustration, not
   photography, so it never implies a specific real business and never delays
   a paint. Decorative: hidden from assistive technology. */
export function Scene({
  script,
  caption,
  height = 110,
}: {
  script?: string;
  caption?: string;
  height?: number;
}) {
  return (
    <div className="u-scene" style={{ minHeight: height }}>
      <svg
        viewBox="0 0 900 150"
        preserveAspectRatio="xMidYMax slice"
        aria-hidden="true"
        style={{ height }}
      >
        <defs>
          <linearGradient id="u-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f6ead5" />
            <stop offset="100%" stopColor="#eef1e6" />
          </linearGradient>
        </defs>
        <rect width="900" height="150" fill="url(#u-sky)" />
        {/* distant treeline */}
        <g fill="#cfdcc9" opacity="0.75">
          {Array.from({ length: 18 }).map((_, i) => (
            <polygon
              key={i}
              points={`${i * 52},112 ${i * 52 + 17},${72 + (i % 3) * 9} ${i * 52 + 34},112`}
            />
          ))}
        </g>
        {/* storefront row */}
        <g>
          {[
            { x: 40, w: 118, h: 54, roof: "#2f6b57", face: "#fdfaf4" },
            { x: 172, w: 92, h: 44, roof: "#c8893f", face: "#fbf5ea" },
            { x: 278, w: 132, h: 62, roof: "#1f4a3d", face: "#fdfaf4" },
            { x: 424, w: 100, h: 48, roof: "#b0553f", face: "#fbf3ec" },
            { x: 538, w: 124, h: 56, roof: "#2f6b57", face: "#fdfaf4" },
            { x: 676, w: 88, h: 42, roof: "#c8893f", face: "#fbf5ea" },
            { x: 778, w: 104, h: 52, roof: "#1f4a3d", face: "#fdfaf4" },
          ].map((b, i) => (
            <g key={i}>
              <rect
                x={b.x}
                y={112 - b.h}
                width={b.w}
                height={b.h}
                fill={b.face}
                stroke="#dcd2c0"
              />
              <rect
                x={b.x - 5}
                y={112 - b.h - 9}
                width={b.w + 10}
                height={10}
                rx="2"
                fill={b.roof}
              />
              {/* windows, warm and lit */}
              <rect
                x={b.x + 12}
                y={112 - b.h + 16}
                width={b.w * 0.3}
                height={b.h * 0.42}
                fill="#f7e2b8"
                opacity="0.9"
              />
              <rect
                x={b.x + b.w * 0.55}
                y={112 - b.h + 16}
                width={b.w * 0.28}
                height={b.h * 0.42}
                fill="#f7e2b8"
                opacity="0.75"
              />
            </g>
          ))}
        </g>
        {/* street */}
        <rect x="0" y="112" width="900" height="38" fill="#e7e0d1" />
        <g stroke="#d6cdba" strokeWidth="2" strokeDasharray="14 12">
          <line x1="0" y1="133" x2="900" y2="133" />
        </g>
      </svg>
      {(script || caption) && (
        <div className="u-scene-copy">
          <span
            style={{
              fontSize: 12,
              color: "var(--muted)",
              background: "#ffffffcc",
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            {caption}
          </span>
          {script && <span className="u-script">{script}</span>}
        </div>
      )}
    </div>
  );
}
