"use client";
import { useRef, useState } from "react";
export function ConfirmPhoneChange({ credential }: { credential: string }) {
  const pending = useRef(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      className="member-join-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/member/phone-change", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential }),
          });
          const result = await response.json();
          if (!response.ok)
            throw Error(result.error || "The number could not be verified.");
          setMessage(result.message);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The connection was interrupted. Contact support before trying again.",
          );
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      {!message && (
        <button className="button" disabled={busy}>
          {busy ? "Verifying…" : "Confirm this is my new number"}
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
