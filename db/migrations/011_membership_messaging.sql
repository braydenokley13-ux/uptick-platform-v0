-- Uptick membership sender and delivery ledger are independent of merchant subscriptions.
create table member_senders (
 id text primary key, service_sid text not null unique check(service_sid ~ '^MG[0-9a-fA-F]{32}$'),
 phone text not null unique check(phone ~ '^\+1[0-9]{10}$'),
 approved boolean not null default false, active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index one_active_member_sender on member_senders(active) where active;
create table member_suppressions (
 phone text not null, sender_id text not null references member_senders(id),
 suppressed boolean not null, updated_at timestamptz not null default now(), primary key(phone,sender_id)
);
create table member_messages (
 id text primary key, member_id text not null references uptick_members(id),
 access_id text not null references member_access(id), sender_id text references member_senders(id),
 purpose text not null check(purpose in ('access','drop')), allocation_id text,
 week_key text, timezone text not null default 'America/New_York',
 scheduled_at timestamptz not null default now(), expires_at timestamptz not null,
 environment text not null check(environment in ('development','staging','production')),
 state text not null default 'queued' check(state in ('queued','submitting','provider_accepted','sent','delivered','failed','undelivered','unknown','development','suppressed')),
 provider_sid text unique, error_code text, suppression_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(access_id,purpose), check(expires_at>scheduled_at),
 foreign key(access_id,member_id) references member_access(id,member_id),
 foreign key(allocation_id,member_id) references member_allocations(id,member_id),
 check((purpose='access' and allocation_id is null and week_key is null) or (purpose='drop' and allocation_id is not null and week_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
);
create unique index one_uptick_drop_message_per_week on member_messages(member_id,week_key) where purpose='drop';
create index member_message_queue on member_messages(state,scheduled_at);
create table member_message_events (
 id text primary key, message_id text not null references member_messages(id), provider_sid text not null,
 state text not null, error_code text, created_at timestamptz not null default now(), unique(provider_sid,state)
);
create table member_inbound_events (
 provider_sid text primary key, sender_id text not null references member_senders(id),
 action text not null check(action in ('STOP','START','HELP','OTHER')), created_at timestamptz not null default now()
);
create trigger immutable_member_message_events before update or delete on member_message_events for each row execute function reject_history_change();
create trigger immutable_member_inbound_events before update or delete on member_inbound_events for each row execute function reject_history_change();
create or replace function protect_member_message_context() returns trigger language plpgsql as $$ begin
 if row(new.member_id,new.access_id,new.sender_id,new.purpose,new.allocation_id,new.week_key,new.timezone,new.scheduled_at,new.expires_at,new.environment,new.created_at) is distinct from row(old.member_id,old.access_id,old.sender_id,old.purpose,old.allocation_id,old.week_key,old.timezone,old.scheduled_at,old.expires_at,old.environment,old.created_at) then raise exception 'Member message context is immutable'; end if;
 if old.provider_sid is not null and old.provider_sid is distinct from new.provider_sid then raise exception 'Provider identity is immutable'; end if;
 return new;
end $$;
create trigger immutable_member_message_context before update on member_messages for each row execute function protect_member_message_context();
do $$ declare t text; begin
 foreach t in array array['member_senders','member_suppressions','member_messages','member_message_events','member_inbound_events'] loop
 execute format('alter table %I enable row level security',t);
 end loop;
end $$;
