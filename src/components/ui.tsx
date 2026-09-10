import Link from "next/link";
import { ArrowUpRight, ArrowRight, Coffee, Check, MapPin } from "lucide-react";
import type { ReactNode } from "react";
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${small ? "small" : ""}`}
      aria-label="Uptick Local home"
    >
      <span className="brand-dot" />
      <span>
        uptick<span className="brand-local">LOCAL</span>
      </span>
    </Link>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "mint" | "amber" | "neutral";
}) {
  return (
    <span className={`badge ${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lead">{description}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </header>
  );
}
export function ButtonLink({
  href,
  children,
  quiet = false,
}: {
  href: string;
  children: ReactNode;
  quiet?: boolean;
}) {
  return (
    <Link href={href} className={`button ${quiet ? "secondary" : ""}`}>
      {children}
      <ArrowUpRight size={16} />
    </Link>
  );
}
export function Metric({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: number | string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className={`metric ${accent ? "accent-metric" : ""}`}>
      <p className="eyebrow">{label}</p>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <ArrowUpRight size={22} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function CoffeeArt() {
  return (
    <div className="coffee-art" aria-hidden="true">
      <div className="orbit" />
      <Coffee strokeWidth={1.05} size={88} />
      <span className="coffee-tag">ON THE HOUSE</span>
    </div>
  );
}
export function Footer() {
  return (
    <footer className="customer-footer">
      <Brand small />
      <div>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/sms">SMS & help</Link>
      </div>
      <p>No app. No account. Just something good nearby.</p>
    </footer>
  );
}
export function Steps() {
  return (
    <ol className="redeem-steps">
      <li>
        <span>01</span>
        <div>
          <strong>Make your qualifying purchase</strong>
          <p>Keep your receipt handy.</p>
        </div>
      </li>
      <li>
        <span>02</span>
        <div>
          <strong>Show the cashier your receipt</strong>
          <p>Wait until they’re ready.</p>
        </div>
      </li>
      <li>
        <span>03</span>
        <div>
          <strong>Redeem together</strong>
          <p>Tap below with the cashier watching.</p>
        </div>
      </li>
    </ol>
  );
}
export function Location({ address }: { address: string }) {
  return (
    <p className="location">
      <MapPin size={14} />
      {address}
    </p>
  );
}
export function SuccessIcon() {
  return (
    <span className="success-icon">
      <Check size={30} />
    </span>
  );
}
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" href={href}>
      {children}
      <ArrowRight size={15} />
    </Link>
  );
}
