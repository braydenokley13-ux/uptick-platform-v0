#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for executable in initdb pg_ctl pg_dump pg_restore node; do
  command -v "$executable" >/dev/null || { printf 'Missing isolated-rehearsal executable: %s\n' "$executable" >&2; exit 1; }
done
available_kb=$(df -Pk /tmp | awk 'NR==2 { print $4 }')
if [ "$available_kb" -lt 786432 ]; then
  printf 'At least 768 MB free space is required. No database was created.\n' >&2
  exit 1
fi
task_restore_dir=$(mktemp -d /tmp/uptick-restore-check.XXXXXX)
cleanup() {
  if pg_ctl -D "$task_restore_dir/data" status >/dev/null 2>&1; then
    if ! pg_ctl -D "$task_restore_dir/data" -m fast -w stop >/dev/null 2>&1; then
      printf 'Isolated server could not stop. Files retained: %s\n' "$task_restore_dir" >&2
      return
    fi
  fi
  case "$task_restore_dir" in /tmp/uptick-restore-check.*) rm -rf -- "$task_restore_dir" ;; esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'uptick-durable-restore-test-v1\n' > "$task_restore_dir/.uptick-test-cluster"
initdb -D "$task_restore_dir/data" --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C > "$task_restore_dir/init.log"
pg_ctl -D "$task_restore_dir/data" -l "$task_restore_dir/server.log" -o "-k $task_restore_dir -p 55440 -c listen_addresses='' -c shared_buffers=16MB -c max_connections=12 -c fsync=on -c synchronous_commit=on -c min_wal_size=32MB -c max_wal_size=64MB" -w start
node --import tsx scripts/rehearse-restore.ts "$task_restore_dir"
