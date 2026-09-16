# Hosted migration record — 2026-09-16

Target project ref: dmirmwzubafuzoxcporr (uptick-staging)
Server: PostgreSQL 17.6, reached through aws-0-us-east-1.pooler.supabase.com:5432 (session mode)
Connected as: postgres / database postgres / transaction_read_only = off
Tooling: pg_dump + psql 17.11 (Homebrew); migration applied by the repository's own `npm run db:migrate`

## Before

public.schema_migrations 21 rows, latest 021_membership_function_search_paths.sql (applied 2026-09-14 03:38:34+00)
public base tables 97
uptick_cloud_demo ledger 34 rows, latest 034_callback_commissioning_scope.sql

Row counts, public schema (every non-empty table):
organizations=2 memberships=1 locations=1 offers=1 offer_versions=1
senders=1 audit_events=3 rate_limits=9 growth_program_coordination=1
Everything else was empty: 0 market_cells, 0 pilot_runs, 0 uptick_members,
0 pilot_admissions, 0 member_access, 0 customers, 0 claims, 0 fulfillment_grants,
0 member_consents, 0 member_messages. auth.users held 1 account.

## Backup

uptick-full-20260916-pre-migration.dump custom format, all 11 schemas
uptick-full-20260916-pre-migration.toc.txt 2325 TOC entries, 97 public tables, 255 TABLE DATA entries
uptick-public-20260916-pre-migration.sql public schema, plain SQL
uptick-auth-20260916-pre-migration.sql auth schema
uptick-clouddemo-20260916-pre-migration.sql demo schema
uptick-public-20260916-post-migration.sql public schema after the migration

SHA-256 for each is in CHECKSUMS.sha256. Provenance in BACKUP_PROVENANCE.txt.

## Restore proof

The public dump was restored into a disposable local PostgreSQL 17.11 cluster
(127.0.0.1:55432, loopback only, data directory outside the repository). The
restore produced 97 base tables, 26 functions and a 21-row ledger, with row
counts identical to the hosted database. The only error raised was the benign
`schema "public" already exists`. A successful pg_dump is not by itself a
backup; this is the step that shows the file can be turned back into the
database.

## Migration rehearsal

Rehearsal ran twice against a fresh restore of that backup, using the same
`npm run db:migrate` that was later pointed at the hosted database.

022..034 21 -> 34 migrations, 97 -> 117 tables, all row counts preserved.
117 matches the uptick_cloud_demo schema exactly, which has carried
the full range since it was installed — independent corroboration.
022..035 21 -> 35 migrations, 97 -> 117 tables, all row counts preserved,
and the three hardening properties restored to 0/0/0.

The full test suite (317 tests) passed against the candidate before the hosted
migration was applied.

## Review of 022..035

No migration in the range drops a table or a column, and none rewrites data with
an UPDATE. 022 is the only data-writing migration: it copies pre-014 per-sender
STOP history into member_global_suppressions with `on conflict do update`, which
is idempotent and is exercised by tests/pilot-release-integrity.test.ts against
the real .sql file. The statements that scan as destructive are all
`alter table ... drop constraint` followed by a widened re-add (024 widens a
member-count check from 1..200 to 0..200; 026 trades two unique constraints for
a supersession-aware partial unique index; 031 and 033 reshape CHECK constraints
on member_messages).

No migration in the range creates an extension, a role, or an object in a
hardcoded schema, so the range is structurally incapable of reaching the
uptick_cloud_demo schema that shares this database.

035 is this campaign's own addition. It repairs two regressions introduced
inside the range — 028 reset the pinned search_path on two trigger functions by
using CREATE OR REPLACE without a SET clause, and 030 created
privacy_retention_queue without security_invoker — and restores the index 026
dropped from recovery_grants.incident_id. Without it, applying 022..034 would
have ended with 2 unpinned functions and 1 definer view on a database whose
commissioning record certifies zero of each.

## After

public.schema_migrations 35 rows, latest 035_restore_public_schema_hardening.sql
public.schema_migration_checksums 14 rows, basis 'applied', 022 through 035
public base tables 117
uptick_cloud_demo ledger 34 rows, unchanged; demo data unchanged
(2 memberships, 1 grant, 1 market cell, 1 redemption)

Row counts, public schema — identical to before:
organizations=2 memberships=1 locations=1 offers=1 offer_versions=1
senders=1 audit_events=3 rate_limits=9 growth_program_coordination=1

Catalog properties: 0 functions without a pinned search_path, 0 views without
security_invoker, 0 tables without row level security.

## Effect on the live application

Before the migration, https://uptick-platform-v0.vercel.app/ redirected to
/join and /join returned HTTP 500. The cause was `supplySelect` in
src/lib/network.ts referencing `location_outages`, a table added by migration
027 that the database did not have. Every page built on that query failed the
same way, and the error reached the browser as an anonymous Next.js error
digest rather than anything an operator could act on.

After the migration, /join returns HTTP 200.

## Not done

Migrations 001..021 were applied before schema_migration_checksums existed, so
they carry no checksum row and the mismatch guard in src/lib/db.ts can never
fire for them. The only backfill available is an operator review that hashes
the repository's own files and records basis='reviewed_baseline' — a statement
that the repo matches itself, not that the hosted database matches the repo.
That distinction should stay visible wherever migration integrity is reported.
