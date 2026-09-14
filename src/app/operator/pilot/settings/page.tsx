import Link from "next/link";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { uptickEnvironment } from "@/lib/environment";
import { appUrl } from "@/lib/config";
import { memberMessagingReadiness } from "@/lib/member-messaging";
import { scheduledJobHealth } from "@/lib/scheduled-jobs";
import { Shell } from "@/components/shell";
import { Badge, PageHeading } from "@/components/ui";
import "@/components/network-operations.css";
export const dynamic = "force-dynamic";
export default async function PilotSettings() {
  const actor = await requireActor(true),
    db = await getDb();
  const [jobs, messaging, migrations] = await Promise.all([
    scheduledJobHealth(db),
    memberMessagingReadiness(db),
    db.query<{ name: string }>(
      "select name from schema_migrations order by name desc limit 1",
    ),
  ]);
  const checks = [
    ["Canonical app origin", appUrl() === "https://pilot.upticklocal.com"],
    ["Dedicated database connection", !!process.env.DATABASE_URL],
    ["Legal entity supplied", !!process.env.BUSINESS_LEGAL_NAME],
    ["Monitored support address configured", !!process.env.SUPPORT_EMAIL],
    ["Legal approval recorded", process.env.LEGAL_APPROVED === "true"],
    ["Operator MFA required", process.env.OPERATOR_MFA_REQUIRED === "true"],
    [
      "Real enrollment enabled",
      process.env.PILOT_ENROLLMENT_ENABLED === "true",
    ],
    [
      "Promotional delivery enabled",
      process.env.PRODUCTION_DELIVERY_ENABLED === "true",
    ],
  ] as const;
  return (
    <Shell actor={actor} active="pilot/settings" name="Pilot settings">
      <div className="network-operations">
        <PageHeading
          eyebrow="RELEASE & OPERATING SAFETY"
          title="Know what is ready."
          description="Deployment, messaging approval and a stocked counter are separate checks."
        />
        <section className="panel network-panel">
          <h2>Current environment</h2>
          <p>
            Environment: {uptickEnvironment() || "Not configured"}. App origin:{" "}
            {appUrl()}. Latest migration:{" "}
            {migrations[0]?.name || "Not recorded"}.
          </p>
          <p>
            Release:{" "}
            {process.env.VERCEL_GIT_COMMIT_SHA ||
              "Local / release SHA not supplied"}
            .
          </p>
          {checks.map(([name, ok]) => (
            <div className="network-status-row" key={name}>
              <Badge tone={ok ? "mint" : "amber"}>
                {ok ? "Configured" : "Not configured"}
              </Badge>
              <p>{name}</p>
            </div>
          ))}
          <p>
            These are configuration checks. They do not certify legal review,
            real carrier delivery, backup restoration or physical fulfillment.
          </p>
        </section>
        <section className="panel network-panel">
          <h2>Scheduled jobs</h2>
          <p>
            Preparation runs every five minutes in batches of 25. Sending
            processes at most two messages per minute. Legacy outbound is not
            scheduled. Interrupted or uncertain sends are not automatically
            retried.
          </p>
          {jobs.length ? (
            jobs.map((job) => (
              <article key={job.job_key}>
                <h3>{job.job_key.replaceAll("_", " ")}</h3>
                <p>
                  Last outcome: {job.state}. Processed: {job.processed}. Last
                  success:{" "}
                  {job.last_success
                    ? new Date(job.last_success).toISOString()
                    : "Never"}
                  . {job.error_code && `Attention: ${job.error_code}.`}
                </p>
              </article>
            ))
          ) : (
            <p>
              No scheduler run recorded. Verify the authenticated hosted cron
              before launch.
            </p>
          )}
        </section>
        <section className="panel network-panel">
          <h2>Membership messages</h2>
          <Badge
            tone={messaging.ready && !messaging.simulated ? "mint" : "amber"}
          >
            {messaging.simulated
              ? "Simulation · sends nothing"
              : messaging.ready
                ? "Configured"
                : "Blocked"}
          </Badge>
          <p>
            <Link href="/operator/network/messaging">
              Inspect sender, exact message templates and provider outcomes →
            </Link>
          </p>
        </section>
        <section className="panel network-panel">
          <h2>Supporting tools and history</h2>
          <p>
            <Link href="/operator/businesses">Businesses</Link> ·{" "}
            <Link href="/operator/onboarding">Merchant onboarding</Link> ·{" "}
            <Link href="/operator/tap">Staff QR and credential rotation</Link> ·{" "}
            <Link href="/operator/network/acquisition">
              Partners and sources
            </Link>{" "}
            · <Link href="/operator/offers">Historical offers</Link> ·{" "}
            <Link href="/operator/audit">Audit history</Link> ·{" "}
            <Link href="/operator/testing">Isolated internal testing</Link>
          </p>
        </section>
      </div>
    </Shell>
  );
}
