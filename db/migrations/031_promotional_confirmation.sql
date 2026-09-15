alter table member_messages add column consent_id text unique references member_consents(id);
alter table member_messages alter column access_id drop not null;
alter table member_messages drop constraint member_messages_purpose_check;
alter table member_messages add constraint member_messages_purpose_check check(purpose in ('access','drop','opt_in_confirmation'));
-- Replace only the original purpose/context check; preserve all FK/expiry checks.
do $$ declare item record; begin
 for item in select conname from pg_constraint where conrelid='member_messages'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%allocation_id IS NULL%' loop
  execute format('alter table member_messages drop constraint %I',item.conname);
 end loop;
end $$;
alter table member_messages add constraint member_message_purpose_context check(
 (purpose='access' and access_id is not null and consent_id is null and allocation_id is null and week_key is null)
 or (purpose='drop' and access_id is not null and consent_id is null and allocation_id is not null and week_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
 or (purpose='opt_in_confirmation' and access_id is null and consent_id is not null and allocation_id is null and week_key is null)
);
create function protect_member_message_consent() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if tg_op='UPDATE' and new.consent_id is distinct from old.consent_id then raise exception 'Message consent evidence is immutable'; end if;
 if new.purpose='opt_in_confirmation' and not exists(select 1 from member_consents c where c.id=new.consent_id and c.member_id=new.member_id and c.accepted and c.consent_action='opt_in' and c.consent_purpose='promotional_membership_sms')
 then raise exception 'Subscription confirmation needs this member''s affirmative consent'; end if;
 return new;
end $$;
create trigger member_message_consent before insert or update on member_messages for each row execute function protect_member_message_consent();
