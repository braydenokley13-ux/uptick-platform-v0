import type { DB } from "./db";
import type { Actor } from "./domain";
import { uptickEnvironment } from "./environment";

export async function pilotPrincipal(
  db: DB,
  authenticatedUserId: string,
): Promise<Actor | null> {
  if (uptickEnvironment() !== "staging") return null;
  const allowed = (process.env.STAGING_TEST_USER_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.includes(authenticatedUserId)) return null;
  const [membership] = await db.query<{
    organization_id: string;
    can_export: boolean;
  }>(
    "select organization_id,can_export from memberships where user_id=$1 and role='operator' order by organization_id limit 1",
    [authenticatedUserId],
  );
  return membership
    ? {
        id: authenticatedUserId,
        role: "operator",
        organizationId: membership.organization_id,
        canExport: membership.can_export,
      }
    : null;
}
export async function pilotPersona(
  db: DB,
  authenticatedUserId: string,
  organizationId: string,
): Promise<Actor | null> {
  if (!(await pilotPrincipal(db, authenticatedUserId))) return null;
  const [business] = await db.query<{ id: string }>(
    "select id from organizations where id=$1 and is_demo and 'merchant'=any(capabilities)",
    [organizationId],
  );
  return business
    ? {
        id: authenticatedUserId,
        role: "merchant",
        organizationId: business.id,
        canExport: false,
      }
    : null;
}
