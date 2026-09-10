# Real PostgreSQL concurrency checks

The ordinary `npm test` suite uses PGlite. Use the separate command below to verify the production database adapter and transactions across independent PostgreSQL sessions.

1. Make locally installed PostgreSQL server binaries (`initdb` and `pg_ctl`) available on your `PATH`. The harness does not install them.
2. Keep at least 256 MB free in `/tmp`. The script also checks that more than 100 MB remains after initialization.
3. From the repository directory, run:

   ```sh
   bash scripts/verify-postgres.sh
   ```

4. Read the `PASS` lines. A failing assertion exits unsuccessfully. The final success line means every listed check passed.

The wrapper creates a fresh private directory under `/tmp`, initializes its own PostgreSQL cluster, disables TCP listening, and uses only that directory's Unix socket. It ignores application `DATABASE_URL` and never connects to an existing database. Before creating its test database, the TypeScript harness verifies the directory marker, actual server data directory, and disabled TCP listener. It uses the same `pgAdapter` as the application. On exit, the wrapper stops its server and removes only its own temporary directory; if shutdown fails, it retains the files and reports their location.

The checks cover:

- Four simultaneously active database sessions.
- Concurrent duplicate claims producing one private pass, one message, and one saved consent-choice record.
- Concurrent redemption of the same pass producing one redemption.
- Competing claims for the final reserved pass, including transaction rollback.
- Competing passes for the final allowed redemption.
- Concurrent approvals for one merchant and week producing one broadcast and approved-version record.
- Same-phone claims at separate merchants, plus domain and database rejection of cross-merchant writes.
- JSON snapshots and audit details remaining objects, with their policy fields intact.

On September 10, 2026, these checks passed against PostgreSQL 16 with migrations 001–008. They exposed and helped fix a difference between PGlite and postgres.js: pre-stringified JSON parameters became JSON strings in production. Native object parameters and migration 008 now preserve and enforce the required object shape.

This verifies database transaction behavior, not Supabase JWT/RLS integration, carrier delivery, or crash recovery. The disposable server disables synchronous disk flushing for speed; it is never a production database.
