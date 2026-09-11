import { Check } from "lucide-react";

export type TapReceiptRecord = {
  reward: string;
  merchant: string;
  redeemedAt: string | null;
  timezone: string;
  evidence: { method: string; staff_gated: boolean } | null;
};

export function TapReceipt({ record }: { record: TapReceiptRecord }) {
  return (
    <div className="tap-complete" role="status">
      <span className="tap-complete-check">
        <Check size={48} />
      </span>
      <p className="eyebrow">UPTICK REDEEMED</p>
      <h2>{record.reward}</h2>
      <strong>{record.merchant}</strong>
      {record.redeemedAt && (
        <time dateTime={record.redeemedAt}>
          {new Date(record.redeemedAt).toLocaleString("en-US", {
            timeZone: record.timezone,
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}
        </time>
      )}
      <p>
        Show this screen to the cashier.
        <br />
        This pass has been used.
      </p>
      <small>
        {record.evidence?.method === "secure_nfc"
          ? "Secure location credential recorded"
          : record.evidence?.method === "qr"
            ? "Location QR recorded"
            : record.evidence?.method === "self_confirm"
              ? "Self-confirmation recorded"
              : record.evidence?.method === "operator_override"
                ? "Operator-assisted redemption recorded"
                : "Recorded redemption"}
        {record.evidence?.staff_gated ? " · Staff-gated counter" : ""}
      </small>
    </div>
  );
}
