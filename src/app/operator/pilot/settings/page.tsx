import Link from "next/link";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { uptickEnvironment } from "@/lib/environment";
import { appUrl } from "@/lib/config";
import { releaseReadiness } from "@/lib/release-readiness";
import { readinessGates } from "@/lib/operator-readiness";
import { ReadinessMap } from "@/components/readiness-map";
import { Shell } from "@/components/shell";
import { Badge, PageHeading } from "@/components/ui";
import { PilotForm } from "@/components/pilot-form";
import "@/components/network-operations.css";
export const dynamic = "force-dynamic";
export default async function PilotSettings() {
  const actor = await requireActor(true),
    db = await getDb(),
    data = await releaseReadiness(db),
    gates = await readinessGates(db);
  const { schema, messaging } = data;
  const controls = [
    ["Canonical app origin", appUrl() === "https://pilot.upticklocal.com"],
    ["Legal identity supplied", !!process.env.BUSINESS_LEGAL_NAME],
    ["Support email configured", !!process.env.SUPPORT_EMAIL],
    ["Legal approval recorded", process.env.LEGAL_APPROVED === "true"],
    ["Operator MFA enforcement", process.env.OPERATOR_MFA_REQUIRED === "true"],
    [
      "Production delivery master switch",
      process.env.PRODUCTION_DELIVERY_ENABLED === "true",
    ],
    ["Requested access SMS switch", messaging.accessEnabled],
    ["Optional promotional SMS switch", messaging.promotionEnabled],
    ["New real enrollment switch", data.enrollmentEnabled],
  ] as const;
  return (
    <Shell actor={actor} active="pilot/settings" name="Release & commissioning">
      <div className="network-operations">
        <PageHeading
          eyebrow="SIX SEPARATE READINESS STATES"
          title="Know what is ready."
          description="Record evidence for this release. Deployment, carrier delivery, working accounts and backed member promises need their own proof."
        />
        <ReadinessMap gates={gates} />
        <p>
          <Link href="/operator/pilot/access">
            Manage operator and merchant access
          </Link>{" "}
          ·{" "}
          <Link href="/operator/pilot/privacy">
            Privacy and retention decisions
          </Link>
        </p>
        <section className="panel network-panel">
          <h2>1. Demo readiness</h2>
          <p>
            {messaging.simulated
              ? "This environment simulates messages. Sample activity is rehearsal evidence."
              : "This hosted environment is separate from the founder’s local demo."}{" "}
            Run the isolated Demo Studio on the founder’s laptop and use its
            offline guide. A hosted deployment is not a safe demo shortcut.
          </p>
        </section>
        <section className="panel network-panel">
          <h2>2. Software and migration integrity</h2>
          <p>
            Environment: {uptickEnvironment() || "Unconfigured"}. Origin:{" "}
            {appUrl()}.
          </p>
          <p>
            Release: <code>{data.releaseSha}</code>
          </p>
          <Badge tone={schema.matches ? "mint" : "amber"}>
            {schema.matches
              ? "Migration ledger and checksums match the packaged release"
              : "Migration verification needed"}
          </Badge>
          <p>
            {schema.actual.length} migrations recorded; {schema.expected.length}{" "}
            packaged. Latest packaged: {schema.expected.at(-1)?.name}.
          </p>
          {(
            [
              ["Missing migrations", schema.missing],
              ["Unexpected migrations", schema.unexpected],
              ["Changed checksums", schema.changed],
              ["Legacy hashes awaiting review", schema.unverified],
            ] as const
          ).map(
            ([label, names]) =>
              names.length > 0 && (
                <p key={label}>
                  <strong>{label}:</strong> {names.join(", ")}
                </p>
              ),
          )}
          <p>
            Checksums identify migration files. The hosted schema comparison and
            CI/build evidence below are separate checks.
          </p>
          {schema.unverified.length > 0 && (
            <details>
              <summary>Record a reviewed legacy migration baseline</summary>
              <p>
                Only use this after comparing hosted migration statements and
                the actual schema with the release artifact. It cannot repair
                missing or changed migrations. Newly applied migrations record
                their checksums automatically.
              </p>
              <PilotForm
                endpoint="/api/readiness"
                action="migration-baseline"
                button="Record reviewed legacy baseline"
              >
                <label>
                  Reviewed evidence and comparison result
                  <textarea
                    name="evidence"
                    minLength={30}
                    maxLength={3000}
                    required
                  />
                </label>
              </PilotForm>
            </details>
          )}
        </section>
        <section className="panel network-panel">
          <h2>3. Twilio and messaging</h2>
          <p>
            Transport:{" "}
            {messaging.simulated
              ? "SIMULATION — no SMS"
              : messaging.environment || "Unconfigured"}
            . Requested access:{" "}
            {messaging.accessReady ? "configured" : "blocked"}. Optional
            promotional sending:{" "}
            {messaging.promotionalReady ? "configured" : "blocked"}.
          </p>
          <p>
            Provider approval, signed callbacks and actual handset receipt are
            separate commissioning records. A delivered callback does not prove
            a message was read.
          </p>
          <p>
            <Link href="/operator/network/messaging">
              Sender, exact templates and message outcomes →
            </Link>
          </p>
          <div className="network-grid equal">
            {data.messages.map((message) => (
              <p key={message.state}>
                <strong>{message.n}</strong>{" "}
                {message.state.replaceAll("_", " ")}
              </p>
            ))}
          </div>
          {data.callbacks.length ? (
            data.callbacks.map((callback) => (
              <article key={callback.kind}>
                <h3>{callback.kind} callbacks</h3>
                <p>
                  {callback.successful_count} processed; {callback.failed_count}{" "}
                  failed. Last successful processing:{" "}
                  {callback.last_success_at || "never"}. Last failure:{" "}
                  {callback.last_failure_at || "none"}{" "}
                  {callback.last_failure_code || ""}.
                </p>
                <p>
                  {callback.current
                    ? "Authenticated success within seven days for this release and sender configuration."
                    : "A fresh authenticated callback is required for this release and sender configuration."}
                </p>
              </article>
            ))
          ) : (
            <p>
              No callback processing has been recorded. Commission both signed
              endpoints before real enrollment.
            </p>
          )}
        </section>
        <section className="panel network-panel">
          <h2>4. Hosted commissioning evidence</h2>
          <p>
            Evidence is bound to this release and migration fingerprint.
            Messaging evidence is also bound to the active sender. A changed
            release, sender or expired review makes the record unverified until
            reviewed again. Recording a result does not perform a provider test.
          </p>
          {data.checks.map((check) => (
            <article className="panel network-panel" key={check.key}>
              <h3>{check.label}</h3>
              <Badge tone={check.state === "verified" ? "mint" : "amber"}>
                {check.state}
              </Badge>
              <p>{check.evidence || "No evidence recorded."}</p>
              {check.owner && (
                <p>
                  Owner: {check.owner}. Review due: {check.reviewDueAt}.{" "}
                  {!check.current &&
                    "The saved evidence is not current for this release."}
                </p>
              )}
              <details>
                <summary>Record a tested result</summary>
                <PilotForm
                  endpoint="/api/readiness"
                  action="commissioning"
                  extra={{ checkKey: check.key }}
                  button="Save commissioning evidence"
                >
                  <label>
                    Result
                    <select name="state" required defaultValue="">
                      <option value="" disabled>
                        Choose the actual result
                      </option>
                      <option value="verified">Verified with evidence</option>
                      <option value="failed">Failed</option>
                      <option value="pending">Pending external action</option>
                    </select>
                  </label>
                  <label>
                    Accountable owner
                    <input
                      name="owner"
                      minLength={2}
                      maxLength={200}
                      required
                    />
                  </label>
                  <label>
                    Evidence, result and remaining limits
                    <textarea
                      name="evidence"
                      minLength={20}
                      maxLength={3000}
                      required
                    />
                  </label>
                  <label>
                    Next review
                    <input name="reviewDueAt" type="datetime-local" required />
                  </label>
                </PilotForm>
              </details>
            </article>
          ))}
        </section>
        <section className="panel network-panel">
          <h2>5. Market-cell readiness</h2>
          <p>
            {data.markets.filter((m) => m.data_kind === "real").length} real
            Market Cells recorded. A record count does not establish stocked
            counters, a fixed cohort or distribution commitments.
          </p>
          <p>
            <Link href="/operator/pilot">
              Review four-week capacity and commitments
            </Link>{" "}
            ·{" "}
            <Link href="/operator/pilot/fulfillment">
              Review destination readiness, fallback and incidents
            </Link>
          </p>
          {data.markets.map((market) => (
            <p key={market.id}>
              {market.name} · {market.data_kind} · {market.state}
            </p>
          ))}
        </section>
        <section className="panel network-panel">
          <h2>6. Real enrollment controls</h2>
          <p>
            The new-enrollment switch is{" "}
            {data.enrollmentEnabled ? "enabled" : "closed"}. New real membership
            also requires current release, account, messaging, support and
            privacy evidence. Admission still checks the four-week Market Cell
            capacity.
          </p>
          {controls.map(([label, enabled]) => (
            <div className="network-status-row" key={label}>
              <Badge tone={enabled ? "mint" : "amber"}>
                {enabled ? "Configured" : "Closed / missing"}
              </Badge>
              <p>{label}</p>
            </div>
          ))}
          <p>
            Privacy policy:{" "}
            {data.policy
              ? `review due ${data.policy.review_due_at}`
              : "no approved retention policy"}
            . These controls do not certify physical fulfillment or business
            commitments.
          </p>
        </section>
        <section className="panel network-panel">
          <h2>Jobs and support</h2>
          <p>
            Preparation runs every five minutes; sending is bounded. Uncertain
            sends are not automatically retried.
          </p>
          {data.jobs.map((job) => (
            <article key={job.key}>
              <h3>{job.key.replaceAll("_", " ")}</h3>
              <Badge tone={job.healthy ? "mint" : "amber"}>
                {job.healthy ? "Recent success" : "Missing, stale or failed"}
              </Badge>
              <p>
                Last outcome: {job.state || "never run"}. Last success:{" "}
                {job.last_success || "never"}. {job.error_code || ""}
              </p>
            </article>
          ))}
          <p>
            {data.support.open} support requests need attention. Oldest:{" "}
            {data.support.oldest || "none"}.
          </p>
          <p>
            <Link href="/operator/pilot/support">Open the support queue →</Link>
          </p>
        </section>
      </div>
    </Shell>
  );
}
