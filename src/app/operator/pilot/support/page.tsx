import Link from "next/link";
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
    requests = await memberSupportQueue(await getDb(), actor);
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
      </div>
    </Shell>
  );
}
