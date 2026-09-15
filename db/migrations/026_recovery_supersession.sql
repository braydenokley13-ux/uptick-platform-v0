-- Digital redemption evidence stays immutable even when physical fulfillment fails.
alter table recovery_grants drop constraint recovery_grants_incident_id_key;
alter table recovery_grants drop constraint recovery_grants_original_claim_id_key;
drop index one_recovery_per_original_grant;
alter table recovery_grants add column supersedes_recovery_id text unique references recovery_grants(id);
alter table recovery_grants add column superseded_at timestamptz;
create unique index one_current_recovery_per_original on recovery_grants(original_grant_id) where superseded_at is null;
create table recovery_failures (
 recovery_id text primary key references recovery_grants(id), successor_id text not null unique references recovery_grants(id),
 physical_handoff text not null check(physical_handoff in ('not_received','unknown')),
 reason text not null check(length(trim(reason)) between 10 and 1500),
 actor_id text not null, created_at timestamptz not null default now()
);
alter table recovery_failures enable row level security;
create trigger immutable_recovery_failures before update or delete on recovery_failures for each row execute function reject_history_change();
create trigger no_recovery_history_deletion before delete on recovery_grants for each row execute function reject_history_change();

create or replace function protect_recovery_grant() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if new.original_claim_id is distinct from old.original_claim_id and (
  old.original_claim_id is not null or new.original_claim_id is null or not exists(
   select 1 from member_claims mc where mc.claim_id=new.original_claim_id and mc.grant_id=new.original_grant_id and mc.member_id=new.member_id)
 ) then raise exception 'Recovery can bind only to its original grant claim'; end if;
 if (to_jsonb(new)-'state'-'redeemed_at'-'original_claim_id'-'superseded_at') is distinct from
    (to_jsonb(old)-'state'-'redeemed_at'-'original_claim_id'-'superseded_at')
 then raise exception 'Issued recovery context is immutable'; end if;
 if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at
 then raise exception 'Recovery supersession is permanent'; end if;
 if old.superseded_at is not null and (new.state is distinct from old.state or new.redeemed_at is distinct from old.redeemed_at)
 then raise exception 'A superseded recovery cannot be redeemed'; end if;
 if old.state='redeemed' and (new.state<>'redeemed' or new.redeemed_at is distinct from old.redeemed_at)
 then raise exception 'Recorded recovery redemption evidence cannot be reset'; end if;
 return new;
end $$;
create function validate_recovery_successor() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if new.supersedes_recovery_id is not null and not exists(select 1 from recovery_grants prior
  where prior.id=new.supersedes_recovery_id and prior.original_grant_id=new.original_grant_id
   and prior.member_id=new.member_id and prior.superseded_at is not null)
 then raise exception 'A successor must preserve the original member obligation'; end if;
 return new;
end $$;
create trigger valid_recovery_successor before insert on recovery_grants for each row execute function validate_recovery_successor();
