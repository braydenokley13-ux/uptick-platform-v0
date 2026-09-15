import assert from "node:assert/strict";
import test from "node:test";
import { assertCloudDemoEnvironment } from "../src/lib/cloud-demo-guard";
import { renderCloudDemoMigration } from "../src/lib/cloud-demo-schema";

const projectRef = "abc123def456ghi789jk";
const vercelProject = "prj_CloudDemo123";
const origin = "https://demo.upticklocal.test";

function safeCloudEnvironment(
  changes: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    UPTICK_CLOUD_DEMO_MODE: "true",
    UPTICK_DEMO_MODE: "false",
    UPTICK_LOCAL_MODE: "false",
    UPTICK_ENV: "development",
    SMS_TRANSPORT: "development",
    PILOT_ENROLLMENT_ENABLED: "false",
    PRODUCTION_DELIVERY_ENABLED: "false",
    MEMBER_ACCESS_SMS_ENABLED: "false",
    MEMBER_PROMOTIONAL_SMS_ENABLED: "false",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: vercelProject,
    CLOUD_DEMO_VERCEL_PROJECT_ID: vercelProject,
    CLOUD_DEMO_PROJECT_REF: projectRef,
    APP_URL: origin,
    CLOUD_DEMO_ORIGIN: origin,
    CLOUD_DEMO_DATABASE_URL: `postgresql://uptick_cloud_demo_runtime:runtime-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    CLOUD_DEMO_INSTANCE_ID: `instance_${"i".repeat(32)}`,
    CLOUD_DEMO_ACCESS_KEY: `access_${"a".repeat(32)}`,
    SESSION_SECRET: `session_${"s".repeat(32)}`,
    PASS_ENCRYPTION_KEY: `passes_${"p".repeat(32)}`,
    CRON_SECRET: `cron_${"c".repeat(32)}`,
    PRIVACY_SUPPRESSION_KEY: `privacy_${"r".repeat(32)}`,
  };
  Object.assign(environment, changes);
  return environment;
}

test("accepts only the complete production Vercel cloud-demo boundary", () => {
  const environment = safeCloudEnvironment();
  assert.deepEqual(assertCloudDemoEnvironment(environment), {
    ref: projectRef,
    project: vercelProject,
    origin,
    databaseUrl: environment.CLOUD_DEMO_DATABASE_URL,
    instanceId: environment.CLOUD_DEMO_INSTANCE_ID,
  });

  const pooled = safeCloudEnvironment({
    CLOUD_DEMO_DATABASE_URL: `postgresql://uptick_cloud_demo_runtime.${projectRef}:runtime-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
  });
  assert.equal(assertCloudDemoEnvironment(pooled).ref, projectRef);
});

