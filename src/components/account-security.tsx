"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ActionButton } from "./forms";

type SecurityState = {
  email: string;
  role: string;
  aal: string;
  recoveryOnly: boolean;
  mustVerify: boolean;
  destination: string;
  factors: { id: string; name: string; status: string; type: string }[];
};
async function accountCommand(data: object) {
  const response = await fetch("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json().catch(() => {
    throw Error("Account security is temporarily unavailable. Try again.");
  });
  if (!response.ok)
    throw Error(result.error || "The account change could not be saved.");
  return result;
}

export function AccountSecurity() {
  const [state, setState] = useState<SecurityState | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<{
    id: string;
    qr: string;
    secret: string;
  } | null>(null);
  const pending = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const router = useRouter();
  async function refresh() {
    const response = await fetch("/api/account", { cache: "no-store" });
    const next = await response.json().catch(() => {
      throw Error("Account security could not be loaded. Sign in again.");
    });
    if (!response.ok)
      throw Error(next.error || "Sign in again to manage account security.");
    setState(next);
  }
  useEffect(() => {
    let active = true;
    fetch("/api/account", { cache: "no-store" })
      .then(async (response) => {
        const next = await response.json();
        if (!response.ok)
          throw Error(
            next.error || "Sign in again to manage account security.",
          );
        if (active) setState(next);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Account security could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    if (action === "password" && fields.password !== fields.confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await accountCommand({ ...fields, action });
      if (result.redirect) {
        router.replace(result.redirect);
        router.refresh();
        return;
      }
      if (result.enrollment) setEnrollment(result.enrollment);
      else {
        setEnrollment(null);
        setMessage(result.message || "Account security updated.");
        form.reset();
      }
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not reach account security. Try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const verified =
    state?.factors.filter(
      (f) => f.status === "verified" && f.type === "totp",
    ) || [];
  return (
    <div className="stack-form">
      {error && (
        <p className="error" role="alert" ref={alert} tabIndex={-1}>
          {error}
        </p>
      )}
      {message && (
        <p className="success-text" role="status">
          {message}
        </p>
      )}
      {!state ? (
        <p>
          Loading your account security…{" "}
          <Link href="/login">Return to sign in</Link>
        </p>
      ) : (
        <>
          <p>
            Signed in as <strong>{state.email}</strong>.{" "}
            {state.aal === "aal2"
              ? "This session has two-factor protection."
              : "This session has password or email verification."}
          </p>
          {state.recoveryOnly && (
            <p className="notice">
              Password recovery is in progress. Verify your existing
              authenticator, if you have one, then choose a new password.
            </p>
          )}
          {state.factors.some(
            (f) => f.status === "verified" && f.type !== "totp",
          ) &&
            state.aal !== "aal2" && (
              <p className="notice">
                This account has a factor type outside Uptick’s authenticator
                flow. Ask your operator to use verified Supabase recovery and
                commission a TOTP authenticator. Existing factor protection
                remains enforced.
              </p>
            )}
          {state.mustVerify && (
            <p className="notice">
              Complete authenticator verification before opening the business
              workspace.
            </p>
          )}
          {verified.length > 0 && (
            <form className="stack-form" onSubmit={(e) => submit(e, "verify")}>
              <fieldset disabled={busy}>
                <legend>Verify an authenticator</legend>
                <label>
                  Authenticator
                  <select name="factorId" required defaultValue="">
                    <option value="" disabled>
                      Choose your primary or backup authenticator
                    </option>
                    {verified.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Current six-digit code
                  <input
                    name="code"
                    required
                    pattern="[0-9]{6}"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </label>
                <button className="button">
                  {busy ? "Working…" : "Verify authenticator"}
                </button>
              </fieldset>
            </form>
          )}
          {!state.recoveryOnly &&
            (verified.length === 0 || state.aal === "aal2") && (
              <>
                <form
                  className="stack-form"
                  onSubmit={(e) => submit(e, "enroll")}
                >
                  <fieldset
                    disabled={
                      busy ||
                      !!enrollment ||
                      (state.aal !== "aal2" &&
                        state.factors.some((f) => f.status === "verified"))
                    }
                  >
                    <legend>
                      {verified.length
                        ? "Add a backup authenticator"
                        : "Set up your authenticator"}
                    </legend>
                    <p>
                      Give it a name you will recognize. Keep a backup
                      authenticator on a separately controlled device or secure
                      storage.
                    </p>
                    <label>
                      Authenticator name
                      <input
                        name="name"
                        required
                        minLength={3}
                        maxLength={50}
                        placeholder="Primary phone or backup device"
                      />
                    </label>
                    <button className="button">Start setup</button>
                  </fieldset>
                </form>
                {enrollment && (
                  <section
                    className="stack-form"
                    aria-label="New authenticator setup"
                  >
                    <h2>Save this authenticator</h2>
                    <p>
                      Scan this QR code in your authenticator app. Keep this
                      page private.
                    </p>
                    {/* The provider QR is rendered as an image, never injected HTML. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        enrollment.qr.startsWith("data:image/")
                          ? enrollment.qr
                          : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qr)}`
                      }
                      alt="Scan with your authenticator app"
                      width={220}
                      height={220}
                    />
                    <details>
                      <summary>Enter the setup key manually</summary>
                      <code style={{ overflowWrap: "anywhere" }}>
                        {enrollment.secret}
                      </code>
                    </details>
                    <form onSubmit={(e) => submit(e, "verify")}>
                      <fieldset disabled={busy}>
                        <legend>Finish setup</legend>
                        <input
                          name="factorId"
                          type="hidden"
                          value={enrollment.id}
                        />
                        <label>
                          Current six-digit code
                          <input
                            required
                            name="code"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            pattern="[0-9]{6}"
                            maxLength={6}
                          />
                        </label>
                        <button className="button">
                          Verify and save authenticator
                        </button>
                      </fieldset>
                    </form>
                  </section>
                )}
              </>
            )}
          {!state.recoveryOnly && state.factors.length > 0 && (
            <section>
              <h2>Your authenticators</h2>
              <p>
                Keep at least one verified authenticator. Test your backup
                before removing a lost or replaced device.
              </p>
              {state.factors.map((f) => (
                <form
                  key={f.id}
                  className="stack-form"
                  onSubmit={(e) => submit(e, "remove")}
                >
                  <input type="hidden" name="factorId" value={f.id} />
                  <p>
                    {f.name} —{" "}
                    {f.status === "verified"
                      ? "Verified"
                      : "Setup unfinished; restart if you no longer have the key"}
                  </p>
                  <button
                    className="button secondary"
                    disabled={
                      busy ||
                      f.type !== "totp" ||
                      (f.status === "verified" &&
                        (verified.length < 2 || state.aal !== "aal2"))
                    }
                  >
                    Remove {f.name}
                  </button>
                </form>
              ))}
            </section>
          )}
          {state.recoveryOnly && (
            <form
              className="stack-form"
              onSubmit={(e) => submit(e, "password")}
            >
              <fieldset
                disabled={
                  busy ||
                  (state.factors.some((f) => f.status === "verified") &&
                    state.aal !== "aal2")
                }
              >
                <legend>Choose a new password</legend>
                <p>
                  Use at least twelve characters. A password manager can create
                  and save a strong password. Saving signs out all existing
                  Uptick account sessions.
                </p>
                <label>
                  New password
                  <input
                    required
                    type="password"
                    name="password"
                    minLength={12}
                    maxLength={200}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Repeat new password
                  <input
                    required
                    type="password"
                    name="confirmPassword"
                    minLength={12}
                    maxLength={200}
                    autoComplete="new-password"
                  />
                </label>
                <button className="button">Save password and sign out</button>
              </fieldset>
            </form>
          )}
          {!state.recoveryOnly && (
            <form onSubmit={(e) => submit(e, "revoke_others")}>
              <button
                className="button secondary"
                disabled={
                  busy ||
                  (state.factors.some((f) => f.status === "verified") &&
                    state.aal !== "aal2")
                }
              >
                Sign out all other sessions
              </button>
            </form>
          )}
          {!state.recoveryOnly && !state.mustVerify && (
            <Link className="button" href={state.destination}>
              Open business workspace
            </Link>
          )}
          <p>
            <Link href="/account/recovery">Password recovery</Link>. Lost every
            authenticator? Contact the backup Uptick operator for the verified
            provider recovery process.
          </p>
          <ActionButton action="logout" secondary>
            Sign out this session
          </ActionButton>
        </>
      )}
    </div>
  );
}

export function AccountRecovery({
  code,
  flowId,
}: {
  code?: string;
  flowId?: string;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const email = new FormData(event.currentTarget).get("email");
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await accountCommand(
        code
          ? { action: "exchange_recovery", code, flowId }
          : { action: "request_recovery", email },
      );
      if (result.redirect) {
        router.replace(result.redirect);
        router.refresh();
      } else setMessage(result.message);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not reach account recovery. Try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="stack-form" onSubmit={submit}>
      <p>
        {code
          ? "Continue to verify this recovery link. Opening the page alone does not change your account."
          : "Enter the email you use for your business account. Open the recovery email in this same browser within fifteen minutes."}
      </p>
      {!code && (
        <label>
          Email address
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            disabled={busy}
          />
        </label>
      )}
      {error && (
        <p ref={alert} tabIndex={-1} role="alert" className="error">
          {error}{" "}
          {code && <Link href="/account/recovery">Request a new link</Link>}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button className="button" disabled={busy}>
        {busy
          ? "Working…"
          : code
            ? "Continue password recovery"
            : "Request recovery email"}
      </button>
      <Link href="/login">Back to sign in</Link>
    </form>
  );
}
