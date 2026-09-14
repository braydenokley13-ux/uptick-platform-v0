"use client";
import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function PilotForm({
  action,
  extra = {},
  button,
  children,
  endpoint = "/api/pilot-operations",
}: {
  action: string;
  extra?: object;
  button: string;
  children?: ReactNode;
  endpoint?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const router = useRouter(),
    statusId = useId();
  return (
    <form
      className="network-form"
      aria-describedby={statusId}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setMessage("");
        const form = event.currentTarget,
          values = Object.fromEntries(new FormData(form));
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...values, ...extra }),
          });
          const result = await res.json();
          if (!res.ok)
            throw Error(result.error || "The change could not be saved.");
          setMessage(result.message || "Saved.");
          if (result.redirect) router.push(result.redirect);
          router.refresh();
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The change could not be saved.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>{children}</fieldset>
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : button}
      </button>
      <div id={statusId}>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </form>
  );
}
