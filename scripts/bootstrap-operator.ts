import postgres from "postgres";
import { z } from "zod";
import { id } from "../src/lib/security";

// This administrator command is never imported by the application. It verifies
// the UUID directly in Supabase Auth; it does not create a login or bypass auth.
try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

async function main() {
  const input = z
    .object({
      DATABASE_URL: z
        .string()
        .url()
        .refine((value) => /^postgres(?:ql)?:/.test(value)),
      OPERATOR_AUTH_USER_ID: z.string().uuid(),
      OPERATOR_ORGANIZATION_NAME: z.string().trim().min(2).max(100),
    })
    .safeParse(process.env);
  if (!input.success)
    throw Error(
      "Set DATABASE_URL, OPERATOR_AUTH_USER_ID (an existing Supabase Auth UUID), and OPERATOR_ORGANIZATION_NAME before running this command.",
    );
  const sql = postgres(input.data.DATABASE_URL, { prepare: false, max: 1 });
  try {
    const result = await sql.begin(async (tx) => {
      // A stable transaction lock makes simultaneous first-operator commands safe.
      await tx`select pg_advisory_xact_lock(1836414059)`;
      const [user] = await tx<
        { id: string }[]
      >`select id from auth.users where id=${input.data.OPERATOR_AUTH_USER_ID}::uuid`;
      if (!user)
        throw Error(
          "That UUID does not exist in this database’s Supabase Auth users. Create the user in the matching Supabase project first.",
        );
      const existing = await tx<
        { user_id: string; organization_id: string }[]
      >`select user_id,organization_id from memberships where role='operator'`;
      if (existing.length) {
        const own = existing.find(
          (member) => member.user_id === input.data.OPERATOR_AUTH_USER_ID,
        );
        if (own) return { organizationId: own.organization_id, created: false };
        throw Error(
          "An operator already exists. Sign in with that account and assign additional existing-user access in the operator workspace.",
        );
      }
      const organizationId = id();
      await tx`insert into organizations(id,name,capabilities) values(${organizationId},${input.data.OPERATOR_ORGANIZATION_NAME},'{}')`;
      await tx`insert into memberships(user_id,organization_id,role,can_export) values(${user.id},${organizationId},'operator',false)`;
      await tx`insert into audit_events(id,organization_id,actor,action,entity_id,detail) values(${id()},${organizationId},${user.id},'operator.bootstrapped',${user.id},'{}')`;
      return { organizationId, created: true };
    });
    console.log(
      result.created
        ? "First operator membership created."
        : "This user already has operator access; no changes were made.",
    );
    console.log(`Operating organization: ${result.organizationId}`);
    console.log(
      "Sign in through /login using this Supabase user’s normal credentials.",
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const safe = [
    "Set DATABASE_URL,",
    "That UUID does not exist",
    "An operator already exists.",
  ].some((prefix) => message.startsWith(prefix));
  console.error(
    safe
      ? message
      : "Operator setup failed. Check the matching Supabase database, administrator connection, and applied migrations. No database credentials are shown.",
  );
  process.exitCode = 1;
}
