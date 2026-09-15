-- Keep every original commitment and every replacement. Only the current
-- unreleased leaf of each chain participates in prospective capacity.
create table pilot_supply_amendments (
 id text primary key,
 run_id text not null references pilot_runs(id), week_key text not null,
 previous_supply_id text not null unique references network_drop_supplies(id),
 replacement_supply_id text not null unique references network_drop_supplies(id),
 committed_quantity integer not null check(committed_quantity between 1 and 200),
 reason text not null check(length(trim(reason)) between 10 and 1500),
 payer_organization_id text not null references organizations(id),
 financial_evidence text not null check(length(trim(financial_evidence)) between 10 and 1500),
 program_implications text not null check(length(trim(program_implications)) between 10 and 1500),
 protection_review text not null check(length(trim(protection_review)) between 10 and 1500),
 created_by text not null, created_at timestamptz not null default now(),
 request_key text not null unique, check(previous_supply_id<>replacement_supply_id)
);
alter table pilot_supply_amendments enable row level security;
create trigger immutable_pilot_supply_amendments before update or delete on pilot_supply_amendments
 for each row execute function reject_history_change();

create view effective_pilot_week_supplies with (security_invoker=true) as
 select p.run_id,p.week_key,p.supply_id,p.committed_quantity,p.confirmed_by,p.confirmed_at,
  null::text amendment_id
 from pilot_week_supplies p
 where not exists(select 1 from pilot_supply_amendments a where a.previous_supply_id=p.supply_id)
 union all
 select a.run_id,a.week_key,a.replacement_supply_id,a.committed_quantity,a.created_by,a.created_at,a.id
 from pilot_supply_amendments a
 where not exists(select 1 from pilot_supply_amendments newer where newer.previous_supply_id=a.replacement_supply_id);

create function validate_pilot_supply_amendment() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare run pilot_runs;
begin
 perform 1 from growth_program_coordination where singleton=true for update;
 select * into run from pilot_runs where id=new.run_id for update;
 if run.state='complete' or not exists(select 1 from effective_pilot_week_supplies p
   where p.run_id=new.run_id and p.week_key=new.week_key and p.supply_id=new.previous_supply_id) then
  raise exception 'Amend only a current commitment of an unfinished pilot';
 end if;
 if exists(select 1 from weekly_releases where run_id=new.run_id and week_key=new.week_key)
   or exists(select 1 from fulfillment_grants where supply_id=new.previous_supply_id) then
  raise exception 'Issued supply history cannot be amended; use recovery';
 end if;
 if exists(select 1 from pilot_week_supplies where supply_id=new.replacement_supply_id)
   or exists(select 1 from pilot_supply_amendments where previous_supply_id=new.replacement_supply_id) then
  raise exception 'Replacement supply already belongs to commitment history';
 end if;
 return new;
end $$;
create trigger valid_pilot_supply_amendment before insert on pilot_supply_amendments
 for each row execute function validate_pilot_supply_amendment();

create function prevent_recommitting_amended_supply() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if exists(select 1 from pilot_supply_amendments where replacement_supply_id=new.supply_id) then
  raise exception 'Amended supply is already committed';
 end if;
 return new;
end $$;
create trigger no_duplicate_amended_supply before insert on pilot_week_supplies
 for each row execute function prevent_recommitting_amended_supply();
