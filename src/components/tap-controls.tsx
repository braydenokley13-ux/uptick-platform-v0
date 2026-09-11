"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Radio, ShieldCheck } from "lucide-react";
import { TapReceipt, type TapReceiptRecord } from "./tap-receipt";

async function action(body: object) {
  let response: Response;
  try {
    response = await fetch("/api/tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw Error("We couldn’t connect. Check your connection and try again.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("Uptick is temporarily unavailable. Please try again.");
  }
  if (!response.ok)
    throw Error(data.error || "Check the details and try again.");
  return data;
}

export function TapRedeemButton({
  pointToken,
  nfc,
  passToken,
  selfConfirm = false,
}: {
  pointToken?: string;
  nfc?: { encryptedPicc: string; mac: string };
  passToken?: string;
  selfConfirm?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<TapReceiptRecord | null>(null);
  async function redeem() {
    setBusy(true);
    setError("");
    try {
      setResult(
        await action({
          action: "redeem",
          pointToken,
          nfc,
          passToken,
          selfConfirm,
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (result) return <TapReceipt record={result} />;
  return (
    <div className="tap-confirm">
      <button className="button" disabled={busy} onClick={redeem}>
        {busy
          ? "Checking your pass…"
          : selfConfirm
            ? "Confirm this approved redemption"
            : "Confirm & redeem at this counter"}
        {!busy && <ShieldCheck size={18} />}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="fine-print">
        One use. Confirm when you’re ready to collect your reward.
      </p>
    </div>
  );
}

export type TapLocationOption = {
  id: string;
  organization_id: string;
  merchant: string;
  name: string;
};
export function TapCreatePoint({
  locations,
}: {
  locations: TapLocationOption[];
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const location = locations.find((l) => l.id === form.get("locationId"));
    if (!location) {
      setError("Choose a store location.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await action({
        action: "create-point",
        locationId: location.id,
        organizationId: location.organization_id,
        name: form.get("name"),
        exposure: form.get("exposure"),
      });
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="tap-setup-form" onSubmit={submit}>
      <label>
        Store location
        <select name="locationId" required defaultValue="">
          <option value="" disabled>
            Choose a store
          </option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.merchant} · {l.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Point name
        <input name="name" placeholder="Counter 01" required maxLength={100} />
      </label>
      <label>
        How customers reach it
        <select name="exposure">
          <option value="staff">
            Staff presents Tap after checking the offer
          </option>
          <option value="public">Public Tap for no-purchase offers</option>
        </select>
      </label>
      <p className="fine-print">
        This permanent point works across future Drops. Changing the store or
        access policy requires a replacement point.
      </p>
      <button className="button" disabled={busy}>
        {busy ? "Creating…" : "Create permanent point"}
        <Radio size={17} />
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function TapPointControls({
  pointId,
  state,
}: {
  pointId: string;
  state: string;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function send(body: object) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await action({ ...body, pointId });
      setNotice(
        data.simulation
          ? `Rehearsal recorded: ${data.simulation.outcome.replaceAll("_", " ")}. No production redemption or hardware test.`
          : "Saved. The current credentials are shown below.",
      );
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void send({ ...values, action: "rotate", type: "secure_nfc" });
  }
  return (
    <div className="tap-point-controls">
      {state === "active" && (
        <>
          <details>
            <summary>Replace QR or revoke this point</summary>
            <p className="fine-print">
              Replacing the QR immediately invalidates the printed version.
              Print and install the replacement before offering it to customers.
            </p>
            <div className="tap-action-row">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => send({ action: "rotate", type: "qr" })}
              >
                Replace QR
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => send({ action: "revoke" })}
              >
                Revoke point
              </button>
            </div>
          </details>
          <details>
            <summary>Provision or replace secure NFC</summary>
            <p className="fine-print">
              Use the server key references prepared by your technical operator.
              Secret keys never go into this form. This records a software
              configuration; it does not program or test a physical tag.
            </p>
            <form className="tap-setup-form" onSubmit={provision}>
              <label>
                Seven-byte tag UID
                <input
                  name="uid"
                  placeholder="14 hexadecimal characters"
                  pattern="[a-fA-F0-9]{14}"
                  required
                />
              </label>
              <label>
                Metadata key reference
                <input
                  name="metaKeyRef"
                  placeholder="UPTICK_NFC_KEY_STORE01_META"
                  pattern="UPTICK_NFC_KEY_[A-Z0-9_]+"
                  required
                />
              </label>
              <label>
                File-read key reference
                <input
                  name="fileKeyRef"
                  placeholder="UPTICK_NFC_KEY_STORE01_READ"
                  pattern="UPTICK_NFC_KEY_[A-Z0-9_]+"
                  required
                />
              </label>
              <button className="button secondary" disabled={busy}>
                Save NFC configuration
              </button>
            </form>
          </details>
        </>
      )}
      <details>
        <summary>Run an isolated software rehearsal</summary>
        <p className="fine-print">
          These isolated scenarios run the same location, revocation and replay
          checks used by redemption. The NXP reference checks the cryptographic
          adapter. No member pass or production counter changes.
        </p>
        <div className="tap-action-row">
          {[
            ["qr", "QR rehearsal"],
            ["secure_nfc_vector", "NXP reference vector"],
            ["wrong_location", "Wrong store"],
            ["replay", "Replay"],
            ["revoked", "Revoked point"],
          ].map(([scenario, label]) => (
            <button
              className="button secondary"
              key={scenario}
              disabled={busy}
              onClick={() => send({ action: "simulate", scenario })}
            >
              {label}
            </button>
          ))}
        </div>
      </details>
      {notice && (
        <p className="tap-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
