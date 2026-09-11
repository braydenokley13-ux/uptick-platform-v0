import { uptickEnvironment } from "./environment";
import type { DB } from "./db";
import { appUrl, localMode, messagingReady } from "./config";

export type ReadinessCheck = { key: string; label: string; ready: boolean };
export function platformReadiness() {
  let canonical = false;
  try {
    const url = new URL(appUrl());
    canonical =
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash;
  } catch {
    /* Invalid application URL keeps the gate closed. */
  }
  const checks: ReadinessCheck[] = [
    {
      key: "environment",
      label: "Explicit staging or production environment",
      ready: ["staging", "production"].includes(uptickEnvironment() || ""),
    },
    {
      key: "origin",
      label: "Canonical HTTPS application origin",
      ready: canonical,
    },
    {
      key: "database",
      label: "Managed PostgreSQL configured",
      ready: !!process.env.DATABASE_URL,
    },
    {
      key: "auth",
      label: "Supabase sign-in configured",
      ready: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY,
    },
    {
      key: "secrets",
      label: "Independent production encryption and session secrets",
      ready:
        (process.env.SESSION_SECRET?.length || 0) >= 32 &&
        (process.env.PASS_ENCRYPTION_KEY?.length || 0) >= 32 &&
        process.env.SESSION_SECRET !== process.env.PASS_ENCRYPTION_KEY,
    },
    {
      key: "messaging",
      label: "Twilio transport and reviewed platform approvals",
      ready: messagingReady(),
    },
    {
      key: "identity",
      label: "Legal business identity and support email configured",
      ready:
        !!process.env.BUSINESS_LEGAL_NAME?.trim() &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.SUPPORT_EMAIL || ""),
    },
    {
      key: "scheduler",
      label: "Authenticated scheduler secret configured",
      ready: (process.env.CRON_SECRET?.length || 0) >= 32,
    },
  ];
  return { ready: checks.every((check) => check.ready), checks };
}

export async function businessReadiness(db: DB, organizationId: string) {
  const [business] = await db.query<{
    is_demo: boolean;
    approved: boolean;
    service_sid: string | null;
    phone: string | null;
    sender_changed_at: string | null;
  }>(
    `select o.is_demo,coalesce(s.approved,false) approved,s.service_sid,s.phone,(select max(created_at) from audit_events a where a.organization_id=o.id and a.action='sender.configured') sender_changed_at from organizations o left join senders s on s.organization_id=o.id where o.id=$1 and 'merchant'=any(o.capabilities)`,
    [organizationId],
  );
  const platform = platformReadiness();
  const senderReady =
    !!business &&
    !business.is_demo &&
    business.approved &&
    /^MG[0-9a-fA-F]{32}$/.test(business.service_sid || "") &&
    /^\+1\d{10}$/.test(business.phone || "");
  return {
    platformReady: platform.ready,
    senderReady,
    readyToAcceptClaims: platform.ready && senderReady,
    senderChangedAt: business?.sender_changed_at || null,
    checks: [
      ...platform.checks,
      {
        key: "sender",
        label: "Real merchant with approved sender",
        ready: senderReady,
      },
    ],
  };
}

export async function assertClaimReady(db: DB, organizationId: string) {
  if (
    !localMode() &&
    !(await businessReadiness(db, organizationId)).readyToAcceptClaims
  )
    throw Error(
      "This business is not ready to accept customer claims. Please try again later.",
    );
}
export async function assertApprovalReady(db: DB, organizationId: string) {
  if (
    !localMode() &&
    !(await businessReadiness(db, organizationId)).readyToAcceptClaims
  )
    throw Error(
      "Complete production platform and merchant sender setup before approving this offer.",
    );
}
