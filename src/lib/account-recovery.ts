import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { appUrl, localMode } from "./config";
import { demoMode } from "./demo-guard";
import { decrypt, encrypt } from "./security";
import { RequestError } from "./http";
import { accountRecoveryOptions } from "./account-security";

const COOKIE = "uptick-recovery-verifiers";
// Only short-lived PKCE verifiers persist. Supabase session data stays in this
// request's memory and then moves to the separate encrypted account cookie.
export async function recoveryAuthClient() {
  if (
    demoMode() ||
    localMode() ||
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_ANON_KEY ||
    !appUrl().startsWith("https://")
  )
    throw new RequestError(
      "Hosted password recovery is unavailable in this environment.",
      503,
    );
  const jar = await cookies();
  let entries: Record<string, string> = {};
  try {
    const value = jar.get(COOKIE)?.value;
    if (value) {
      const parsed = JSON.parse(decrypt(value));
      if (
        parsed.expires > Date.now() &&
        parsed.entries &&
        typeof parsed.entries === "object"
      )
        entries = parsed.entries;
    }
  } catch {
    entries = {};
  }
  const memory: Record<string, string> = {};
  const isVerifier = (name: string) =>
    name.startsWith("uptick-recovery-") && name.endsWith("code-verifier");
  function persist() {
    const value = JSON.stringify({ entries, expires: Date.now() + 15 * 60000 });
    if (value.length > 2200)
      throw new RequestError(
        "Too many pending recovery requests. Wait fifteen minutes and try again.",
        429,
      );
    jar.set(COOKIE, encrypt(value), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 15 * 60,
      path: "/",
    });
  }
  const storage: SupportedStorage = {
    getItem: (name) =>
      (isVerifier(name) ? entries[name] : memory[name]) ?? null,
    setItem: (name, value) => {
      if (isVerifier(name)) {
        entries[name] = value;
        persist();
      } else memory[name] = value;
    },
    removeItem: (name) => {
      if (isVerifier(name)) {
        delete entries[name];
        persist();
      } else delete memory[name];
    },
  };
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    accountRecoveryOptions(storage),
  );
}
