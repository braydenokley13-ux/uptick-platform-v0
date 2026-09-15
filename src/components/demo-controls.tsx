"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type DemoResponse = { error?: string; redirect?: string };

export function DemoButton({
  action,
  children,
}: {
  action: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorMessage = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorMessage.current?.focus();
  }, [error]);

  return (
    <div aria-busy={busy}>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            let response: Response;
            try {
              response = await fetch("/api/demo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
              });
            } catch {
              throw Error(
                "The connection was interrupted. Check the current page before trying again; the demo action may already have completed.",
              );
            }

            let result: DemoResponse;
            try {
              result = (await response.json()) as DemoResponse;
            } catch {
              throw Error(
                "The server returned an unreadable response. Check the current page before trying again; the demo action may already have completed.",
              );
            }
            if (!response.ok) {
              throw Error(result.error || "The demo action could not finish.");
            }
            if (!result.redirect) {
              throw Error("The demo action did not provide a destination.");
            }
            router.push(result.redirect);
            router.refresh();
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "The demo action could not finish.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : children}
      </button>
      {error && (
        <p ref={errorMessage} tabIndex={-1} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
