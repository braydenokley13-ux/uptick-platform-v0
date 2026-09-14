#!/usr/bin/env bash
set -euo pipefail

# This wrapper creates a fresh PostgreSQL 16 cluster in /tmp and connects only
# through that cluster's Unix socket. It never reads an application database URL.
cd "$(dirname "$0")/.."

snapshot_path="${1:-.data/commissioning/public-before-014.json}"
for executable in initdb postgres pg_ctl node; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    printf 'Missing local executable: %s. No database was created.\n' "$executable" >&2
    exit 1
  fi
done

if [ ! -f "$snapshot_path" ]; then
  printf 'Missing hosted public snapshot: %s\n' "$snapshot_path" >&2
  exit 1
fi
if [ "$(stat -f '%Lp' "$snapshot_path")" != "600" ]; then
  printf 'Snapshot permissions must be 600 before rehearsal.\n' >&2
  exit 1
fi
case "$(postgres --version)" in
  "postgres (PostgreSQL) 16."*) ;;
  *)
    printf 'PostgreSQL 16 is required for this restore rehearsal.\n' >&2
    exit 1
    ;;
esac

available_kb=$(df -Pk /tmp | awk 'NR==2 { print $4 }')
if [ "$available_kb" -lt 786432 ]; then
  printf 'At least 768 MB free in /tmp is required. No database was created.\n' >&2
  exit 1
fi

task_backup_dir=$(mktemp -d /tmp/uptick-hosted-backup-check.XXXXXX)
cleanup() {
  if pg_ctl -D "$task_backup_dir/data" status >/dev/null 2>&1; then
    if ! pg_ctl -D "$task_backup_dir/data" -m fast -w stop >/dev/null 2>&1; then
      printf 'Could not stop the isolated server. Files retained at %s\n' "$task_backup_dir" >&2
      return
    fi
  fi
  case "$task_backup_dir" in
    /tmp/uptick-hosted-backup-check.*) rm -rf -- "$task_backup_dir" ;;
  esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

chmod 700 "$task_backup_dir"
printf 'uptick-hosted-public-backup-check-v1\n' > "$task_backup_dir/.uptick-test-cluster"
chmod 600 "$task_backup_dir/.uptick-test-cluster"
initdb -D "$task_backup_dir/data" --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C > "$task_backup_dir/init.log"

available_kb=$(df -Pk /tmp | awk 'NR==2 { print $4 }')
if [ "$available_kb" -lt 524288 ]; then
  printf 'Less than 512 MB remains after initialization; stopping before restore.\n' >&2
  exit 1
fi

pg_ctl -D "$task_backup_dir/data" -l "$task_backup_dir/server.log" -o "-k $task_backup_dir -p 55442 -c listen_addresses='' -c shared_buffers=16MB -c max_connections=8 -c fsync=on -c synchronous_commit=on -c min_wal_size=32MB -c max_wal_size=64MB" -w start
node --import tsx scripts/verify-hosted-public-backup.ts "$task_backup_dir" "$snapshot_path"
