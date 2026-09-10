import Link from "next/link";
import { ArrowUpRight, FlaskConical, ShieldCheck } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { offerSelect, type Offer } from "@/lib/domain";
import { localMode } from "@/lib/config";
import {
  internalTestAllowlist,
  recentInternalTests,
} from "@/lib/internal-testing";
import { Shell } from "@/components/shell";
import { PageHeading, Badge, Empty, ButtonLink } from "@/components/ui";
import { InternalTestForm } from "@/components/internal-testing-controls";
import "@/components/internal-testing.css";
export const dynamic = "force-dynamic";
export default async function InternalTesting() {
  const actor = await requireActor(true),
    db = await getDb();
  const [offers, runs] = await Promise.all([
    db.query<Offer>(
      `${offerSelect} where 'merchant'=any(g.capabilities) order by o.created_at desc`,
    ),
    recentInternalTests(db, actor),
  ]);
  const development = localMode() && process.env.SMS_TRANSPORT !== "twilio";
  return (
    <Shell actor={actor} active="testing" name="Network operations">
      <div className="internal-testing">
        <PageHeading
          eyebrow="INTERNAL TESTING · OUTSIDE PRODUCTION METRICS"
          title={
            <>
              Rehearse the moment.
              <br />
              <em>Protect the real story.</em>
            </>
          }
          description="Try a saved Anchor or Weekly Drop with an approved internal tester. Every test lives in a separate ledger."
          action={
            <ButtonLink href="/operator/offers/new" quiet>
              Create an offer
            </ButtonLink>
          }
        />
        <div className="test-environment">
          <FlaskConical size={20} />
          <div>
            <strong>
              {development
                ? "Local rehearsal · no SMS"
                : "Internal carrier test · real SMS when ready"}
            </strong>
            <p>
              {development
                ? "This environment creates a durable test pass without contacting a provider."
                : "Only approved allowlisted numbers can receive messages. Real merchant, sender, legal, and platform readiness checks remain required."}
            </p>
          </div>
          <Badge tone="amber">Always marked TEST</Badge>
        </div>
        <InternalTestForm
          offers={offers.map((o) => ({
            id: o.id,
            organizationId: o.organization_id,
            merchant: o.merchant,
            title: o.title,
            version: o.current_version,
            kind: o.kind,
            qualification: o.qualification,
            reward: o.reward,
            isDemo: o.is_demo,
          }))}
          development={development}
          allowlistCount={internalTestAllowlist().length}
        />
        <section className="panel test-history">
          <div className="section-top">
            <div>
              <p className="eyebrow">THE INTERNAL LEDGER</p>
              <h2>What the rehearsal recorded.</h2>
            </div>
            <span className="fine">LATEST 40 TESTS</span>
          </div>
          {runs.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>TEST / MERCHANT</th>
                    <th>MESSAGE</th>
                    <th>PASS</th>
                    <th>OPEN</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <strong>{run.title}</strong>
                        <small>
                          {run.merchant} · V{run.offerVersion} ·{" "}
                          {run.kind === "drop" ? "Drop" : "Anchor"}
                        </small>
                        <small>
                          ••• ••• {run.phoneSuffix} ·{" "}
                          {new Date(run.createdAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </small>
                      </td>
                      <td>
                        <Badge
                          tone={
                            run.state === "delivered"
                              ? "mint"
                              : [
                                    "failed",
                                    "undelivered",
                                    "unknown",
                                    "suppressed",
                                  ].includes(run.state)
                                ? "amber"
                                : "neutral"
                          }
                        >
                          {run.state === "development"
                            ? "Development · no SMS"
                            : run.state.replaceAll("_", " ")}
                        </Badge>
                        {run.providerSid && (
                          <small className="test-provider-id">
                            {run.providerSid}
                          </small>
                        )}
                        {run.errorCode && <small>Code: {run.errorCode}</small>}
                      </td>
                      <td>
                        {run.redeemedAt
                          ? "Test redeemed"
                          : run.openedAt
                            ? "Test opened"
                            : "Not opened"}
                        <small>
                          Expires{" "}
                          {new Date(run.expiresAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </small>
                      </td>
                      <td>
                        <Link
                          className="text-link"
                          href={run.passUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Test pass
                          <ArrowUpRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Your first rehearsal starts above.">
              Choose a saved offer and an approved internal number.
            </Empty>
          )}
          <p className="table-footnote">
            Delivered is a provider report, not a read receipt. Unknown outcomes
            are never retried automatically. Refresh this page to check signed
            callback updates.
          </p>
        </section>
        <div className="test-separation-note">
          <ShieldCheck size={20} />
          <p>
            Tests create no production claims, redemptions, subscriptions,
            broadcasts, or merchant results. Test pass links are private; share
            them only with your approved testing team.
          </p>
        </div>
      </div>
    </Shell>
  );
}