test("rejects missing hosting identity, local modes, delivery, and live credentials", () => {
  const cases: Array<[string, Partial<NodeJS.ProcessEnv>]> = [
    ["disabled cloud mode", { UPTICK_CLOUD_DEMO_MODE: "false" }],
    ["missing Vercel runtime", { VERCEL: undefined }],
    ["wrong Vercel runtime marker", { VERCEL: "0" }],
    ["missing Vercel environment", { VERCEL_ENV: undefined }],
    ["preview deployment", { VERCEL_ENV: "preview" }],
    ["development deployment", { VERCEL_ENV: "development" }],
    ["missing actual project", { VERCEL_PROJECT_ID: undefined }],
    ["different actual project", { VERCEL_PROJECT_ID: "prj_OtherDemo" }],
    ["local demo mode", { UPTICK_DEMO_MODE: "true" }],
    ["local application mode", { UPTICK_LOCAL_MODE: "true" }],
    ["non-demo application environment", { UPTICK_ENV: "production" }],
    ["Twilio transport", { SMS_TRANSPORT: "twilio" }],
    ["pilot enrollment", { PILOT_ENROLLMENT_ENABLED: "true" }],
    ["production delivery", { PRODUCTION_DELIVERY_ENABLED: "true" }],
    ["member access SMS", { MEMBER_ACCESS_SMS_ENABLED: "true" }],
    ["member promotional SMS", { MEMBER_PROMOTIONAL_SMS_ENABLED: "true" }],
    ["messaging approval", { MESSAGING_APPROVED: "true" }],
    ["legal approval", { LEGAL_APPROVED: "true" }],
    [
      "production database",
      { DATABASE_URL: "postgresql://production.invalid/postgres" },
    ],
    ["local database", { LOCAL_DATABASE_PATH: "/tmp/ordinary-data" }],
    ["Supabase URL", { SUPABASE_URL: "https://example.supabase.co" }],
    ["Supabase anonymous key", { SUPABASE_ANON_KEY: "hosted-anon-key" }],
    [
      "Supabase service key",
      { SUPABASE_SERVICE_ROLE_KEY: "hosted-service-key" },
    ],
    ["Twilio account", { TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}` }],
    ["Twilio credential", { TWILIO_AUTH_TOKEN: "live-auth-token" }],
  ];

  for (const [label, changes] of cases)
    assert.throws(
      () => assertCloudDemoEnvironment(safeCloudEnvironment(changes)),
      Error,
      label,
    );
});

test("rejects production, mismatched, and malformed hosting projects", () => {
  const cases: Array<[string, Partial<NodeJS.ProcessEnv>]> = [
    ["missing configured project", { CLOUD_DEMO_VERCEL_PROJECT_ID: undefined }],
    [
      "malformed configured project",
      { CLOUD_DEMO_VERCEL_PROJECT_ID: "CloudDemo123" },
    ],
    [
      "existing production project",
      {
        CLOUD_DEMO_VERCEL_PROJECT_ID: "prj_U1rgTJlWYnxdLOOu6wPppoa39W2c",
        VERCEL_PROJECT_ID: "prj_U1rgTJlWYnxdLOOu6wPppoa39W2c",
      },
    ],
    ["short Supabase ref", { CLOUD_DEMO_PROJECT_REF: "short" }],
    [
      "uppercase Supabase ref",
      { CLOUD_DEMO_PROJECT_REF: "ABC123def456ghi789jk" },
    ],
    [
      "punctuated Supabase ref",
      { CLOUD_DEMO_PROJECT_REF: "abc123def456ghi789j-" },
    ],
  ];

  for (const [label, changes] of cases)
    assert.throws(
      () => assertCloudDemoEnvironment(safeCloudEnvironment(changes)),
      Error,
      label,
    );
});

test("rejects unsafe, production, and mismatched origins", () => {
  const cases: Array<[string, Partial<NodeJS.ProcessEnv>]> = [
    ["HTTP origin", { APP_URL: "http://demo.upticklocal.test" }],
    [
      "pilot origin on original production project",
      {
        CLOUD_DEMO_VERCEL_PROJECT_ID: "prj_U1rgTJlWYnxdLOOu6wPppoa39W2c",
        VERCEL_PROJECT_ID: "prj_U1rgTJlWYnxdLOOu6wPppoa39W2c",
        APP_URL: "https://pilot.upticklocal.com",
        CLOUD_DEMO_ORIGIN: "https://pilot.upticklocal.com",
      },
    ],
    [
      "production root origin",
      {
        APP_URL: "https://upticklocal.com",
        CLOUD_DEMO_ORIGIN: "https://upticklocal.com",
      },
    ],
    [
      "origin mismatch",
      { CLOUD_DEMO_ORIGIN: "https://other.upticklocal.test" },
    ],
    ["path appended", { APP_URL: `${origin}/demo` }],
    ["query appended", { APP_URL: `${origin}?mode=demo` }],
    [
      "embedded credentials",
      {
        APP_URL: "https://user:pass@demo.upticklocal.test",
        CLOUD_DEMO_ORIGIN: "https://user:pass@demo.upticklocal.test",
      },
    ],
    ["invalid URL", { APP_URL: "not a URL", CLOUD_DEMO_ORIGIN: "not a URL" }],
  ];

  for (const [label, changes] of cases)
    assert.throws(
      () => assertCloudDemoEnvironment(safeCloudEnvironment(changes)),
      Error,
      label,
    );
});

test("accepts only the restricted runtime role on the configured Supabase project", () => {
  const otherRef = "xyz123abc456def789gh";
  const cases: Array<[string, string]> = [
    [
      "wrong direct role",
      `postgresql://postgres:password@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    ],
    [
      "wrong direct project",
      `postgresql://uptick_cloud_demo_runtime:password@db.${otherRef}.supabase.co:5432/postgres?sslmode=require`,
    ],
    [
      "lookalike direct host",
      `postgresql://uptick_cloud_demo_runtime:password@db.${projectRef}.supabase.co.example.test:5432/postgres?sslmode=require`,
    ],
    [
      "wrong pooled role",
      `postgresql://postgres.${projectRef}:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    ],
    [
      "wrong pooled project",
      `postgresql://uptick_cloud_demo_runtime.${otherRef}:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    ],
    [
      "wrong database",
      `postgresql://uptick_cloud_demo_runtime:password@db.${projectRef}.supabase.co:5432/template1?sslmode=require`,
    ],
    [
      "missing password",
      `postgresql://uptick_cloud_demo_runtime@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    ],
    [
      "URL fragment",
      `postgresql://uptick_cloud_demo_runtime:password@db.${projectRef}.supabase.co:5432/postgres?sslmode=require#unsafe`,
    ],
    [
      "disabled TLS",
      `postgresql://uptick_cloud_demo_runtime:password@db.${projectRef}.supabase.co:5432/postgres?sslmode=disable`,
    ],
    [
      "extra option",
      `postgresql://uptick_cloud_demo_runtime:password@db.${projectRef}.supabase.co:5432/postgres?sslmode=require&options=unsafe`,
    ],
  ];

  for (const [label, databaseUrl] of cases)
    assert.throws(
      () =>
        assertCloudDemoEnvironment(
          safeCloudEnvironment({ CLOUD_DEMO_DATABASE_URL: databaseUrl }),
        ),
      Error,
      label,
    );
});

test("requires strong independent cloud-demo secrets", () => {
  assert.throws(
    () =>
      assertCloudDemoEnvironment(
        safeCloudEnvironment({ SESSION_SECRET: "too-short" }),
      ),
    /independent SESSION_SECRET/i,
  );
  const shared = `shared_${"x".repeat(32)}`;
  assert.throws(
    () =>
      assertCloudDemoEnvironment(
        safeCloudEnvironment({
          CLOUD_DEMO_ACCESS_KEY: shared,
          PASS_ENCRYPTION_KEY: shared,
        }),
      ),
    /independent/i,
  );
});

test("renders only private-schema syntax and the demo advisory lock", () => {
  const source = `
create table example (
  public_token text not null,
  exposure text not null default 'public',
  verification_mode text not null default 'public_tap'
);
create function protect_example() returns trigger language plpgsql
  SET search_path = public, pg_temp as $$ begin
    perform pg_advisory_xact_lock(73418,1);
    return new;
  end $$;
alter function public.protect_example() set search_path = public, pg_temp;
select pg_advisory_xact_lock(73418,2);
`;

  const rendered = renderCloudDemoMigration(source);

  assert.match(rendered, /public_token text not null/);
  assert.match(rendered, /default 'public'/);
  assert.match(rendered, /default 'public_tap'/);
  assert.match(rendered, /set search_path=uptick_cloud_demo,pg_temp/gi);
  assert.match(
    rendered,
    /alter function uptick_cloud_demo\.protect_example\(\)/i,
  );
  assert.match(rendered, /pg_advisory_xact_lock\(73419,1\)/);
  assert.match(rendered, /pg_advisory_xact_lock\(73418,2\)/);
  assert.doesNotMatch(rendered, /set\s+search_path\s*=\s*public\b/i);
  assert.doesNotMatch(rendered, /alter\s+function\s+public\./i);
  assert.doesNotMatch(rendered, /pg_advisory_xact_lock\(73418,1\)/);
  assert.match(source, /set search_path = public, pg_temp/i);
  assert.match(source, /pg_advisory_xact_lock\(73418,1\)/);
});
