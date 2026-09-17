-- Restore the hardening that 028 and 030 dropped on their way past.
--
-- Migration 028 re-created protect_consent_with_erasure and
-- protect_member_support_context with CREATE OR REPLACE and no SET clause.
-- Postgres assigns every function property from that command, so a replace
-- without a SET clause resets proconfig to NULL — silently undoing the pinned
-- search_path that migrations 018 and 021 exist to establish. Migration 030
-- then created privacy_retention_queue without security_invoker, so the view
-- reads its RLS-enabled base tables with its owner's rights rather than the
-- caller's.
--
-- Neither function is SECURITY DEFINER, so this is a defence-in-depth
-- regression rather than an open door: an unpinned trigger function resolves
-- unqualified names through the caller's search_path, which only matters if a
-- role that can set search_path and create shadowing objects reaches these
-- tables. That is exactly the margin the hosted commissioning record certifies
-- as "function_search_path_warnings: 0", and it should not quietly become 2.
--
-- The cloud demo installer has applied these same three repairs to its own
-- schema since it was written (src/lib/cloud-demo-schema.ts, immediately after
-- it renders the migration files). The public schema never received them. This
-- migration closes that gap so both schemas carry the same guarantees.
--
-- 028 and 030 are already applied elsewhere and are never rewritten; the
-- checksum ledger forbids it. The repair goes forward, as a new migration.
alter function protect_consent_with_erasure() set search_path=public,pg_temp;
alter function protect_member_support_context() set search_path=public,pg_temp;
alter view privacy_retention_queue set (security_invoker=true);

-- 026 dropped recovery_grants_incident_id_key so a failed make-good could be
-- superseded by a successor. "At most one live make-good per incident" is still
-- enforced, but only transitively: every recovery for an incident takes its
-- original_grant_id from that incident's grant, and one_current_recovery_per_original
-- already allows a single non-superseded row per grant. What the drop did lose
-- is the index itself, leaving the incident lookups in merchant-overview and
-- pilot-promise to sequentially scan recovery_grants.
create index recovery_grants_incident on recovery_grants(incident_id);
