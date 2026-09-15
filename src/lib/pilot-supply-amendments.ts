import { z } from "zod";
import type { DB } from "./db";
import { audit, type Actor } from "./domain";
import { id } from "./security";
import { RequestError } from "./http";
import { marketWeekWindow, supplyUsage } from "./network";
import {
  loadPilotRun,
  pilotCapacity,
  pilotWeeks,
  requirePilotOperator,
} from "./pilot-operations";

const note = z.string().trim().min(10).max(1500);
const key = z.string().trim().min(1).max(100);
export async function amendPilotSupply(db: DB, actor: Actor, raw: unknown) {
  requirePilotOperator(actor);
  const input = z
    .object({
      runId: key,
      weekKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      previousSupplyId: key,
      replacementSupplyId: key,
      quantity: z.coerce.number().int().min(1).max(200),
      reason: note,
      payerOrganizationId: key,
      financialEvidence: note,
      programImplications: note,
      protectionReview: note,
      requestKey: z.string().min(8).max(200),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    await tx.query(
      "select singleton from growth_program_coordination where singleton=true for update",
    );
    const run = await loadPilotRun(tx, input.runId, true);
    const [existing] = await tx.query<{
      id: string;
      previous_supply_id: string;
      replacement_supply_id: string;
      committed_quantity: number;
      reason: string;
      payer_organization_id: string;
      financial_evidence: string;
      program_implications: string;
      protection_review: string;
      run_id: string;
      week_key: string;
    }>("select * from pilot_supply_amendments where request_key=$1", [
      input.requestKey,
    ]);
    if (existing) {
      if (
        existing.run_id !== input.runId ||
        existing.week_key !== input.weekKey ||
        existing.previous_supply_id !== input.previousSupplyId ||
        existing.replacement_supply_id !== input.replacementSupplyId ||
        existing.committed_quantity !== input.quantity ||
        existing.reason !== input.reason ||
        existing.payer_organization_id !== input.payerOrganizationId ||
        existing.financial_evidence !== input.financialEvidence ||
        existing.program_implications !== input.programImplications ||
        existing.protection_review !== input.protectionReview
      )
        throw new RequestError(
          "This request already records a different supply amendment.",
        );
      return existing.id;
    }
    const now = new Date();
    if (
      run.state === "complete" ||
      !pilotWeeks(run).includes(input.weekKey) ||
      input.weekKey <= marketWeekWindow(now, run.timezone!).weekKey
    )
      throw new RequestError(
        "Replace only an unreleased future week. Current or issued obligations use recovery.",
      );
    if (
      (
        await tx.query(
          "select id from weekly_releases where run_id=$1 and week_key=$2",
          [run.id, input.weekKey],
        )
      ).length
    )
      throw new RequestError(
        "This week is already released. Issued history cannot be changed.",
      );
    const [previous] = await tx.query(
      "select supply_id from effective_pilot_week_supplies where run_id=$1 and week_key=$2 and supply_id=$3",
      [run.id, input.weekKey, input.previousSupplyId],
    );
    if (!previous)
      throw new RequestError(
        "Choose the current supply commitment for this future week.",
      );
    await tx.query(
      "select id from network_drop_supplies where id=any($1::text[]) order by id for update",
      [[input.previousSupplyId, input.replacementSupplyId].sort()],
    );
    const [replacement] = await tx.query<{
      state: string;
      market_id: string;
      data_kind: string;
      starts_at: string;
      expires_at: string;
      required_spend: string;
      member_fee: string;
      funder_organization_id: string;
      fulfiller_organization_id: string;
      organization_id: string;
      ready: boolean;
      fallback_capacity: number;
      fallback_used: number;
    }>(
      `select s.*,t.required_spend,t.member_fee,t.funder_organization_id,t.fulfiller_organization_id,
       (d.state='ready' and d.owner_approved_by is not null and length(trim(d.primary_manager))>1
        and length(trim(d.primary_contact))>2 and length(trim(d.backup_contact))>2
        and d.stock_confirmed_at<=now() and d.stock_confirmed_at>now()-interval '72 hours'
        and d.exact_item_confirmed and d.staff_instructions_confirmed and d.valid_hours_confirmed
        and d.shifts_briefed_at<=now() and d.qr_rehearsed_at<=now() and length(trim(d.support_escalation))>=10
        and d.valid_until>=$2 and f.state='approved' and f.dependency_key<>t.dependency_key
        and exists(select 1 from market_locations ml where ml.market_id=s.market_id and ml.location_id=s.location_id and ml.active and not exists(select 1 from location_outages outage where outage.location_id=s.location_id and outage.closed_at is null))
        and exists(select 1 from redemption_points rp join redemption_credentials rc on rc.point_id=rp.id
         where rp.location_id=s.location_id and rp.state='active' and rp.exposure='staff' and rc.state='active' and rc.credential_type='qr')) ready,
       f.usable_capacity fallback_capacity,(select count(*)::int from recovery_grants rg where rg.fallback_id=f.id and (rg.state='redeemed' or (rg.superseded_at is null and rg.expires_at>now()))) fallback_used
      from network_drop_supplies s join pilot_supply_terms t on t.supply_id=s.id
      join destination_readiness d on d.supply_id=s.id join pilot_supply_fallbacks f on f.supply_id=s.id
      where s.id=$1`,
      [
        input.replacementSupplyId,
        marketWeekWindow(
          new Date(`${input.weekKey}T12:00:00Z`),
          run.timezone!,
        ).end.toISOString(),
      ],
    );
    const window = marketWeekWindow(
      new Date(`${input.weekKey}T12:00:00Z`),
      run.timezone!,
    );
    if (
      !replacement ||
      replacement.state !== "approved" ||
      replacement.market_id !== run.market_id ||
      replacement.data_kind !== run.data_kind ||
      !replacement.ready ||
      new Date(replacement.starts_at) > window.start ||
      new Date(replacement.expires_at) < window.end ||
      Number(replacement.required_spend) !== 0 ||
      Number(replacement.member_fee) !== 0 ||
      replacement.fulfiller_organization_id !== replacement.organization_id ||
      replacement.fallback_capacity - replacement.fallback_used < input.quantity
    )
      throw new RequestError(
        "Replacement needs matching free terms, a full future week, current staff readiness and independent fallback for every member.",
      );
    const usage = await supplyUsage(tx, input.replacementSupplyId);
    if (usage.remaining === null || usage.remaining < input.quantity)
      throw new RequestError(
        "Replacement stock is already committed or insufficient.",
      );
    const [payer] = await tx.query<{ is_demo: boolean }>(
      "select is_demo from organizations where id=$1",
      [input.payerOrganizationId],
    );
    if (!payer || (run.data_kind === "real" && payer.is_demo))
      throw new RequestError(
        "Choose the actual accountable payer for this amendment.",
      );
    const oldLinks = await tx.query<{ program_id: string }>(
      "select distinct program_id from program_supply_links where supply_id=$1",
      [input.previousSupplyId],
    );
    const newLinks = await tx.query<{
      program_id: string;
      week_key: string;
      status: string;
      program_version: number;
      pending_version: number | null;
      approved_version: number | null;
    }>(
      "select l.*,p.status,p.pending_version,p.approved_version from program_supply_links l join growth_programs p on p.id=l.program_id where l.supply_id=$1",
      [input.replacementSupplyId],
    );
    if (
      oldLinks.length &&
      (!newLinks.length ||
        oldLinks.length !== 1 ||
        newLinks.some((link) => link.program_id !== oldLinks[0].program_id))
    )
      throw new RequestError(
        "Paid supply must remain linked to the same Growth Program. Prepare and link its prospective version first; record any credit separately.",
      );
    if (
      newLinks.some(
        (link) =>
          link.week_key !== input.weekKey || link.status === "terminated",
      ) ||
      (newLinks.length &&
        !newLinks.some(
          (link) =>
            link.program_version ===
            (link.pending_version || link.approved_version),
        ))
    )
      throw new RequestError(
        "Replacement commercial supply needs the effective or pending Program version for this same week.",
      );
    const amendmentId = id();
    await tx.query(
      "insert into pilot_supply_amendments(id,run_id,week_key,previous_supply_id,replacement_supply_id,committed_quantity,reason,payer_organization_id,financial_evidence,program_implications,protection_review,created_by,request_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        amendmentId,
        run.id,
        input.weekKey,
        input.previousSupplyId,
        input.replacementSupplyId,
        input.quantity,
        input.reason,
        input.payerOrganizationId,
        input.financialEvidence,
        input.programImplications,
        input.protectionReview,
        actor.id,
        input.requestKey,
      ],
    );
    const backing = await pilotCapacity(tx, run, { reviewingCommercial: true });
    const [{ count }] = await tx.query<{ count: number }>(
      "select count(*)::int count from pilot_admissions where run_id=$1",
      [run.id],
    );
    const required = run.cohort_frozen_at
      ? count
      : Math.max(count, run.target_members);
    if (
      (backing.weeks.find((week) => week.week === input.weekKey)?.capacity ||
        0) < required
    )
      throw new RequestError(
        `Replacement must back the ${required} members required for this week.`,
      );
    await audit(
      tx,
      actor.id,
      null,
      "pilot.future_supply_amended",
      amendmentId,
      {
        ...input,
        capacity: backing,
        commercialApprovalStillRequired: newLinks.some(
          (link) => link.pending_version === link.program_version,
        ),
      },
    );
    return amendmentId;
  });
}
