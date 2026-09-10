import { uptickEnvironment, configuredSmsEnvironment } from "./environment";
export function localMode() {
  const url = process.env.APP_URL || "http://localhost:3000";
  try {
    return (
      uptickEnvironment() === "development" &&
      process.env.UPTICK_LOCAL_MODE === "true" &&
      !process.env.VERCEL &&
      ["localhost", "127.0.0.1"].includes(new URL(url).hostname)
    );
  } catch {
    return false;
  }
}
export function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}
export function key(name: string) {
  const value = process.env[name];
  if (value) return value;
  if (localMode())
    return "local-development-only-key-do-not-use-in-production-2026";
  throw new Error(`${name} must be configured`);
}
export function messagingReady() {
  return (
    configuredSmsEnvironment() &&
    process.env.MESSAGING_APPROVED === "true" &&
    process.env.LEGAL_APPROVED === "true" &&
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN &&
    appUrl().startsWith("https://")
  );
}
