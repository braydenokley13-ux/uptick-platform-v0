"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { PilotPromiseOperations } from "@/lib/pilot-promise";

export type PilotPromiseControlsProps = {
  data: PilotPromiseOperations;
  organizations?: { id: string; name: string }[];
};

const value = (form: FormData, name: string) =>
  String(form.get(name) || "").trim();
const checked = (form: FormData, name: string) => form.get(name) === "on";
const instant = (form: FormData, name: string) => {
  const raw = value(form, name);
  return raw ? new Date(raw).toISOString() : null;
};
const record = (item: unknown) => item as Record<string, unknown>;

async function save(body: object) {
  const response = await fetch("/api/pilot-promise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw Error(result?.error || "Check the pilot promise details and try again.");
  return result;
}

function ControlForm({
  title,
  help,
  action,
  children,
}: {
  title: string;
  help: string;
  action: (form: FormData) => object;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await save(action(new FormData(event.currentTarget)));
      setNotice("Saved with an audit record.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel network-panel network-form" onSubmit={submit}>
      <div>
        <p className="eyebrow">PILOT PROMISE</p>
        <h3>{title}</h3>
        <p>{help}</p>
      </div>
      {children}
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : title}
      </button>
      {notice && <p role="status" className="success-text">{notice}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  );
}

function SupplySelect({ supplies }: { supplies: Record<string, unknown>[] }) {
  return (
    <label>
      Drop supply
      <select name="supplyId" required defaultValue="">
        <option value="" disabled>Choose a supply</option>
        {supplies.map((supply) => (
          <option key={String(supply.id)} value={String(supply.id)}>
            {String(supply.title || supply.exact_item || supply.id)} · {String(supply.merchant || "merchant")}
          </option>
        ))}
      </select>
    </label>
  );
}

function OrganizationInput({
  name,
  label,
  organizations,
}: {
  name: string;
  label: string;
  organizations: { id: string; name: string }[];
}) {
  return (
    <label>
      {label}
      <select name={name} required defaultValue="">
        <option value="" disabled>Choose an organization</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>{organization.name}</option>
        ))}
      </select>
    </label>
  );
}

