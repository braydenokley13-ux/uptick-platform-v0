"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
type PrivacyStatus = {
  id: string;
  kind: string;
  state: string;
  created_at: string;
  resolution: string;
};
export function MemberPrivacyRequest({
  requests = [],
}: {
  requests?: PrivacyStatus[];
}) {
  const router = useRouter(),
    key = useRef<string | null>(null),
    pending = useRef(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  return (
    <details className="member-fine-details">
      <summary>Privacy and account-data requests</summary>
      <p>
        Ask for a copy, correction, deletion, or revoked account access. Uptick
        support verifies the request first. Erasure removes identifiers and
        closes access; some operating evidence may be retained under the
        approved policy.
      </p>
      <form
        className="member-join-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          pending.current = true;
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const response = await fetch("/api/member", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "privacy-request",
                kind: form.get("kind"),
                note: form.get("note"),
                requestKey: (key.current ||= crypto.randomUUID()),
              }),
            });
            const result = await response.json();
            if (!response.ok)
              throw Error(result.error || "Your request could not be saved.");
            setNotice(result.message);
            key.current = null;
            router.refresh();
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "Please try again.",
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            What would you like?
            <select name="kind" required defaultValue="">
              <option value="" disabled>
                Choose your request
              </option>
              <option value="access">A copy of my account data</option>
              <option value="correction">Correct my information</option>
              <option value="deletion">Delete my account identifiers</option>
              <option value="revoke_sessions">
                Sign out all account sessions
              </option>
            </select>
          </label>
          <label>
            Request details
            <textarea name="note" minLength={10} maxLength={2000} required />
          </label>
          <button className="button secondary">
            {busy ? "Saving…" : "Send privacy request"}
          </button>
        </fieldset>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
      <h3>Your recent requests</h3>
      {requests.length ? (
        requests.map((request) => (
          <article key={request.id}>
            <h4>
              {(
                {
                  access: "Account data copy",
                  correction: "Information correction",
                  deletion: "Account erasure",
                  revoke_sessions: "Sign out account sessions",
                } as Record<string, string>
              )[request.kind] || "Privacy request"}
            </h4>
            <p>
              {(
                {
                  queued: "Waiting for support review",
                  verified: "Identity verified — being processed",
                  completed: "Completed",
                  declined: "Unable to complete — see the response",
                } as Record<string, string>
              )[request.state] || request.state}
              . Requested{" "}
              {new Date(request.created_at).toLocaleDateString("en-US")}.
            </p>
            {request.resolution && <p>{request.resolution}</p>}
            {request.kind === "access" &&
              ["verified", "completed"].includes(request.state) && (
                <>
                  <a
                    className="button secondary"
                    href={`/api/member/privacy?requestId=${encodeURIComponent(request.id)}`}
                  >
                    Download my account data
                  </a>
                  <p>
                    This private JSON file contains your account information and
                    support records. Keep it somewhere private. It contains no
                    passwords, private links or access codes.
                  </p>
                </>
              )}
          </article>
        ))
      ) : (
        <p>No privacy requests are recorded for this account.</p>
      )}
    </details>
  );
}
