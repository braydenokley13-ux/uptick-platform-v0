"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Plan = {
  supply_id: string;
  week_key: string;
  committed_quantity: number;
  label: string;
};
export function WeeklyReleaseForm({
  run,
  weeks,
  members,
  plans,
}: {
  run: { id: string; market_id: string; data_kind: string; state: string };
  weeks: string[];
  members: string[];
  plans: Plan[];
}) {
  const router = useRouter();
  const [week, setWeek] = useState(weeks[0] || "");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = plans.filter((p) => p.week_key === week);
  const total = selected.reduce((n, p) => n + (counts[p.supply_id] || 0), 0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let cursor = 0;
      const assignments = selected.flatMap((p) => {
        const selectedMembers = members.slice(
          cursor,
          cursor + (counts[p.supply_id] || 0),
        );
        cursor += selectedMembers.length;
        return selectedMembers.map((memberId) => ({
          memberId,
          supplyId: p.supply_id,
        }));
      });
      if (cursor !== members.length)
        throw Error("Assign exactly one benefit to every admitted member.");
      const response = await fetch("/api/pilot-promise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "release_week",
          runId: run.id,
          marketId: run.market_id,
          dataKind: run.data_kind,
          weekKey: week,
          requestKey: `pilot:${run.id}:${week}`,
          assignments,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(
          result.error ||
            "The release was blocked. Review readiness and capacity.",
        );
      setNotice(
        `Published ${members.length} backed grants. A retry of this same plan will return the existing release.`,
      );
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Release failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="network-form" onSubmit={submit}>
      <p>
        Choose the number of members for each destination. Members are assigned
        in a stable order. The server checks the complete cohort, local
        relevance, exact free terms, readiness, fallback, inventory and approved
        paid limits before publishing anything.
      </p>
      <label>
        Benefit week
        <select
          value={week}
          onChange={(e) => {
            setWeek(e.target.value);
            setCounts({});
          }}
        >
          {weeks.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
      </label>
      {selected.map((plan) => (
        <label key={plan.supply_id}>
          {plan.label} · up to {plan.committed_quantity} committed
          <input
            type="number"
            min={0}
            max={plan.committed_quantity}
            step={1}
            value={counts[plan.supply_id] || 0}
            onChange={(e) =>
              setCounts({ ...counts, [plan.supply_id]: Number(e.target.value) })
            }
          />
        </label>
      ))}
      {!selected.length && (
        <p>Commit supply for this week from Pilot Today first.</p>
      )}
      <p>
        <strong>
          {total} of {members.length}
        </strong>{" "}
        admitted members assigned. Pilot state: {run.state}.
      </p>
      <label className="network-check">
        <input type="checkbox" required /> I reviewed this whole-cohort plan and
        confirmed today’s destination evidence.
      </label>
      <button
        className="button"
        disabled={
          busy ||
          !members.length ||
          total !== members.length ||
          run.state !== "live"
        }
      >
        {busy ? "Checking and publishing…" : "Publish backed weekly grants"}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
