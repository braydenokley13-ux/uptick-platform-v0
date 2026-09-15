import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { memberSupportQueue } from "@/lib/member-experience";
import { Shell } from "@/components/shell";
import { Badge, PageHeading } from "@/components/ui";
import { PilotForm } from "@/components/pilot-form";
import { NetworkMemberLookup } from "@/components/network-operations";
import "@/components/network-operations.css";
export const dynamic = "force-dynamic";
export default async function PilotSupport() {
  const actor = await requireActor(true),
    db = await getDb(),
    requests = await memberSupportQueue(db, actor);
  const members = await db.query<{
    id: string;
    phone_hint: string;
    data_kind: string;
    service_kind: string;
  }>(
    "select m.id,right(c.phone,4) phone_hint,m.data_kind,coalesce(s.kind,'participating') service_kind from uptick_members m join customers c on c.id=m.customer_id left join member_service_status s on s.member_id=m.id order by m.created_at desc limit 500",
  );
  return (
    <Shell actor={actor} active="pilot/support" name="Member support">
      <div className="network-operations">
        <PageHeading
          eyebrow="MEMBERS & SUPPORT"
          title="Make the member whole."
          description="Web help and inbound text requests arrive here with their existing context."
        />
        <section className="panel network-panel">
          <h2>{requests.length} open support requests</h2>
          {!requests.length && <p>No open support requests are recorded.</p>}
          {requests.map((request) => (
            <article className="panel network-panel" key={request.id}>
              <div className="network-status-row">
                <Badge>{request.state}</Badge>
                <p>
                  {request.memberReference || "Unmatched sender"} ·{" "}
                  {request.phoneHint || "No phone available"} · {request.origin}{" "}
                  · {new Date(request.createdAt).toLocaleString("en-US")}
                </p>
              </div>
              <p>{request.note || "Help requested"}</p>
              <p>
                Membership: {request.membership.state || "Not matched"}.
                Verified: {request.membership.verified ? "Yes" : "No"}.
                Promotional SMS:{" "}
                {request.membership.marketingConsent
                  ? "Consented"
                  : "Not consented"}
                .
              </p>
              {request.latestMessage.text && (
                <details>
                  <summary>Message and provider outcome</summary>
                  <p>{request.latestMessage.text}</p>
                  <p>
                    Provider outcome: {request.latestMessage.state || "Unknown"}
                    . Private link credentials are redacted.
                  </p>
                </details>
              )}
              <p>
                Grant: {request.grantId || "None"}. Incident:{" "}
                {request.incidentId || "None"}. Recovery:{" "}
                {request.recoveryId || "None"}.
              </p>
              {request.grantId && (
                <p>
                  <Link
                    href={`/operator/pilot/fulfillment?grant=${encodeURIComponent(request.grantId)}`}
                  >
                    Open incident and backed recovery controls →
                  </Link>
                </p>
              )}
              <details>
                <summary>Record support resolution</summary>
                <p>
                  Arrange the remedy before closing a fulfillment complaint.
                  Digital redemption alone does not establish that the item was
                  handed over.
                </p>
                <PilotForm
                  endpoint="/api/member"
                  action="resolve-support"
                  extra={{ requestId: request.id }}
                  button="Record resolution"
                >
                  <label>
                    What was done for the member?
                    <input
                      name="resolution"
                      required
                      minLength={5}
                      maxLength={1000}
                    />
                  </label>
                </PilotForm>
              </details>
            </article>
          ))}
        </section>
        <NetworkMemberLookup />
        <p>
          <Link href="/operator/pilot/privacy">
            Privacy requests, account data exports, corrections and erasure →
          </Link>
        </p>
        <section className="panel network-panel">
          <h2>Member participation and account access</h2>
          <p>
            Keep the original cohort denominator. Withdrawal, inaccessibility
            and suspension stop future releases; they never count as
            fulfillment. Geography changes are recorded for review. Promotional
            STOP remains separate.
          </p>
          <PilotForm
            action="member-service"
            extra={{ requestKey: randomUUID() }}
            button="Record account status"
          >
            <label>
              Member
              <select name="memberId" required>
                <option value="">Choose a member</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    Phone ending {member.phone_hint} · {member.id.slice(-8)} ·{" "}
                    {member.data_kind} · {member.service_kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select name="kind" required>
                <option value="withdrawn">
                  Voluntary withdrawal — verified member request
                </option>
                <option value="suspended">
                  Service suspension — revoke account access
                </option>
                <option value="deletion_pending">
                  Verified deletion request — revoke access pending privacy
                  review
                </option>
                <option value="inaccessible">
                  Inaccessible — stop future release pending support
                </option>
                <option value="geography_changed">
                  Geography changed — preserve existing obligations
                </option>
                <option value="resumed">
                  Resume future participation — verified member request
                </option>
              </select>
            </label>
            <label>
              Reason and evidence
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={1500}
              />
            </label>
          </PilotForm>
        </section>
      </div>
    </Shell>
  );
}
