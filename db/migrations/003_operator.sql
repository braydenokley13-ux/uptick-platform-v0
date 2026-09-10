-- Small operating objects around the immutable acquisition and return loop.
create table if not exists business_profiles (
 organization_id text primary key references organizations(id), category text not null default '', growth_goal text not null default '', updated_at timestamptz not null default now()
);
create table if not exists placement_context (
 placement_id text primary key references placements(id), placement_type text not null default 'wall TV', environment text not null default '', dwell_context text not null default ''
);
create table if not exists placement_events (
 id text primary key, placement_id text not null references placements(id), status text not null check(status in ('intended','confirmed','paused')), note text not null default '', external_reference text, actor text not null, created_at timestamptz not null default now()
);
create table if not exists source_creatives (
 id text primary key, source_id text not null unique references sources(id), parent_source_id text references sources(id), version integer not null check(version > 0), offer_version integer not null, headline text not null, cta text not null, format text not null check(format in ('landscape','countertop')), notes text not null default '', created_by text not null, created_at timestamptz not null default now()
);
create table if not exists offer_reviews (
 id text primary key, offer_id text not null references offers(id), offer_version integer not null, decision text not null check(decision in ('returned','rejected','approved')), note text not null default '', actor text not null, created_at timestamptz not null default now()
);
create table if not exists launch_checks (
 organization_id text not null references organizations(id), check_key text not null check(check_key in ('claim-tested','pass-tested','staff-briefed')), note text not null, actor text not null, checked_at timestamptz not null default now(), primary key(organization_id,check_key)
);
create index if not exists placement_event_history on placement_events(placement_id,created_at);
create index if not exists offer_review_history on offer_reviews(offer_id,created_at);
alter table business_profiles enable row level security;
alter table placement_context enable row level security;
alter table placement_events enable row level security;
alter table source_creatives enable row level security;
alter table offer_reviews enable row level security;
alter table launch_checks enable row level security;
create trigger immutable_placement_events before update or delete on placement_events for each row execute function reject_history_change();
create trigger immutable_source_creatives before update or delete on source_creatives for each row execute function reject_history_change();
create trigger immutable_offer_reviews before update or delete on offer_reviews for each row execute function reject_history_change();
