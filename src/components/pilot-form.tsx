"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type PilotResponse = {
  error?: string;
  message?: string;
  redirect?: string;
};

async function submitPilotAction(endpoint: string, body: object) {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw Error(
      "The connection was interrupted. Review the current page before trying again; the change may already have been saved.",
    );
  }

  let result: PilotResponse;
  try {
    result = (await response.json()) as PilotResponse;
  } catch {
    throw Error(
      "The server returned an unreadable response. Review the current page before trying again; the change may already have been saved.",
    );
  }
  if (!response.ok)
    throw Error(result.error || "The change could not be saved.");
  return result;
}

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
  const errorMessage = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorMessage.current?.focus();
  }, [error]);

  return (
    <form
      className="network-form"
      aria-describedby={statusId}
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setMessage("");
        const form = event.currentTarget,
          values = Object.fromEntries(new FormData(form));
        try {
          const result = await submitPilotAction(endpoint, {
            action,
            ...values,
            ...extra,
          });
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
      <button type="submit" className="button" disabled={busy}>
        {busy ? "Saving…" : button}
      </button>
      <div id={statusId}>
        {error && (
          <p ref={errorMessage} tabIndex={-1} role="alert" className="error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </form>
  );
}
