create table privacy_policy_versions (
 id text primary key, sequence bigint generated always as identity unique,
 scope text not null, retention_days jsonb not null check(jsonb_typeof(retention_days)='object'),
 approval_evidence text not null check(length(trim(approval_evidence))>=20),
 approved_by text not null, approved_at timestamptz not null default now(),
 review_due_at timestamptz not null check(review_due_at>approved_at)
);
create table privacy_requests (
 id text primary key, member_id text not null references uptick_members(id),
 kind text not null check(kind in ('access','correction','deletion','revoke_sessions')),
 state text not null default 'queued' check(state in ('queued','verified','completed','declined')),
 note_encrypted text not null, request_key text not null unique,
 request_fingerprint text not null,
 requested_by text not null, created_at timestamptz not null default now(),
 verified_by text, verified_at timestamptz, verification_encrypted text,
 resolved_by text, resolved_at timestamptz, resolution text not null default '',
 check(state not in ('verified','completed') or (verified_by is not null and verified_at is not null))
);
create table privacy_request_events (
 id text primary key, request_id text not null references privacy_requests(id),
 action text not null, actor_id text not null, detail jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create table member_erasure_records (
 member_id text primary key references uptick_members(id), customer_id text not null unique references customers(id),
 request_id text not null unique references privacy_requests(id), policy_id text not null references privacy_policy_versions(id),
 actor_id text not null, erased_at timestamptz not null default now(),
 retained_categories jsonb not null, review_due_at timestamptz not null
);
-- A keyed fingerprint preserves opt-out without retaining the erased phone number.
create table privacy_phone_suppressions (phone_fingerprint text primary key, suppressed boolean not null, updated_at timestamptz not null default now());
do $$ declare tab text; begin
 foreach tab in array array['privacy_policy_versions','privacy_requests','privacy_request_events','member_erasure_records','privacy_phone_suppressions'] loop
 execute format('alter table %I enable row level security',tab); end loop;
 foreach tab in array array['privacy_policy_versions','privacy_request_events','member_erasure_records'] loop
 execute format('create trigger immutable_%I before update or delete on %I for each row execute function reject_history_change()',tab,tab); end loop;
end $$;

-- Narrow erasure exceptions remove credentials/identifiers only. Promise,
-- attribution, state, dates, financial and redemption evidence remain protected.
create or replace function protect_claim_history() returns trigger language plpgsql as $$ begin
 if exists(select 1 from member_erasure_records where customer_id=old.customer_id)
  and new.token_hash='erased:'||old.id and new.token_encrypted='erased'
  and (to_jsonb(new)-'token_hash'-'token_encrypted')=(to_jsonb(old)-'token_hash'-'token_encrypted') then return new; end if;
 if new.id is distinct from old.id or new.customer_id is distinct from old.customer_id
 or new.organization_id is distinct from old.organization_id or new.offer_id is distinct from old.offer_id
 or new.offer_version is distinct from old.offer_version or new.source_id is distinct from old.source_id
 or new.broadcast_id is distinct from old.broadcast_id or new.token_hash is distinct from old.token_hash
 or new.token_encrypted is distinct from old.token_encrypted or new.snapshot is distinct from old.snapshot
 or new.created_at is distinct from old.created_at then raise exception 'Issued pass history is immutable'; end if;
 if old.state<>'active' and (new.state is distinct from old.state or new.redeemed_at is distinct from old.redeemed_at)
 then raise exception 'A completed pass cannot be reset'; end if;
 if old.opened_at is not null and new.opened_at is distinct from old.opened_at then raise exception 'First pass opening is immutable'; end if;
 return new;
end $$;
create function protect_consent_with_erasure() returns trigger language plpgsql as $$ begin
 if tg_op='UPDATE' and exists(select 1 from member_erasure_records where customer_id=old.customer_id)
  and new.phone='erased' and (to_jsonb(new)-'phone')=(to_jsonb(old)-'phone') then return new; end if;
 raise exception 'Consent evidence is immutable except verified identifier erasure';
end $$;
drop trigger immutable_consent on consent_events;
create trigger immutable_consent before update or delete on consent_events for each row execute function protect_consent_with_erasure();
create or replace function protect_member_support_context() returns trigger language plpgsql as $$ begin
 if exists(select 1 from member_erasure_records where member_id=old.member_id)
  and new.phone_encrypted is null and new.body_encrypted is null and new.resolution_encrypted is null and new.context='{}'::jsonb
  and (to_jsonb(new)-'phone_encrypted'-'body_encrypted'-'resolution_encrypted'-'context')=(to_jsonb(old)-'phone_encrypted'-'body_encrypted'-'resolution_encrypted'-'context') then return new; end if;
 if row(new.member_id,new.provider_sid,new.sender_id,new.origin,new.phone_encrypted,new.body_encrypted,new.context,new.created_at)
  is distinct from row(old.member_id,old.provider_sid,old.sender_id,old.origin,old.phone_encrypted,old.body_encrypted,old.context,old.created_at)
 then raise exception 'Member support request context is immutable'; end if;
 return new;
end $$;
