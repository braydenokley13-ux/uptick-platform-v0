create table if not exists schema_migration_checksums (
 name text primary key references schema_migrations(name), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default now(), basis text not null check(basis in ('applied','reviewed_baseline'))
);
create table commissioning_evidence (
 id text primary key, sequence bigint generated always as identity unique,
 check_key text not null, state text not null check(state in ('verified','failed','pending')),
 release_sha text not null, schema_fingerprint text not null, sender_id text references member_senders(id),
 evidence_encrypted text not null, owner text not null, actor_id text not null,
 verified_at timestamptz not null default now(), review_due_at timestamptz not null check(review_due_at>verified_at)
);
create table member_callback_health (
 kind text primary key check(kind in ('inbound','status')),
 successful_count bigint not null default 0, failed_count bigint not null default 0,
 last_success_at timestamptz, last_failure_at timestamptz, last_failure_code text
);
do $$ declare tab text; begin
 foreach tab in array array['schema_migration_checksums','commissioning_evidence','member_callback_health'] loop
  execute format('alter table %I enable row level security',tab);
 end loop;
 foreach tab in array array['schema_migration_checksums','commissioning_evidence'] loop
  execute format('create trigger immutable_%I before update or delete on %I for each row execute function reject_history_change()',tab,tab);
 end loop;
end $$;
