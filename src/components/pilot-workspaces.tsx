"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function PilotWorkspaces({
  businesses,
}: {
  businesses: { id: string; name: string }[];
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function select(organizationId: string | null) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pilot-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || "Workspace could not be opened.");
      router.push(data.redirect);
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Workspace could not be opened. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <button className="button" disabled={busy} onClick={() => select(null)}>
        Open Uptick operator
      </button>
      {businesses.map((business) => (
        <button
          key={business.id}
          className="button secondary"
          disabled={busy}
          onClick={() => select(business.id)}
        >
          Open {business.name}
        </button>
      ))}
      {error && <p role="alert">{error}</p>}
      <p className="fine">
        Your own sign-in remains attached to every action. Sample merchant
        workspaces use ordinary merchant permissions. Return to this page to
        switch back.
      </p>
    </div>
  );
}
