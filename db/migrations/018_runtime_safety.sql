create table scheduled_job_leases (
 job_key text primary key, owner_token text not null, expires_at timestamptz not null
);
create table scheduled_job_runs (
 id text primary key, job_key text not null, state text not null check(state in ('running','succeeded','failed','interrupted')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 processed integer not null default 0 check(processed>=0), error_code text
);
create index scheduled_job_health on scheduled_job_runs(job_key,started_at desc);
alter table scheduled_job_leases enable row level security;
alter table scheduled_job_runs enable row level security;
-- Trusted server-mediated triggers use a reproducible search path. No browser
-- privileges or permissive RLS policies are added.
alter function reject_history_change() set search_path=public,pg_temp;
alter function protect_claim_history() set search_path=public,pg_temp;
alter function protect_source_history() set search_path=public,pg_temp;
alter function validate_creative_context() set search_path=public,pg_temp;
alter function protect_internal_test_context() set search_path=public,pg_temp;
alter function protect_network_supply() set search_path=public,pg_temp;
alter function protect_redemption_point() set search_path=public,pg_temp;
alter function protect_redemption_credential() set search_path=public,pg_temp;
alter function protect_member_message_context() set search_path=public,pg_temp;
alter function protect_distinct_sender_programs() set search_path=public,pg_temp;
