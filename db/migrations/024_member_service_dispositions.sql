-- Operational participation is separate from immutable cohort membership and SMS consent.
create table member_service_events (
 sequence bigint generated always as identity unique,
 id text primary key, member_id text not null references uptick_members(id),
 kind text not null check(kind in ('withdrawn','suspended','deletion_pending','inaccessible','geography_changed','resumed')),
 reason text not null check(length(trim(reason)) between 10 and 1500),
 actor_id text not null, actor_kind text not null check(actor_kind in ('member','operator')),
 request_key text not null unique, created_at timestamptz not null default now(),
 check(actor_kind='operator' or kind in ('withdrawn','geography_changed')),
 unique(id,member_id)
);
create index member_service_latest on member_service_events(member_id,sequence desc);
alter table member_service_events enable row level security;
create trigger immutable_member_service_events before update or delete on member_service_events
 for each row execute function reject_history_change();
create view member_service_status with (security_invoker=true) as
 select distinct on(member_id) member_id,id event_id,kind,reason,created_at,
 kind in ('withdrawn','suspended','deletion_pending','inaccessible') blocks_future_release,
 kind in ('suspended','deletion_pending') blocks_account_access
 from member_service_events where kind<>'geography_changed'
 order by member_id,sequence desc;

alter table weekly_releases drop constraint weekly_releases_member_count_check;
alter table weekly_releases add constraint weekly_releases_member_count_check check(member_count between 0 and 200);
create table weekly_release_exclusions (
 release_id text not null references weekly_releases(id), member_id text not null references uptick_members(id),
 service_event_id text not null, primary key(release_id,member_id),
 foreign key(service_event_id,member_id) references member_service_events(id,member_id)
);
alter table weekly_release_exclusions enable row level security;
create trigger immutable_weekly_release_exclusions before update or delete on weekly_release_exclusions
 for each row execute function reject_history_change();
