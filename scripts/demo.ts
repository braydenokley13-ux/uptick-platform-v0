import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  lstat,
  realpath,
  readdir,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createServer, type Server } from "node:net";

const repo = await realpath(process.cwd());
const root = resolve(repo, ".demo-studio");
const app = resolve(root, "app");
const reset = process.argv.includes("--reset");
class DemoStopped extends Error {}
// The snapshot has no .env files and the child inherits only OS essentials.
// Reject conflicting shell settings instead of quietly overriding a live target.
for (const key of [
  "DATABASE_URL",
  "VERCEL",
  "VERCEL_ENV",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
])
  if (process.env[key])
    throw Error(
      `Demo refuses inherited ${key}. Open a terminal without hosted service settings.`,
    );
if (
  (process.env.APP_URL &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(
      process.env.APP_URL,
    )) ||
  (process.env.SMS_TRANSPORT && process.env.SMS_TRANSPORT !== "development") ||
  process.env.PILOT_ENROLLMENT_ENABLED === "true" ||
  process.env.PRODUCTION_DELIVERY_ENABLED === "true"
)
  throw Error(
    "Demo refuses hosted origins, real enrollment and real SMS settings.",
  );
async function lease(port: number): Promise<Server> {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((done, fail) => {
    server.once("error", () =>
      fail(
        Error(
          `Demo port ${port} is in use or unavailable. Stop the running demo with Control-C before launching or resetting.`,
        ),
      ),
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, done);
  });
  return server;
}
// Kernel-owned locks disappear when the process exits; stale PID files never
// authorize a reset. Also detect a child server left behind by a killed parent.
const controlLease = await lease(3211);
const applicationLease = await lease(3210).catch((error) => {
  controlLease.close();
  throw error;
});
await new Promise<void>((done) => applicationLease.close(() => done()));
try {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
    throw Error("Demo root must not be a symlink.");
  const ownership = {
    kind: "uptick-isolated-demo-v1",
    repository: repo,
    database: resolve(root, "database"),
  };
  try {
    const saved = JSON.parse(
      await readFile(resolve(root, "ownership.json"), "utf8"),
    );
    if (JSON.stringify(saved) !== JSON.stringify(ownership))
      throw Error(
        "Demo storage belongs to a different checkout. Refusing to reset it.",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const files = await readdir(resolve(root, "database")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    if (files.length)
      throw Error(
        "Existing storage has no Demo Studio ownership marker. It will not be opened or reset.",
      );
    await writeFile(
      resolve(root, "ownership.json"),
      JSON.stringify(ownership),
      { mode: 0o600, flag: "wx" },
    );
  }
  async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
    return new Promise<void>((done, fail) => {
      const child = spawn(command, args, { cwd: app, env, stdio: "inherit" });
      let stopped = false;
      const stop = () => {
        stopped = true;
        child.kill("SIGTERM");
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      child.once("error", fail);
      child.once("exit", (code, signal) => {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
        if (stopped) fail(new DemoStopped());
        else if (code === 0) done();
        else fail(Error(`Demo process stopped (${signal || code}).`));
      });
    });
  }
  try {
    await mkdir(app, { recursive: true });
    for (const name of [
      "src",
      "db",
      "scripts",
      "public",
      "package.json",
      "tsconfig.json",
      "next.config.ts",
      "next-env.d.ts",
      "postcss.config.mjs",
    ])
      try {
        await cp(resolve(repo, name), resolve(app, name), {
          recursive: true,
          force: true,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    try {
      await symlink(
        resolve(repo, "node_modules"),
        resolve(app, "node_modules"),
        "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (reset) {
      const database = resolve(root, "database");
      try {
        if ((await lstat(database)).isSymbolicLink())
          throw Error("Refusing to reset symlinked storage.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const verify = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/demo-verify-storage.ts", root],
        {
          cwd: app,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: "development",
          },
          stdio: "inherit",
        },
      );
      await new Promise<void>((done, fail) => {
        verify.once("error", fail);
        verify.once("exit", (code) =>
          code === 0
            ? done()
            : fail(
                Error(
                  "Demo storage could not be verified. Reset changed nothing.",
                ),
              ),
        );
      });
      await rm(database, { recursive: true, force: true });
      await rm(resolve(root, "keys.json"), { force: true });
    }
    await mkdir(resolve(root, "database"), { recursive: true, mode: 0o700 });
    let keys: Record<string, string>;
    try {
      keys = JSON.parse(await readFile(resolve(root, "keys.json"), "utf8"));
    } catch {
      keys = Object.fromEntries(
        ["SESSION_SECRET", "PASS_ENCRYPTION_KEY", "CRON_SECRET"].map((key) => [
          key,
          randomBytes(32).toString("hex"),
        ]),
      );
      await writeFile(resolve(root, "keys.json"), JSON.stringify(keys), {
        mode: 0o600,
      });
    }
    const env: NodeJS.ProcessEnv = {
      ...Object.fromEntries(
        ["PATH", "HOME", "TMPDIR", "LANG", "SHELL", "SystemRoot"].flatMap(
          (key) => (process.env[key] ? [[key, process.env[key]!]] : []),
        ),
      ),
      ...keys,
      UPTICK_DEMO_MODE: "true",
      UPTICK_DEMO_ROOT: root,
      UPTICK_ENV: "development",
      UPTICK_LOCAL_MODE: "true",
      APP_URL: "http://127.0.0.1:3210",
      LOCAL_DATABASE_PATH: resolve(root, "database"),
      SMS_TRANSPORT: "development",
      PILOT_ENROLLMENT_ENABLED: "false",
      PRODUCTION_DELIVERY_ENABLED: "false",
      MESSAGING_APPROVED: "false",
      LEGAL_APPROVED: "false",
      UPTICK_LOW_DISK: "true",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "development",
    };
    await run(
      process.execPath,
      ["--import", "tsx", "scripts/demo-seed.ts"],
      env,
    );
    if (!reset) {
      console.log(
        "\nDEMO ONLY — open http://127.0.0.1:3210/demo\nPress Control-C here to stop. No hosted data or real SMS.\n",
      );
      await run(
        process.execPath,
        [
          resolve(repo, "node_modules/next/dist/bin/next"),
          "dev",
          "--webpack",
          "--hostname",
          "127.0.0.1",
          "--port",
          "3210",
        ],
        env,
      );
    } else console.log("Demo reset complete. Next: npm run demo");
  } catch (error) {
    if (error instanceof DemoStopped)
      console.log("Demo stopped. Start again with npm run demo.");
    else throw error;
  }
} finally {
  await new Promise<void>((done) => controlLease.close(() => done()));
}
