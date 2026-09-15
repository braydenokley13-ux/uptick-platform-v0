create table member_phone_changes (
 id text primary key, request_id text not null unique references privacy_requests(id),
 member_id text not null references uptick_members(id),
 new_phone_encrypted text not null, token_hash text not null unique,
 token_encrypted text not null, expires_at timestamptz not null,
 created_by text not null, created_at timestamptz not null default now(),
 confirmed_at timestamptz, applied_at timestamptz,
 check(expires_at>created_at), check(applied_at is null or confirmed_at is not null)
);
alter table member_phone_changes enable row level security;
create function protect_member_phone_change() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if tg_op='DELETE' then raise exception 'Phone correction history cannot be deleted'; end if;
 if exists(select 1 from member_erasure_records where member_id=old.member_id)
  and new.new_phone_encrypted='erased' and new.token_hash='erased:'||old.id and new.token_encrypted='erased'
  and (to_jsonb(new)-'new_phone_encrypted'-'token_hash'-'token_encrypted')=(to_jsonb(old)-'new_phone_encrypted'-'token_hash'-'token_encrypted') then return new; end if;
 if (to_jsonb(new)-'confirmed_at'-'applied_at') is distinct from (to_jsonb(old)-'confirmed_at'-'applied_at') then raise exception 'Phone correction context is immutable'; end if;
 if (old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at) or (old.applied_at is not null and new.applied_at is distinct from old.applied_at) then raise exception 'Phone verification and application are one-way'; end if;
 return new;
end $$;
create trigger immutable_member_phone_change before update or delete on member_phone_changes for each row execute function protect_member_phone_change();

alter table member_messages add column phone_change_id text unique references member_phone_changes(id);
alter table member_messages add column recipient_encrypted text;
alter table member_messages add column recipient_hint text;
alter table member_messages drop constraint member_messages_purpose_check;
alter table member_messages add constraint member_messages_purpose_check check(purpose in ('access','drop','opt_in_confirmation','phone_change'));
alter table member_messages drop constraint member_message_purpose_context;
alter table member_messages add constraint member_message_purpose_context check(
 (purpose='access' and access_id is not null and consent_id is null and phone_change_id is null and allocation_id is null and week_key is null)
 or (purpose='drop' and access_id is not null and consent_id is null and phone_change_id is null and allocation_id is not null and week_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
 or (purpose='opt_in_confirmation' and access_id is null and consent_id is not null and phone_change_id is null and allocation_id is null and week_key is null)
 or (purpose='phone_change' and access_id is null and consent_id is null and phone_change_id is not null and allocation_id is null and week_key is null)
);
create function protect_member_message_recipient() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if tg_op='UPDATE' and new.phone_change_id is distinct from old.phone_change_id then raise exception 'Message phone correction context is immutable'; end if;
 if tg_op='UPDATE' and old.recipient_encrypted is not null and row(new.recipient_encrypted,new.recipient_hint) is distinct from row(old.recipient_encrypted,old.recipient_hint)
  and not(new.recipient_encrypted is null and new.recipient_hint is null and exists(select 1 from member_erasure_records where member_id=old.member_id))
 then raise exception 'A prepared recipient cannot change'; end if;
 if new.purpose='phone_change' and not exists(select 1 from member_phone_changes p where p.id=new.phone_change_id and p.member_id=new.member_id) then raise exception 'Message phone correction belongs to another member'; end if;
 return new;
end $$;
create trigger member_message_recipient before insert or update on member_messages for each row execute function protect_member_message_recipient();

-- A verified correction rotates private pass credentials without changing the
-- issued benefit, redeemed state, dates, attribution or original evidence.
create or replace function protect_claim_history() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if (to_jsonb(new)-'token_hash'-'token_encrypted')=(to_jsonb(old)-'token_hash'-'token_encrypted') and (
   (exists(select 1 from member_erasure_records where customer_id=old.customer_id) and new.token_hash='erased:'||old.id and new.token_encrypted='erased')
   or (new.token_hash ~ '^[a-f0-9]{64}$' and exists(select 1 from member_phone_changes p join uptick_members m on m.id=p.member_id where p.id=current_setting('uptick.phone_correction_id',true) and m.customer_id=old.customer_id and p.applied_at is not null))
 ) then return new; end if;
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
