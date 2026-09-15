import { resolve, basename, dirname } from "node:path";
import { lstatSync, realpathSync, readFileSync } from "node:fs";

export const demoMode = () => process.env.UPTICK_DEMO_MODE === "true";

// Run before choosing a database or transport, including when a DB is cached.
export function assertDemoEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.UPTICK_DEMO_MODE !== "true") throw Error("Demo Studio is disabled.");
  const root = env.UPTICK_DEMO_ROOT;
  let origin: URL;
  try {
    origin = new URL(env.APP_URL || "");
  } catch {
    throw Error("Demo requires a loopback origin.");
  }
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname)
  )
    throw Error("Demo rejects hosted origins.");
  if (
    env.DATABASE_URL ||
    env.VERCEL ||
    env.VERCEL_ENV ||
    env.SUPABASE_URL ||
    env.SUPABASE_ANON_KEY
  )
    throw Error("Demo rejects DATABASE_URL and hosted service configuration.");
  if (
    env.UPTICK_ENV !== "development" ||
    env.UPTICK_LOCAL_MODE !== "true" ||
    env.SMS_TRANSPORT !== "development" ||
    env.PRODUCTION_DELIVERY_ENABLED !== "false" ||
    env.PILOT_ENROLLMENT_ENABLED !== "false" ||
    env.TWILIO_ACCOUNT_SID ||
    env.TWILIO_AUTH_TOKEN
  )
    throw Error(
      "Demo requires local development with real enrollment and real SMS disabled.",
    );
  if (
    !root ||
    !root.startsWith("/") ||
    basename(root) !== ".demo-studio" ||
    resolve(env.LOCAL_DATABASE_PATH || "") !== resolve(root, "database")
  )
    throw Error("Demo requires its own isolated database path.");
  return { root: resolve(root), database: resolve(root, "database") };
}

export function assertDemoStorage() {
  const paths = assertDemoEnvironment();
  const marker = JSON.parse(
    readFileSync(resolve(paths.root, "ownership.json"), "utf8"),
  );
  if (
    marker.kind !== "uptick-isolated-demo-v1" ||
    marker.repository !== dirname(paths.root) ||
    marker.database !== paths.database
  )
    throw Error("Demo storage ownership does not match this checkout.");
  for (const path of [paths.root, paths.database]) {
    if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path)
      throw Error(
        "Demo storage cannot be a symlink or alias to other storage.",
      );
  }
  return paths;
}
