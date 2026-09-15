import postgres from "postgres";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type DB, pgAdapter } from "./db";
import { assertCloudDemoEnvironment } from "./cloud-demo-guard";
import { RequestError } from "./http";

export const CLOUD_DEMO_COOKIE = "__Host-uptick-demo";
export const CLOUD_DEMO_LOCK = 723914208;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const globals = globalThis as unknown as {
  cloudDemoPool?: { scope: string; db: DB };
};
export const CLOUD_DEMO_SCHEMA = "uptick_cloud_demo";

export function cloudSchemaDb(base: DB): DB {
  const run = <T>(fn: (tx: DB) => Promise<T>) =>
    base.transaction(async (tx) => {
      await tx.query("set local search_path=uptick_cloud_demo,pg_temp");
      return fn(tx);
    });
  return {
    query: (sql, params) => run((tx) => tx.query(sql, params)),
    transaction: run,
  };
}

export function cloudDemoConnection() {
  const config = assertCloudDemoEnvironment();
  const scope = digest(config.databaseUrl + config.instanceId);
  if (globals.cloudDemoPool && globals.cloudDemoPool.scope !== scope)
    throw Error(
      "Cloud demo connection configuration changed; restart the deployment.",
    );
  if (!globals.cloudDemoPool)
    globals.cloudDemoPool = {
      scope,
      db: cloudSchemaDb(
        pgAdapter(
          postgres(config.databaseUrl, {
            prepare: false,
            max: 3,
            ssl: "require",
            idle_timeout: 20,
            connect_timeout: 10,
          }),
        ),
      ),
    };
  return globals.cloudDemoPool.db;
}

export async function verifyCloudDemoOwnership(db: DB) {
  const config = assertCloudDemoEnvironment();
  const [marker] = await db.query<{
    kind: string;
    project_ref: string;
    instance_id: string;
    origin: string;
  }>(
    "select kind,project_ref,instance_id,origin from uptick_demo.ownership where singleton=true",
  );
  if (
    !marker ||
    marker.kind !== "uptick-cloud-demo-v1" ||
    marker.project_ref !== config.ref ||
    marker.instance_id !== config.instanceId ||
    marker.origin !== config.origin
  )
    throw new RequestError(
      "Cloud demo storage ownership could not be verified.",
      503,
    );
}

export function validCloudDemoCookie(value?: string): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export async function requireCloudDemoLease(db: DB, credential: string) {
  if (!validCloudDemoCookie(credential))
    throw new RequestError("Open Demo Studio and unlock your rehearsal.", 401);
  const [lease] = await db.query<{ generation: number }>(
    "select generation from uptick_demo.lease where singleton=true and token_hash=$1 and expires_at>now()",
    [digest(credential)],
  );
  if (!lease)
    throw new RequestError(
      "This rehearsal ended or was reset. Open Demo Studio again.",
      401,
    );
  return lease;
}

// Every application read and write takes the shared lock and rechecks the lease.
// Reset holds its exclusive counterpart through truncation, seeding and rotation.
export function leasedCloudDemoDb(base: DB, credential: string): DB {
  const run = <T>(fn: (tx: DB) => Promise<T>) =>
    base.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock_shared($1)", [
        CLOUD_DEMO_LOCK,
      ]);
      await verifyCloudDemoOwnership(tx);
      await requireCloudDemoLease(tx, credential);
      return fn(tx);
    });
  return {
    query: (sql, params) => run((tx) => tx.query(sql, params)),
    transaction: run,
  };
}

export async function requestCloudDemoDb() {
  const { cookies } = await import("next/headers");
  const credential = (await cookies()).get(CLOUD_DEMO_COOKIE)?.value;
  if (!validCloudDemoCookie(credential))
    throw new RequestError("Open Demo Studio and unlock your rehearsal.", 401);
  const db = leasedCloudDemoDb(cloudDemoConnection(), credential);
  await db.query("select 1");
  return db;
}

export async function acquireCloudDemoLease(
  db: DB,
  accessKey: string,
  existing?: string,
) {
  assertCloudDemoEnvironment();
  const expected = Buffer.from(digest(process.env.CLOUD_DEMO_ACCESS_KEY!));
  if (!timingSafeEqual(expected, Buffer.from(digest(accessKey))))
    throw new RequestError("The demo access key was not accepted.", 401);
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [CLOUD_DEMO_LOCK]);
    await verifyCloudDemoOwnership(tx);
    const [active] = await tx.query<{ token_hash: string }>(
      "select token_hash from uptick_demo.lease where singleton=true and expires_at>now() for update",
    );
    if (active && (!existing || active.token_hash !== digest(existing)))
      throw new RequestError(
        "A rehearsal is already open in another browser. End it there first, or wait for its eight-hour session to expire.",
        409,
      );
    const credential = randomBytes(32).toString("base64url");
    await tx.query(
      "update uptick_demo.lease set token_hash=$1,expires_at=now()+interval '8 hours' where singleton=true",
      [digest(credential)],
    );
    return credential;
  });
}

export async function rotateCloudDemoLease(tx: DB) {
  const credential = randomBytes(32).toString("base64url");
  await tx.query(
    "update uptick_demo.lease set generation=generation+1,token_hash=$1,expires_at=now()+interval '8 hours' where singleton=true",
    [digest(credential)],
  );
  return credential;
}
