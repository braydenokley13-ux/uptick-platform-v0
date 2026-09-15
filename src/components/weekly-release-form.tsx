"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AssignmentPlan } from "@/lib/pilot-assignment";

type ApiResponse<T> = { error?: string; result?: T };

async function request<T>(data: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/pilot-promise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    throw Error(
      "The connection was interrupted. Check the current page before trying again; a requested change may already have completed.",
    );
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw Error(
      "The server returned an unreadable response. Check the current page before trying again; a requested change may already have completed.",
    );
  }
  if (!response.ok)
    throw Error(payload.error || "The plan could not be checked.");
  if (payload.result === undefined)
    throw Error("The server response did not include the requested result.");
  return payload.result;
}

export function WeeklyReleaseForm({
  run,
  weeks,
}: {
  run: { id: string; market_id: string; data_kind: string; state: string };
  weeks: string[];
}) {
  const router = useRouter();
  const [week, setWeek] = useState(weeks[0] || "");
  const [plan, setPlan] = useState<AssignmentPlan | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const planHeading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (plan) planHeading.current?.focus();
  }, [plan]);
  useEffect(() => {
    if (error) errorMessage.current?.focus();
  }, [error]);

  async function recommend() {
    if (inFlight.current || !week) return;
    const requestedWeek = week;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setPlan(null);
    try {
      const result = await request<AssignmentPlan>({
        action: "recommend_assignments",
        runId: run.id,
        weekKey: requestedWeek,
      });
      if (result.runId !== run.id || result.weekKey !== requestedWeek) {
        throw Error(
          "The recommendation did not match the selected week. Generate it again before publishing.",
        );
      }
      setPlan(result);
      setChoices(
        Object.fromEntries(
          result.assignments.map((assignment) => [
            assignment.memberId,
            assignment.supplyId,
          ]),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const changed = plan?.assignments.some(
    (assignment) => choices[assignment.memberId] !== assignment.supplyId,
  );

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan || inFlight.current) return;
    if (week !== plan.weekKey) {
      setError(
        "The selected week changed after this recommendation was generated. Generate a new recommendation before publishing.",
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    const assignments = plan.members.map((member) => ({
      memberId: member.memberId,
      supplyId: choices[member.memberId],
    }));
    const overrideReason = form.get("overrideReason");

    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request({
        action: "release_week",
        runId: run.id,
        marketId: run.market_id,
        dataKind: run.data_kind,
        weekKey: plan.weekKey,
        requestKey: `pilot:${run.id}:${plan.weekKey}`,
        recommendationFingerprint: plan.fingerprint,
        overrideReason:
          changed && typeof overrideReason === "string"
            ? overrideReason
            : undefined,
        assignments,
      });
      setNotice(
        `Published ${plan.members.length} backed benefits. ${plan.excluded} excluded members remain in the original ${plan.admitted}-member cohort history.`,
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publication failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="network-form" aria-busy={busy}>
      <p>
        1. Choose a week. 2. Generate a recommendation. 3. Review destination
        fit, hours, capacity and any changes. Publishing checks every hard limit
        again.
      </p>
      <label>
        Benefit week
        <select
          value={week}
          disabled={busy || weeks.length === 0}
          onChange={(event) => {
            setWeek(event.target.value);
            setPlan(null);
            setNotice("");
            setError("");
          }}
        >
          {weeks.map((availableWeek) => (
            <option key={availableWeek}>{availableWeek}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="button secondary"
        onClick={recommend}
        disabled={busy || !week}
      >
        {busy ? "Checking…" : "Generate recommended assignments"}
      </button>
      {!week && (
        <p role="alert" className="error">
          This pilot has no release weeks to review.
        </p>
      )}
      {plan && (
        <form className="network-form" onSubmit={publish} aria-busy={busy}>
          <h3 ref={planHeading} tabIndex={-1}>
            Recommendation for {plan.weekKey}
          </h3>
          <p>
            <strong>
              {plan.assignments.length} of {plan.members.length}
            </strong>{" "}
            operational members assigned. {plan.excluded} excluded by recorded
            account status; original cohort {plan.admitted}.
          </p>
          {plan.policy?.all_destinations_fit && (
            <p>Reviewed cell-wide fit: {plan.policy.evidence}</p>
          )}
          <fieldset disabled={busy}>
            <div
              className="table-scroll"
              role="region"
              aria-label={`Assignment summary for ${plan.weekKey}`}
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>Destination</th>
                    <th>Assigned / backed</th>
                    <th>Fallback units</th>
                    <th>Commercial</th>
                    <th>Repeat / unknown fit</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.destinations.map((destination) => {
                    const selected = plan.members.filter(
                      (member) =>
                        choices[member.memberId] === destination.supplyId,
                    );
                    const reasons = selected.map(
                      (member) =>
                        member.candidates.find(
                          (candidate) =>
                            candidate.supplyId === destination.supplyId,
                        )!.reason,
                    );
                    return (
                      <tr key={destination.supplyId}>
                        <td>
                          {destination.label}
                          <br />
                          <small>{destination.hours}</small>
                        </td>
                        <td>
                          {selected.length} / {destination.capacity}
                        </td>
                        <td>{destination.fallbackAvailable}</td>
                        <td>
                          {destination.paid
                            ? `${selected.length} paid placements`
                            : "Organic"}
                        </td>
                        <td>
                          {
                            reasons.filter(
                              (reason) => reason.recentDestinationCount > 0,
                            ).length
                          }
                          {" / "}
                          {
                            reasons.filter(
                              (reason) => reason.unknownSuitability,
                            ).length
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!!plan.unassigned.length && (
              <p role="alert">
                {plan.unassigned.length} members need suitable backing. Record
                travel relevance or repair supply, then generate again.
              </p>
            )}
            <details>
              <summary>
                Review each member and adjust suitable destinations
              </summary>
              {plan.members.map((member) => {
                const candidate = member.candidates.find(
                  (option) => option.supplyId === choices[member.memberId],
                );
                return (
                  <div key={member.memberId} className="panel network-panel">
                    <label>
                      Member {member.reference}
                      <select
                        value={choices[member.memberId] || ""}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [member.memberId]: event.target.value,
                          }))
                        }
                        required
                      >
                        <option value="">No suitable assignment</option>
                        {member.candidates
                          .filter((option) => option.reason.suitable)
                          .map((option) => (
                            <option
                              key={option.supplyId}
                              value={option.supplyId}
                            >
                              {
                                plan.destinations.find(
                                  (destination) =>
                                    destination.supplyId === option.supplyId,
                                )?.label
                              }
                            </option>
                          ))}
                      </select>
                    </label>
                    <p>
                      {candidate?.reason.explanation ||
                        "No destination has verified fit and available backing."}
                    </p>
                    {candidate && (
                      <small>
                        Drive estimate:{" "}
                        {candidate.reason.driveMinutes ?? "unknown"} minutes.
                        Recent destination benefits:{" "}
                        {candidate.reason.recentDestinationCount}. Acquisition
                        partner:{" "}
                        {candidate.reason.acquisitionPartner || "none recorded"}
                        .{" "}
                        {candidate.reason.unknownSuitability
                          ? "UNKNOWN SUITABILITY — sample data only."
                          : "Fit recorded."}
                      </small>
                    )}
                  </div>
                );
              })}
            </details>
            {changed && (
              <label>
                Reason for overriding the recommendation
                <textarea
                  name="overrideReason"
                  minLength={10}
                  maxLength={1500}
                  required
                />
              </label>
            )}
            <label className="network-check">
              <input type="checkbox" required />I reviewed this plan and today’s
              destination readiness evidence.
            </label>
            <button
              className="button"
              disabled={
                busy || !!plan.unassigned.length || run.state !== "live"
              }
            >
              {busy
                ? "Checking and publishing…"
                : "Publish backed weekly benefits"}
            </button>
          </fieldset>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p ref={errorMessage} tabIndex={-1} role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
