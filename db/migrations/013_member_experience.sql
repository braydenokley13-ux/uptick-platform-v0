-- Fair weekly preparation and exact first-verification referral attribution.
create table member_week_preparations (
 member_id text not null references uptick_members(id), week_key text not null,
 state text not null check(state in ('waiting_supply','queued','blocked')),
 attempted_at timestamptz not null default now(), next_attempt_at timestamptz not null,
 message_id text unique references member_messages(id), reason text,
 primary key(member_id,week_key)
);
create table member_first_verifications (
 member_id text primary key references uptick_members(id), access_id text not null unique,
 verified_at timestamptz not null default now(),
 foreign key(access_id,member_id) references member_access(id,member_id)
);
create table access_referral_intents (
 access_id text primary key, member_id text not null, referral_id text not null references member_referrals(id),
 created_at timestamptz not null default now(),
 foreign key(access_id,member_id) references member_access(id,member_id)
);
alter table member_referrals add column market_id text references market_cells(id);
update member_referrals r set market_id=m.market_id from uptick_members m where m.id=r.member_id;
alter table member_referrals add constraint referral_supply_market foreign key(supply_id,market_id) references network_drop_supplies(id,market_id);
create trigger immutable_referral_context before update or delete on member_referrals for each row execute function reject_history_change();
create trigger immutable_first_verification before update or delete on member_first_verifications for each row execute function reject_history_change();
create trigger immutable_access_referral_intent before update or delete on access_referral_intents for each row execute function reject_history_change();
alter table member_week_preparations enable row level security;
alter table member_first_verifications enable row level security;
alter table access_referral_intents enable row level security;
-- Both sender configuration paths take this same lock before their other locks.
-- The trigger also protects direct privileged writes and opposite-order configuration.
create or replace function protect_distinct_sender_programs() returns trigger language plpgsql as $$ begin
 perform pg_advisory_xact_lock(73418,1);
 if TG_TABLE_NAME='senders' then
  if exists(select 1 from member_senders where service_sid=new.service_sid or phone=new.phone) then raise exception 'Uptick membership sender cannot be shared with a merchant program'; end if;
 else
  if exists(select 1 from senders where service_sid=new.service_sid or phone=new.phone) then raise exception 'Merchant sender cannot be shared with Uptick membership'; end if;
 end if;
 return new;
end $$;
create trigger distinct_merchant_sender before insert or update on senders for each row execute function protect_distinct_sender_programs();
create trigger distinct_member_sender before insert or update on member_senders for each row execute function protect_distinct_sender_programs();
