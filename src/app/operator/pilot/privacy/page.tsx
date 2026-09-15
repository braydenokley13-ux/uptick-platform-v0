import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { privacyOperations } from "@/lib/privacy-admin";
import { memberRetentionNotes } from "@/lib/privacy-retention";
import { Shell } from "@/components/shell";
import { PageHeading } from "@/components/ui";
import { PilotForm } from "@/components/pilot-form";
import "@/components/network-operations.css";
export const dynamic = "force-dynamic";
export default async function PrivacyAdmin() {
  const actor = await requireActor(true),
    db = await getDb(),
    data = await privacyOperations(db, actor);
  const members = await db.query<{
    id: string;
    phone_hint: string;
    data_kind: string;
  }>(
    "select m.id,right(c.phone,4) phone_hint,m.data_kind from uptick_members m join customers c on c.id=m.customer_id order by m.created_at desc limit 500",
  );
  const deletionReviews = await Promise.all(
    data.requests
      .filter(
        (r) =>
          r.kind === "deletion" && ["verified", "completed"].includes(r.state),
      )
      .map(async (r) => ({
        request: r,
        notes: await memberRetentionNotes(db, actor, r.member_id),
      })),
  );
  const phoneChanges = await db.query<{
    request_id: string;
    confirmed_at: string | null;
    applied_at: string | null;
    expires_at: string;
  }>(
    "select request_id,confirmed_at,applied_at,expires_at from member_phone_changes",
  );
  return (
    <Shell actor={actor} active="pilot/support" name="Privacy administration">
      <div className="network-operations">
        <PageHeading
          eyebrow="PRIVACY & ACCOUNT DATA"
          title="Verify the person. Record the action."
          description="Manage access, corrections, erasure and revoked sessions while preserving truthful operating evidence."
        />
        <p>
          <Link href="/operator/pilot/support">← Member support</Link>
        </p>
        <section className="panel network-panel">
          <h2>Approved retention policy</h2>
          <p>
            {data.policy
              ? `Policy scope: ${data.policy.scope}. Review due ${data.policy.review_due_at}.`
              : "No approved policy is recorded. Real enrollment remains blocked."}
          </p>
          <details>
            <summary>Record a legally approved policy version</summary>
            <p>
              Enter the actual approved periods. These fields have no suggested
              legal defaults. Zero means no continued identified retention after
              the relevant purpose ends. The operational and financial
              categories require review of retained evidence.
            </p>
            <PilotForm
              endpoint="/api/privacy"
              action="policy"
              button="Record approved privacy policy"
            >
              <label>
                Policy scope and applicable decisions
                <textarea name="scope" minLength={10} required />
              </label>
              {[
                "identifiers",
                "support",
                "consent",
                "operational",
                "financial",
              ].map((category) => (
                <label key={category}>
                  {category} retention in days
                  <input
                    name={category}
                    type="number"
                    min={0}
                    max={36500}
                    required
                  />
                </label>
              ))}
              <label>
                Approval evidence and responsible reviewer
                <textarea name="approvalEvidence" minLength={20} required />
              </label>
              <label>
                Next policy review
                <input name="reviewDueAt" type="datetime-local" required />
              </label>
            </PilotForm>
          </details>
        </section>
        <section className="panel network-panel">
          <h2>Record a member request</h2>
          <PilotForm
            endpoint="/api/privacy"
            action="request"
            extra={{ requestKey: randomUUID() }}
            button="Record privacy request"
          >
            <label>
              Member
              <select name="memberId" required defaultValue="">
                <option value="" disabled>
                  Choose the requesting member
                </option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    Phone ending {m.phone_hint} · Member {m.id.slice(-8)} ·{" "}
                    {m.data_kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Request type
              <select name="kind" required defaultValue="">
                <option value="" disabled>
                  Choose the requested action
                </option>
                <option value="access">Data access/export</option>
                <option value="correction">Correct account information</option>
                <option value="deletion">Delete account identifiers</option>
                <option value="revoke_sessions">
                  Revoke account sessions and recovery codes
                </option>
              </select>
            </label>
            <label>
              Request details (stored encrypted)
              <textarea name="note" required minLength={10} maxLength={2000} />
            </label>
          </PilotForm>
        </section>
        <section className="panel network-panel">
          <h2>Privacy requests</h2>
          {data.requests.map((r) => (
            <article className="panel network-panel" key={r.id}>
              <h3>
                Member {r.member_id.slice(-8)} · {r.kind.replaceAll("_", " ")} ·{" "}
                {r.state}
              </h3>
              <p>{r.note}</p>
              {r.state === "queued" && (
                <PilotForm
                  endpoint="/api/privacy"
                  action="verify"
                  extra={{ requestId: r.id }}
                  button="Record identity verification"
                >
                  <label>
                    Verification evidence — avoid identity-document copies
                    <textarea
                      name="evidence"
                      minLength={10}
                      maxLength={1500}
                      required
                    />
                  </label>
                </PilotForm>
              )}
              {r.kind === "access" &&
                ["verified", "completed"].includes(r.state) && (
                  <p>
                    <a
                      className="button secondary"
                      href={`/api/privacy?requestId=${encodeURIComponent(r.id)}`}
                    >
                      Download this member’s data
                    </a>
                  </p>
                )}
              {r.kind === "correction" && r.state === "verified" && (
                <section>
                  <h4>Verify a requested phone change</h4>
                  <p>
                    First verify the original account owner. Then send this
                    one-time check to the new number. This does not sign the
                    member in or subscribe them to promotional texts.
                  </p>
                  {phoneChanges.some((c) => c.request_id === r.id) ? (
                    <p>
                      {phoneChanges.find((c) => c.request_id === r.id)
                        ?.confirmed_at
                        ? "The new number is verified. Apply the correction below within 24 hours."
                        : "Verification is waiting for the member. Links expire after 15 minutes; an expired link requires a new verified correction request."}
                    </p>
                  ) : (
                    <PilotForm
                      endpoint="/api/privacy"
                      action="prepare-phone"
                      extra={{ requestId: r.id }}
                      button="Send requested number verification"
                    >
                      <label>
                        New mobile number
                        <input
                          name="newPhone"
                          type="tel"
                          autoComplete="off"
                          required
                        />
                      </label>
                      <label className="network-check">
                        <input
                          name="requestedByMember"
                          type="checkbox"
                          required
                        />
                        The verified account owner requested this number change
                        and verification text.
                      </label>
                    </PilotForm>
                  )}
                </section>
              )}
              {r.state === "verified" && (
                <PilotForm
                  endpoint="/api/privacy"
                  action="complete"
                  extra={{ requestId: r.id }}
                  button={
                    r.kind === "deletion"
                      ? "Erase verified account identifiers"
                      : "Complete verified request"
                  }
                >
                  {r.kind === "correction" && (
                    <>
                      <label>
                        Corrected home ZIP (leave blank for a phone-only change)
                        <input name="homeZip" pattern="[0-9]{5}" />
                      </label>
                      <label>
                        Corrected work ZIP (optional)
                        <input name="workZip" pattern="[0-9]{5}" />
                      </label>
                      {phoneChanges.some(
                        (c) =>
                          c.request_id === r.id &&
                          c.confirmed_at &&
                          !c.applied_at,
                      ) && (
                        <label className="network-check">
                          <input name="correctPhone" type="checkbox" />
                          Apply the verified phone change. Revoke prior
                          sessions, recovery codes and private links; keep
                          promotional SMS off.
                        </label>
                      )}
                    </>
                  )}
                  {r.kind === "deletion" && (
                    <>
                      <p>
                        This revokes access and removes known phone/ZIP, private
                        credentials and support-message content. Original cohort
                        and operating evidence remain under the approved
                        retention policy. Review free-text operating records for
                        identifying details before continuing.
                      </p>
                      <label className="network-check">
                        <input
                          name="retainedEvidenceReviewed"
                          type="checkbox"
                          required
                        />
                        I reviewed retained evidence and the approved retention
                        decision.
                      </label>
                    </>
                  )}
                  <label>
                    Completion note — use an operational summary without
                    personal identifiers
                    <textarea
                      name="resolution"
                      minLength={10}
                      maxLength={1500}
                      required
                    />
                  </label>
                </PilotForm>
              )}
            </article>
          ))}
        </section>
        <section className="panel network-panel">
          <h2>Review personal notes before erasure</h2>
          <p>
            These are member-linked notes that could contain identifiers.
            Removing them replaces only free text and identified audit fields.
            Dates, cohort membership, quantities, prices, incident states and
            redemption records stay intact.
          </p>
          {deletionReviews.map(({ request, notes }) => (
            <article key={request.id}>
              <h3>Member {request.member_id.slice(-8)}</h3>
              {notes.length ? (
                <>
                  <details>
                    <summary>
                      Review {notes.length} retained note fields
                    </summary>
                    {notes.map((n) => (
                      <p key={`${n.table_name}:${n.row_id}:${n.field}`}>
                        <strong>
                          {n.table_name.replaceAll("_", " ")} ·{" "}
                          {n.field.replaceAll("_", " ")}
                        </strong>
                        <br />
                        {n.value}
                      </p>
                    ))}
                  </details>
                  <PilotForm
                    endpoint="/api/privacy"
                    action="redact-notes"
                    extra={{ requestId: request.id }}
                    button="Remove personal note details"
                  >
                    <p>
                      Review the fields above first. This privacy action is
                      permanent and records which fields were removed, without
                      retaining their original contents.
                    </p>
                  </PilotForm>
                </>
              ) : (
                <p>No member note fields remain to remove.</p>
              )}
            </article>
          ))}
        </section>
        <section className="panel network-panel">
          <h2>Retention reviews</h2>
          <p>
            Each category has its own review date. Use a documented hold when
            identified retention is still required. Close a review only after
            personal details are removed and the approved policy permits
            retaining the remaining de-identified operating evidence.
          </p>
          {data.retentionReviews.map((r) => (
            <article
              className="panel network-panel"
              key={`${r.member_id}:${r.category}`}
            >
              <h3>
                Member {String(r.member_id).slice(-8)} · {String(r.category)}
              </h3>
              <p>
                Review{" "}
                {new Date(String(r.review_due_at)) <= new Date()
                  ? "overdue"
                  : "due"}
                : {String(r.review_due_at)}
              </p>
              <PilotForm
                endpoint="/api/privacy"
                action="retention-review"
                extra={{ memberId: r.member_id, category: r.category }}
                button="Record retention decision"
              >
                <label>
                  Decision
                  <select name="outcome" required defaultValue="">
                    <option value="" disabled>
                      Choose the reviewed decision
                    </option>
                    <option value="deidentified">
                      Identifier cleanup complete; retain de-identified evidence
                    </option>
                    <option value="hold">Documented retention hold</option>
                  </select>
                </label>
                <label>
                  Approval and purpose evidence (stored encrypted)
                  <textarea
                    name="evidence"
                    minLength={20}
                    maxLength={2000}
                    required
                  />
                </label>
                <label>
                  Next review date — required for a hold
                  <input name="nextReviewAt" type="datetime-local" />
                </label>
                <label className="network-check">
                  <input name="identifiersReviewed" type="checkbox" required />I
                  reviewed identifiers, retained notes and the approved
                  retention decision.
                </label>
              </PilotForm>
            </article>
          ))}
        </section>
      </div>
    </Shell>
  );
}
