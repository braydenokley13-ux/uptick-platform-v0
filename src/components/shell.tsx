import Link from "next/link";
import {
  LayoutDashboard,
  Gift,
  ChartNoAxesCombined,
  Store,
  Radio,
  ClipboardCheck,
  MessageSquare,
  Users,
  History,
  Plus,
  ArrowUpRight,
  LifeBuoy,
  ShieldCheck,
  FlaskConical,
} from "lucide-react";
import { Brand, Badge } from "./ui";
import { ActionButton } from "./forms";
import type { Actor } from "@/lib/domain";
import { localMode } from "@/lib/config";
const merchantLinks = [
  ["", "Home", LayoutDashboard],
  ["anchor", "Your offer", Gift],
  ["network", "Your local network", Radio],
  ["drops", "Weekly Drops", Gift],
  ["audience", "Your audience", Users],
  ["results", "Results", ChartNoAxesCombined],
  ["plan", "Growth Plan", ClipboardCheck],
  ["calendar", "Next 30 days", History],
] as const;
const operatorLinks = [
  ["", "Control center", LayoutDashboard],
  ["businesses", "Businesses", Store],
  ["placements", "Placements & QR", Radio],
  ["offers", "Offers", Gift],
  ["review", "Review queue", ClipboardCheck],
  ["messages", "Messages", MessageSquare],
  ["customers", "Customers", Users],
  ["audit", "Audit history", History],
  ["onboarding", "Launch a merchant", Plus],
  ["creatives", "Screen creative", Radio],
  ["testing", "Internal testing", FlaskConical],
] as const;
export function Shell({
  actor,
  active,
  name,
  children,
}: {
  actor: Actor;
  active: string;
  name: string;
  children: React.ReactNode;
}) {
  const operator = actor.role === "operator";
  const base = operator ? "/operator" : "/merchant";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">
          <span className="eyebrow">
            {operator ? "UPTICK OPERATIONS" : "YOUR GROWTH WORKSPACE"}
          </span>
        </div>
        <nav aria-label="Main navigation">
          {(operator ? operatorLinks : merchantLinks).map(
            ([path, label, Icon]) => (
              <Link
                href={`${base}/${path}`}
                key={path}
                className={active === path ? "nav-item active" : "nav-item"}
                aria-current={active === path ? "page" : undefined}
              >
                <Icon size={18} strokeWidth={1.6} />
                <span>{label}</span>
                {active === path && <span className="nav-dot" />}
              </Link>
            ),
          )}
        </nav>
        {!operator && (
          <Link className="nav-create" href="/merchant/create">
            <Plus size={17} />
            Offer Studio
          </Link>
        )}
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="mini-network" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <p>
              Good things
              <br />
              <em>come around.</em>
            </p>
          </div>
          <Link className="nav-item" href="/sms">
            <LifeBuoy size={17} />
            Help & support
            <ArrowUpRight size={14} />
          </Link>
          <div className="identity">
            <span className="avatar">
              {operator
                ? "UL"
                : name
                    .split(/\s+/)
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
            </span>
            <div>
              <strong>{operator ? "Uptick Local" : name}</strong>
              <small>
                {operator ? "Operator workspace" : "Merchant workspace"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span>{operator ? "Uptick Operator" : "Uptick Growth"}</span>
            <span className="top-divider">/</span>
            <strong>{name}</strong>
          </div>
          <div>
            {localMode() ? (
              <div className="local-workspace-label">
                <Badge>Local sample</Badge>
              </div>
            ) : (
              <Badge tone="mint">
                <ShieldCheck size={12} />
                Secure workspace
              </Badge>
            )}
            <ActionButton action="logout" secondary>
              Sign out
            </ActionButton>
          </div>
        </header>
        <main id="main" className="workspace-main">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>UPTICK LOCAL</span>
          <span>Measure what happened. Build on what works.</span>
        </footer>
      </div>
    </div>
  );
}
