create table pilot_assignment_policies (
 sequence bigint generated always as identity unique, id text primary key,
 run_id text not null references pilot_runs(id), all_destinations_fit boolean not null,
 max_drive_minutes integer not null check(max_drive_minutes between 1 and 60),
 evidence text not null check(length(trim(evidence)) between 10 and 1500),
 actor_id text not null, created_at timestamptz not null default now()
);
create table member_destination_reviews (
 sequence bigint generated always as identity unique, id text primary key,
 member_id text not null references uptick_members(id), location_id text not null references locations(id),
 suitable boolean not null, drive_minutes integer check(drive_minutes between 0 and 180),
 evidence text not null check(length(trim(evidence)) between 10 and 1500),
 actor_id text not null, created_at timestamptz not null default now()
);
alter table pilot_assignment_policies enable row level security;
alter table member_destination_reviews enable row level security;
create trigger immutable_pilot_assignment_policies before update or delete on pilot_assignment_policies
 for each row execute function reject_history_change();
create trigger immutable_member_destination_reviews before update or delete on member_destination_reviews
 for each row execute function reject_history_change();
