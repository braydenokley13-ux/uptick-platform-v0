import Link from "next/link";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { localMode } from "@/lib/config";
import { Shell } from "@/components/shell";
import { PageHeading } from "@/components/ui";
import { PilotForm } from "@/components/pilot-form";
import "@/components/network-operations.css";
export const dynamic = "force-dynamic";
export default async function AccountAccessPage() {
  const actor = await requireActor(true),
    db = await getDb();
  const local = localMode();
  const businesses = await db.query<{ id: string; name: string }>(
    "select id,name from organizations order by name",
  );
  const users = local
    ? []
    : await db.query<{
        user_id: string;
        email: string;
        role: string;
        businesses: string;
        factors: number;
      }>(
        `select m.user_id,u.email,max(m.role) role,string_agg(o.name,', ' order by o.name) businesses,
     (select count(*)::int from auth.mfa_factors f where f.user_id=u.id and f.status='verified' and f.factor_type='totp') factors
     from memberships m join auth.users u on u.id::text=m.user_id join organizations o on o.id=m.organization_id
     group by m.user_id,u.id,u.email order by u.email`,
      );
  return (
    <Shell actor={actor} active="pilot/settings" name="Account access">
      <div className="network-operations">
        <PageHeading
          eyebrow="OPERATOR & MERCHANT ACCESS"
          title="Keep access deliberate."
          description="Assign verified accounts, check backup authenticators, and remove access when someone leaves."
        />
        <p>
          <Link href="/account/security">Your account security</Link> ·{" "}
          <Link href="/operator/pilot/settings">
            Release and commissioning settings
          </Link>
        </p>
        {local ? (
          <section className="panel network-panel">
            <h2>Local sample identities</h2>
            <p>
              The isolated demo uses its own sample operator and merchant.
              Hosted account assignment is available only in the connected
              hosted application.
            </p>
          </section>
        ) : (
          <>
            <section className="panel network-panel">
              <h2>Assign an existing verified account</h2>
              <p>
                First create the account and verify its email in the connected
                Supabase Auth dashboard. Then enter the same email here. Have
                the account owner sign in and save primary and backup
                authenticators before enabling MFA enforcement.
              </p>
              <PilotForm
                endpoint="/api/account"
                action="assign_access"
                button="Save verified account access"
              >
                <label>
                  Verified account email
                  <input
                    required
                    type="email"
                    name="email"
                    autoComplete="off"
                  />
                </label>
                <label>
                  Business
                  <select required name="organizationId" defaultValue="">
                    <option value="" disabled>
                      Choose a business
                    </option>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Access role
                  <select required name="role" defaultValue="">
                    <option value="" disabled>
                      Choose the required access
                    </option>
                    <option value="merchant">
                      Merchant — selected business
                    </option>
                    <option value="operator">Operator — all businesses</option>
                  </select>
                </label>
                <label>
                  <input type="checkbox" name="canExport" />
                  Allow approved exports
                </label>
              </PilotForm>
            </section>
            <section className="panel network-panel">
              <h2>Current account access</h2>
              {users.map((user) => (
                <article key={user.user_id} className="panel network-panel">
                  <h3>{user.email}</h3>
                  <p>
                    {user.role} · {user.businesses} · {user.factors} verified
                    authenticators
                  </p>
                  {user.role === "operator" && user.factors < 2 && (
                    <p>
                      Primary and separately held backup authenticators still
                      need commissioning.
                    </p>
                  )}
                  {user.user_id !== actor.id && (
                    <details>
                      <summary>Remove this account’s access</summary>
                      <p>
                        This removes every Uptick business assignment for this
                        account and revokes its existing Uptick sessions.
                      </p>
                      <PilotForm
                        endpoint="/api/account"
                        action="remove_access"
                        extra={{ userId: user.user_id }}
                        button="Remove access and revoke sessions"
                      >
                        <label>
                          Reason for removing access
                          <textarea
                            name="reason"
                            required
                            minLength={10}
                            maxLength={1000}
                          />
                        </label>
                      </PilotForm>
                    </details>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
