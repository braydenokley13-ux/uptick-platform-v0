"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type DemoResponse = { error?: string; redirect?: string };

export function DemoButton({
  action,
  children,
  endpoint = "/api/demo",
}: {
  action: string;
  children: ReactNode;
  endpoint?: string;
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
              response = await fetch(endpoint, {
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

export function CloudDemoUnlock() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = event.currentTarget;
        const accessKey = new FormData(form).get("accessKey");
        try {
          const response = await fetch("/api/demo/cloud", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "unlock", accessKey }),
          });
          const result = await response.json();
          if (!response.ok)
            throw Error(result.error || "Could not open the rehearsal.");
          form.reset();
          router.push("/demo");
          router.refresh();
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not connect. Try again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="demo-access">Founder demo access key</label>
      <input
        id="demo-access"
        name="accessKey"
        type="password"
        required
        maxLength={128}
        autoComplete="current-password"
      />
      <button className="button" disabled={busy}>
        {busy ? "Opening…" : "Open my rehearsal"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
