export type UptickEnvironment = "development" | "staging" | "production";

// Missing hosted configuration is an error, never an implicit production choice.
export function uptickEnvironment(): UptickEnvironment | null {
  const configured = process.env.UPTICK_ENV;
  if (["development", "staging", "production"].includes(configured || "")) {
    if (configured === "production" && process.env.VERCEL_ENV === "preview")
      return null;
    return configured as UptickEnvironment;
  }
  if (
    !configured &&
    process.env.UPTICK_LOCAL_MODE === "true" &&
    !process.env.VERCEL
  ) {
    try {
      if (
        ["localhost", "127.0.0.1"].includes(
          new URL(process.env.APP_URL || "http://localhost:3000").hostname,
        )
      )
        return "development";
    } catch {
      /* Invalid origins fail closed. */
    }
  }
  return null;
}

export function stagingRecipients() {
  const entries = (process.env.INTERNAL_TEST_NUMBERS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  // A malformed allowlist disables delivery rather than silently dropping mistakes.
  return entries.length && entries.every((v) => /^\+1\d{10}$/.test(v))
    ? [...new Set(entries)]
    : [];
}
export function simulatedTransport() {
  return (
    ["development", "staging"].includes(uptickEnvironment() || "") &&
    process.env.SMS_TRANSPORT === "development"
  );
}
export function smsEnvironmentBlock(phone?: string) {
  const environment = uptickEnvironment();
  if (!environment) return "Set a valid UPTICK_ENV before delivery.";
  if (simulatedTransport()) return null;
  if (environment === "development") return "Development never sends real SMS.";
  if (process.env.SMS_TRANSPORT !== "twilio")
    return "Choose an explicit SMS transport.";
  if (
    environment === "staging" &&
    (!phone || !stagingRecipients().includes(phone))
  )
    return "Staging sends only to allowlisted internal numbers.";
  if (
    environment === "production" &&
    process.env.PRODUCTION_DELIVERY_ENABLED !== "true"
  )
    return "Production delivery is not explicitly enabled.";
  return null;
}
export function configuredSmsEnvironment() {
  const environment = uptickEnvironment();
  return (
    !!environment &&
    environment !== "development" &&
    process.env.SMS_TRANSPORT === "twilio" &&
    (environment === "staging"
      ? stagingRecipients().length > 0
      : process.env.PRODUCTION_DELIVERY_ENABLED === "true")
  );
}
