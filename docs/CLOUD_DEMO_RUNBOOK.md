# Founder cloud demo

## Address and purpose

The requested address is **https://pilot.upticklocal.com/demo**. See the cloud deployment evidence for whether the domain switch and browser verification have finished.

This is the same Uptick application and GitHub branch as the laptop demo. Cloud mode uses a private schema in the existing `uptick-staging` Supabase project, as explicitly authorized by the founder. The laptop demo remains fully local.

The demo creates sample records only. It sends no SMS and does not create real members, inventory commitments, or commercial obligations. Digital redemption records a software event; it does not prove a purchase or physical handoff.

## Run it in a browser

1. Open the pilot demo address.
2. Open the private founder-access file delivered on this laptop. Copy its demo access key into **Founder demo access key**.
3. Click **Open my rehearsal**. Use one browser for the rehearsal.
4. Follow the numbered Demo Studio sections. Start with member entry and use the displayed fictional phone number and ZIP.
5. Open the simulated private access link. Claim the backed weekly benefit.
6. Return to Demo Studio. Open the staff QR destination and record the sample redemption.
7. Open the merchant and operator results to see the recorded event.
8. Report the sample stockout. Issue the sample recovery, then complete its redemption.
9. Use **Reset my rehearsal** to return to the starting fixture. Reset clears sample activity, rotates the browser rehearsal credential, and clears member/operator sign-ins.
10. Use **End rehearsal & lock** when done. The browser lease also expires after eight hours.

If another browser has an active rehearsal, end it there before opening a new one. Do not enter actual customer information. The normal hosted login, account-management endpoints, Twilio callbacks, and scheduled jobs are unavailable in this deployment.

## Laptop and offline fallback

The existing `DEMO_RUNBOOK.md` covers the local launcher and reset. `output/pdf/uptick-founder-demo.pdf` is the offline fallback; `docs/demo/screenshots/final/` contains the captured journey. Neither requires the hosted demo to be available.

## Isolation and deployment controls

- Separate Vercel project: `uptick-cloud-demo`. It deploys the `codex/real-enrollment-ready` branch of the existing platform repository.
- Existing Supabase project: `dmirmwzubafuzoxcporr`.
- Private application schema: `uptick_cloud_demo`; control schema: `uptick_demo`.
- Runtime login: `uptick_cloud_demo_runtime`, with no superuser, database-creation, role-creation, replication, or RLS-bypass powers. It owns no tables or sequences.
- Normal application/auth tables have no grants to that login. Every private table has RLS enabled.
- Every application transaction selects only the private schema, verifies its ownership marker, and checks the current browser lease. Reset holds an exclusive demo-only lock; ordinary operations use its shared counterpart.
- Reset truncates only the reviewed list of 115 private application tables, without CASCADE or sequence ownership. Schema changes outside the inventory cause reset to refuse. Failed seeding rolls back the old data and lease.
- Ordinary application migrations remain intact. The private installation records both original and rendered migration hashes; normal hosted application migration state is not advanced by demo setup.
- Vercel receives only independent demo secrets and the restricted runtime URL. It receives no normal DATABASE_URL, Supabase service-role key, or Twilio credentials.
- The canonical origin and dedicated Vercel project identity must match exactly. Normal application hosting cannot accidentally become a demo by setting one flag.

## Verification and release

`node --import tsx scripts/verify-cloud-demo.ts` is an engineering-only verifier. It creates and removes its own disposable PostgreSQL cluster using generated test-only configuration. The explicit `--prepare-cloud` option loads the private deployment configuration and exports the reviewed provisioning artifact into ignored `private/cloud-demo/`. It never connects to the hosted URL in that configuration. Founder operation requires no terminal or SQL.

Before updating the cloud demo: run unit tests, typecheck, lint, and the isolation verifier; push the exact commit; deploy it to the demo project; verify the browser journey and reset. Do not rerun initial provisioning against an existing schema. Future schema changes require a reviewed, scoped migration and the demo-exclusive lock.

The previous normal Vercel project and deployment are retained for rollback. Returning the pilot address to real operation requires a deliberate domain reassignment plus the normal release/commissioning gates. A working demo does not mean real enrollment is open.
