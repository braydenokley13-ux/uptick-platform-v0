-- Membership is durable identity. Promotional SMS permission is a separate,
-- append-only choice, and private access links exchange once into revocable sessions.
alter table uptick_members add column data_kind text not null default 'internal'
 check(data_kind in ('real','internal','demo','synthetic'));
alter table uptick_members add column age_confirmed_at timestamptz;

-- Earlier "paused" rows were created by SMS opt-out. Preserve the membership
-- and its issued obligations while the append-only consent history keeps the opt-out.
update uptick_members set state='active',updated_at=now()
 where state='paused' and verified_at is not null;

alter table member_access add column age_attested boolean not null default false;
alter table member_access add column consumed_at timestamptz;
alter table member_messages add column rendered_body_encrypted text;

alter table member_consents add column consent_purpose text not null
 default 'promotional_membership_sms';
alter table member_consents add column consent_action text;
update member_consents set consent_action=case when accepted then 'opt_in' else 'opt_out' end
 where consent_action is null;
alter table member_consents alter column consent_action set not null;
alter table member_consents add constraint member_consent_purpose
 check(consent_purpose='promotional_membership_sms');
alter table member_consents add constraint member_consent_action
 check(consent_action in ('opt_in','declined','opt_out','stop'));
alter table member_consents add constraint member_consent_action_matches_acceptance
 check((accepted and consent_action='opt_in') or (not accepted and consent_action<>'opt_in'));
create function default_member_consent_action() returns trigger language plpgsql as $$ begin
 if new.consent_action is null then
  new.consent_action := case when new.accepted then 'opt_in' else 'opt_out' end;
 end if;
 return new;
end $$;
create trigger member_consent_action_default before insert on member_consents
 for each row execute function default_member_consent_action();

create table member_sessions (
 id text primary key,
 member_id text not null references uptick_members(id),
 source_access_id text references member_access(id),
 token_hash text not null unique,
 expires_at timestamptz not null,
 last_seen_at timestamptz not null default now(),
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 unique(id,member_id),
 check(expires_at>created_at)
);
alter table member_access add column exchanged_session_id text unique references member_sessions(id);

create table member_recovery_codes (
 id text primary key,
 member_id text not null references uptick_members(id),
 code_hash text not null unique,
 expires_at timestamptz not null,
 used_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 check(expires_at>created_at)
);

-- This suppression follows the Uptick membership program rather than one sender.
-- A sender replacement therefore cannot evade a member's STOP instruction.
create table member_global_suppressions (
 phone text primary key check(phone ~ '^\+1[0-9]{10}$'),
 suppressed boolean not null,
 source_sender_id text references member_senders(id),
 updated_at timestamptz not null default now()
);

create table member_support_requests (
 id text primary key,
 member_id text references uptick_members(id),
 provider_sid text unique,
 sender_id text references member_senders(id),
 origin text not null check(origin in ('sms_help','sms_other','member_web')),
 phone_encrypted text,
 body_encrypted text,
 context jsonb not null default '{}'::jsonb,
 state text not null default 'queued' check(state in ('queued','working','resolved','closed')),
 created_at timestamptz not null default now(),
 resolved_at timestamptz, resolved_by text, resolution_encrypted text
);

create index member_session_lookup on member_sessions(member_id,expires_at)
 where revoked_at is null;
create index member_recovery_lookup on member_recovery_codes(member_id,expires_at)
 where used_at is null and revoked_at is null;
create index member_support_queue on member_support_requests(state,created_at);

do $$ declare t text; begin
 foreach t in array array['member_sessions','member_recovery_codes','member_global_suppressions','member_support_requests'] loop
  execute format('alter table %I enable row level security',t);
 end loop;
end $$;

create or replace function protect_member_support_context() returns trigger language plpgsql as $$ begin
 if row(new.member_id,new.provider_sid,new.sender_id,new.origin,new.phone_encrypted,new.body_encrypted,new.context,new.created_at)
  is distinct from row(old.member_id,old.provider_sid,old.sender_id,old.origin,old.phone_encrypted,old.body_encrypted,old.context,old.created_at)
 then raise exception 'Member support request context is immutable'; end if;
 return new;
end $$;
create trigger immutable_member_support_context before update on member_support_requests
 for each row execute function protect_member_support_context();
