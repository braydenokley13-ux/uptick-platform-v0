#!/usr/bin/env bash
set -euo pipefail

# This check creates its own local cluster. It never uses DATABASE_URL, PGHOST,
# existing clusters, Supabase, or any external service.
cd "$(dirname "$0")/.."
for executable in initdb pg_ctl node; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'Missing local executable: %s. No database was created.\n' "$executable" >&2
    exit 1
  fi
done
available_kb=$(df -Pk /tmp | awk 'NR==2 { print $4 }')
if [ "$available_kb" -lt 786432 ]; then
  printf 'At least 768 MB free in /tmp is required to keep a safe disk margin. No database was created.\n' >&2
  exit 1
fi

task_dir=$(mktemp -d /tmp/uptick-pg-check.XXXXXX)
cleanup() {
  if pg_ctl -D "$task_dir/data" status >/dev/null 2>&1; then
    if ! pg_ctl -D "$task_dir/data" -m fast -w stop >/dev/null 2>&1; then
      printf 'Could not stop the isolated server. Test files retained at %s\n' "$task_dir" >&2
      return
    fi
  fi
  case "$task_dir" in /tmp/uptick-pg-check.*) rm -rf -- "$task_dir" ;; esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'uptick-isolated-postgres-test-v1\n' > "$task_dir/.uptick-test-cluster"
initdb -D "$task_dir/data" --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C --no-sync > "$task_dir/init.log"
available_kb=$(df -Pk /tmp | awk 'NR==2 { print $4 }')
if [ "$available_kb" -lt 524288 ]; then
  printf 'Less than 512 MB remains after initialization; stopping before tests.\n' >&2
  exit 1
fi
pg_ctl -D "$task_dir/data" -l "$task_dir/server.log" -o "-k $task_dir -p 55439 -c listen_addresses='' -c shared_buffers=16MB -c max_connections=12 -c fsync=off -c synchronous_commit=off -c wal_level=minimal -c max_wal_senders=0 -c min_wal_size=32MB -c max_wal_size=64MB" -w start
node --import tsx scripts/verify-postgres.ts "$task_dir"
