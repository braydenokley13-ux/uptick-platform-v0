// Cloud rehearsal is a distinct deployment, never a relaxation of local mode.
export const cloudDemoMode = () =>
  process.env.UPTICK_CLOUD_DEMO_MODE === "true";

export function assertCloudDemoEnvironment(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.UPTICK_CLOUD_DEMO_MODE !== "true")
    throw Error("Cloud Demo Studio is disabled.");
  if (
    env.UPTICK_DEMO_MODE === "true" ||
    env.UPTICK_LOCAL_MODE === "true" ||
    env.UPTICK_ENV !== "development" ||
    env.SMS_TRANSPORT !== "development" ||
    env.PILOT_ENROLLMENT_ENABLED !== "false" ||
    env.PRODUCTION_DELIVERY_ENABLED !== "false" ||
    env.MEMBER_ACCESS_SMS_ENABLED !== "false" ||
    env.MEMBER_PROMOTIONAL_SMS_ENABLED !== "false" ||
    env.DATABASE_URL ||
    env.LOCAL_DATABASE_PATH ||
    env.SUPABASE_URL ||
    env.SUPABASE_ANON_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.TWILIO_ACCOUNT_SID ||
    env.TWILIO_AUTH_TOKEN ||
    env.MESSAGING_APPROVED === "true" ||
    env.LEGAL_APPROVED === "true" ||
    env.VERCEL !== "1" ||
    env.VERCEL_ENV !== "production"
  )
    throw Error(
      "Cloud demo refuses live services, local storage and preview execution.",
    );
  const ref = env.CLOUD_DEMO_PROJECT_REF || "";
  const project = env.CLOUD_DEMO_VERCEL_PROJECT_ID || "";
  // The existing application deployment cannot become this sandbox. The user
  // permits sharing the database host, only through the restricted schema role.
  if (
    !/^[a-z0-9]{20}$/.test(ref) ||
    !/^prj_[A-Za-z0-9]+$/.test(project) ||
    project === "prj_U1rgTJlWYnxdLOOu6wPppoa39W2c" ||
    env.VERCEL_PROJECT_ID !== project
  )
    throw Error(
      "Cloud demo requires its own approved hosting and database projects.",
    );
  let origin: URL;
  let database: URL;
  try {
    origin = new URL(env.APP_URL || "");
    database = new URL(env.CLOUD_DEMO_DATABASE_URL || "");
  } catch {
    throw Error("Configure the dedicated cloud demo origin and database.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.APP_URL ||
    origin.origin !== env.CLOUD_DEMO_ORIGIN ||
    ["upticklocal.com", "www.upticklocal.com"].includes(origin.hostname) ||
    origin.username ||
    origin.password
  )
    throw Error("Cloud demo requires a separate exact HTTPS origin.");
  const direct =
    database.hostname === `db.${ref}.supabase.co` &&
    database.username === "uptick_cloud_demo_runtime";
  const pooled =
    /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname) &&
    decodeURIComponent(database.username) ===
      `uptick_cloud_demo_runtime.${ref}`;
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    (!direct && !pooled) ||
    database.pathname !== "/postgres" ||
    !database.password ||
    database.hash ||
    [...database.searchParams.keys()].some((key) => key !== "sslmode") ||
    (database.searchParams.has("sslmode") &&
      database.searchParams.get("sslmode") !== "require")
  )
    throw Error("Cloud demo database does not match its dedicated project.");
  for (const name of [
    "CLOUD_DEMO_INSTANCE_ID",
    "CLOUD_DEMO_ACCESS_KEY",
    "SESSION_SECRET",
    "PASS_ENCRYPTION_KEY",
    "CRON_SECRET",
    "PRIVACY_SUPPRESSION_KEY",
  ])
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(env[name] || ""))
      throw Error(`Configure an independent ${name} for the cloud demo.`);
  const secrets = [
    env.CLOUD_DEMO_ACCESS_KEY,
    env.SESSION_SECRET,
    env.PASS_ENCRYPTION_KEY,
    env.CRON_SECRET,
    env.PRIVACY_SUPPRESSION_KEY,
  ];
  if (new Set(secrets).size !== secrets.length)
    throw Error("Cloud demo secrets must be independent.");
  return {
    ref,
    project,
    origin: origin.origin,
    databaseUrl: database.toString(),
    instanceId: env.CLOUD_DEMO_INSTANCE_ID!,
  };
}
