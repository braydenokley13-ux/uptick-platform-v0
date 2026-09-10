-- Internal rehearsals never create production customers, claims, consent or broadcasts.
create table internal_test_runs (
 id text primary key,
 organization_id text not null references organizations(id),
 offer_id text not null,
 offer_version integer not null,
 actor_id text not null,
 request_key text not null,
 test_kind text not null check(test_kind in ('anchor','drop')),
 sender_id text,
 service_sid text,
 phone_encrypted text not null,
 phone_hash text not null,
 phone_suffix text not null,
 token_hash text not null unique,
 token_encrypted text not null,
 snapshot jsonb not null,
 transport text not null check(transport in ('development','twilio')),
 send_state text not null check(send_state in ('submitting','provider_accepted','sent','delivered','failed','undelivered','unknown','development','suppressed')),
 provider_sid text unique,
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 opened_at timestamptz,
 redeemed_at timestamptz,
 unique(actor_id,request_key),
 foreign key(offer_id,organization_id) references offers(id,organization_id),
 foreign key(offer_id,offer_version) references offer_versions(offer_id,version),
 foreign key(sender_id,organization_id) references senders(id,organization_id)
);
create table internal_test_events (
 id text primary key,
 test_id text not null references internal_test_runs(id),
 kind text not null check(kind in ('created','opened','redeemed','callback')),
 provider_sid text,
 state text,
 error_code text,
 created_at timestamptz not null default now(),
 unique(provider_sid,state)
);
create unique index one_internal_test_action on internal_test_events(test_id,kind) where kind <> 'callback';
create index internal_test_recent on internal_test_runs(created_at desc);
alter table internal_test_runs enable row level security;
alter table internal_test_events enable row level security;
create trigger immutable_internal_test_events before update or delete on internal_test_events for each row execute function reject_history_change();
create function protect_internal_test_context() returns trigger language plpgsql as $$ begin
 if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
 or new.offer_id is distinct from old.offer_id or new.offer_version is distinct from old.offer_version
 or new.actor_id is distinct from old.actor_id or new.request_key is distinct from old.request_key
 or new.test_kind is distinct from old.test_kind or new.sender_id is distinct from old.sender_id
 or new.service_sid is distinct from old.service_sid or new.phone_encrypted is distinct from old.phone_encrypted
 or new.phone_hash is distinct from old.phone_hash or new.phone_suffix is distinct from old.phone_suffix
 or new.token_hash is distinct from old.token_hash or new.token_encrypted is distinct from old.token_encrypted
 or new.snapshot is distinct from old.snapshot or new.transport is distinct from old.transport
 or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at
 then raise exception 'Internal test context is immutable'; end if;
 if old.provider_sid is not null and new.provider_sid is distinct from old.provider_sid then raise exception 'Provider identity is immutable'; end if;
 if old.opened_at is not null and new.opened_at is distinct from old.opened_at then raise exception 'Test opening is immutable'; end if;
 if old.redeemed_at is not null and new.redeemed_at is distinct from old.redeemed_at then raise exception 'Test redemption is immutable'; end if;
 return new;
end $$;
create trigger immutable_internal_test_context before update on internal_test_runs for each row execute function protect_internal_test_context();