export function PilotPromiseControls({
  data,
  organizations = [],
}: PilotPromiseControlsProps) {
  const supplies = useMemo(() => data.supplies.map(record), [data.supplies]);
  const organizationChoices = useMemo(() => {
    const found = new Map(organizations.map((item) => [item.id, item]));
    for (const supply of supplies) {
      const id = String(supply.organization_id || "");
      if (id && !found.has(id))
        found.set(id, { id, name: String(supply.merchant || id) });
    }
    return [...found.values()];
  }, [organizations, supplies]);
  const incidents = data.incidents.map(record);
  const fallbacks = supplies.filter((supply) => supply.fallback_id);
  return (
    <div className="network-grid equal">
      <ControlForm
        title="Save exact free terms"
        help="Name the actual item, size, usable hours, funding party and fulfilling party. Both money fields must remain zero."
        action={(form) => ({
          action: "configure_supply",
          supplyId: value(form, "supplyId"),
          exactItem: value(form, "exactItem"),
          itemSku: value(form, "itemSku"),
          sizeLabel: value(form, "sizeLabel"),
          usableHours: value(form, "usableHours"),
          dependencyKey: value(form, "dependencyKey"),
          requiredSpend: Number(value(form, "requiredSpend")),
          memberFee: Number(value(form, "memberFee")),
          funderOrganizationId: value(form, "funderOrganizationId"),
          fulfillerOrganizationId: value(form, "fulfillerOrganizationId"),
          dataKind: value(form, "dataKind"),
        })}
      >
        <SupplySelect supplies={supplies} />
        <label>Exact item<input name="exactItem" required /></label>
        <label>Item SKU<input name="itemSku" required /></label>
        <label>Size or variant<input name="sizeLabel" required /></label>
        <label>Usable days and hours<textarea name="usableHours" required /></label>
        <label>Primary dependency key<input name="dependencyKey" required placeholder="cold-brew-tank-a" /></label>
        <label>Required member spend<input name="requiredSpend" type="number" value="0" readOnly /></label>
        <label>Member fee<input name="memberFee" type="number" value="0" readOnly /></label>
        <OrganizationInput name="funderOrganizationId" label="Funding organization" organizations={organizationChoices} />
        <OrganizationInput name="fulfillerOrganizationId" label="Fulfilling organization" organizations={organizationChoices} />
        <label>Data classification<select name="dataKind" defaultValue="real"><option value="real">Real</option><option value="internal">Internal</option><option value="demo">Demo</option><option value="synthetic">Synthetic</option></select></label>
      </ControlForm>

      <ControlForm
        title="Save independent fallback"
        help="Reserve a same-counter substitute with a different dependency and a named payer."
        action={(form) => ({
          action: "save_fallback",
          supplyId: value(form, "supplyId"),
          substituteItem: value(form, "substituteItem"),
          substituteSku: value(form, "substituteSku"),
          sizeLabel: value(form, "sizeLabel"),
          dependencyKey: value(form, "dependencyKey"),
          usableCapacity: Number(value(form, "usableCapacity")),
          requiredSpend: 0,
          memberFee: 0,
          instructions: value(form, "instructions"),
          payerOrganizationId: value(form, "payerOrganizationId"),
          approve: checked(form, "approve"),
        })}
      >
        <SupplySelect supplies={supplies} />
        <label>Substitute item<input name="substituteItem" required /></label>
        <label>Substitute SKU<input name="substituteSku" required /></label>
        <label>Size or variant<input name="sizeLabel" required /></label>
        <label>Independent dependency key<input name="dependencyKey" required /></label>
        <label>Usable fallback units<input name="usableCapacity" type="number" min="1" required /></label>
        <label>Cashier instructions<textarea name="instructions" minLength={10} required /></label>
        <OrganizationInput name="payerOrganizationId" label="Fallback payer" organizations={organizationChoices} />
        <label><input name="approve" type="checkbox" /> Approve this finite fallback</label>
      </ControlForm>

      <ControlForm
        title="Save destination readiness"
        help="Record the people, stock, shift briefing, valid hours, QR rehearsal and support path at the real counter."
        action={(form) => ({
          action: "save_readiness",
          supplyId: value(form, "supplyId"),
          state: value(form, "state"),
          ownerApprovedBy: value(form, "ownerApprovedBy") || null,
          primaryManager: value(form, "primaryManager"),
          primaryContact: value(form, "primaryContact"),
          backupContact: value(form, "backupContact"),
          stockConfirmedAt: instant(form, "stockConfirmedAt"),
          exactItemConfirmed: checked(form, "exactItemConfirmed"),
          staffInstructionsConfirmed: checked(form, "staffInstructionsConfirmed"),
          shiftsBriefedAt: instant(form, "shiftsBriefedAt"),
          validHoursConfirmed: checked(form, "validHoursConfirmed"),
          qrRehearsedAt: instant(form, "qrRehearsedAt"),
          supportEscalation: value(form, "supportEscalation"),
          validUntil: instant(form, "validUntil"),
        })}
      >
        <SupplySelect supplies={supplies} />
        <label>Readiness state<select name="state" defaultValue="not_ready"><option value="not_ready">Not ready</option><option value="ready">Ready</option><option value="restricted">Restricted</option><option value="suspended">Suspended</option></select></label>
        <label>Owner approval recorded by<input name="ownerApprovedBy" /></label>
        <label>Primary manager<input name="primaryManager" /></label>
        <label>Primary contact<input name="primaryContact" /></label>
        <label>Backup contact<input name="backupContact" /></label>
        <label>Stock confirmed at<input name="stockConfirmedAt" type="datetime-local" /></label>
        <label><input name="exactItemConfirmed" type="checkbox" /> Exact item checked</label>
        <label><input name="staffInstructionsConfirmed" type="checkbox" /> Cashier instructions checked</label>
        <label>All serving shifts briefed at<input name="shiftsBriefedAt" type="datetime-local" /></label>
        <label><input name="validHoursConfirmed" type="checkbox" /> Usable hours checked</label>
        <label>QR rehearsal completed at<input name="qrRehearsedAt" type="datetime-local" /></label>
        <label>Support escalation path<textarea name="supportEscalation" /></label>
        <label>Readiness valid until<input name="validUntil" type="datetime-local" /></label>
      </ControlForm>

      <ControlForm
        title="Open fulfillment incident"
        help="Link the incident to its issued grant so the original promise and evidence stay intact."
        action={(form) => ({
          action: "report_incident",
          grantId: value(form, "grantId"),
          incidentType: value(form, "incidentType"),
          severity: value(form, "severity"),
          occurredAt: instant(form, "occurredAt"),
          owner: value(form, "owner"),
          note: value(form, "note"),
          idempotencyKey: value(form, "idempotencyKey"),
        })}
      >
        <label>Fulfillment grant ID<input name="grantId" required /></label>
        <label>Incident type<select name="incidentType" defaultValue="out_of_stock"><option value="out_of_stock">Out of stock</option><option value="staff_refusal">Staff refusal</option><option value="unexpected_closure">Unexpected closure</option><option value="incorrect_terms">Incorrect terms</option><option value="qr_failure">QR failure</option><option value="redemption_failure">Redemption failure</option><option value="inventory_mismatch">Inventory mismatch</option><option value="other">Other</option></select></label>
        <label>Severity<select name="severity" defaultValue="high"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label>Occurred at<input name="occurredAt" type="datetime-local" required /></label>
        <label>Incident owner<input name="owner" required /></label>
        <label>Observed details<textarea name="note" maxLength={2000} /></label>
        <label>Idempotency key<input name="idempotencyKey" minLength={8} required /></label>
      </ControlForm>

      <ControlForm
        title="Issue backed recovery"
        help="Use the original redeemed pass. The recovery does not create another weekly benefit or paid placement."
        action={(form) => ({
          action: "issue_recovery",
          incidentId: value(form, "incidentId"),
          remedyType: value(form, "remedyType"),
          fallbackId: value(form, "fallbackId") || null,
          replacementSupplyId: value(form, "replacementSupplyId") || null,
          payerOrganizationId: value(form, "payerOrganizationId"),
          payerEvidence: value(form, "payerEvidence"),
          expiresAt: instant(form, "expiresAt"),
        })}
      >
        <label>Incident<select name="incidentId" required defaultValue=""><option value="" disabled>Choose an incident</option>{incidents.map((incident) => <option key={String(incident.id)} value={String(incident.id)}>{String(incident.incident_type)} · {String(incident.id)}</option>)}</select></label>
        <label>Remedy type<select name="remedyType" defaultValue="same_counter"><option value="same_counter">Same-counter fallback</option><option value="replacement_supply">Independent replacement supply</option></select></label>
        <label>Approved fallback<select name="fallbackId" defaultValue=""><option value="">None</option>{fallbacks.map((fallback) => <option key={String(fallback.fallback_id)} value={String(fallback.fallback_id)}>{String(fallback.substitute_item)} · {String(fallback.fallback_id)}</option>)}</select></label>
        <label>Replacement supply<select name="replacementSupplyId" defaultValue=""><option value="">None</option>{supplies.map((supply) => <option key={String(supply.id)} value={String(supply.id)}>{String(supply.title || supply.id)}</option>)}</select></label>
        <OrganizationInput name="payerOrganizationId" label="Recovery payer" organizations={organizationChoices} />
        <label>Payer evidence<textarea name="payerEvidence" required /></label>
        <label>Recovery expires at<input name="expiresAt" type="datetime-local" required /></label>
      </ControlForm>
    </div>
  );
}
