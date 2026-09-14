-- Pilot records are separate from reusable Market Cells. Historical data is not
-- silently certified as real pilot evidence.
alter table market_cells add column data_kind text not null default 'internal' check(data_kind in ('real','internal','demo','synthetic'));
alter table acquisition_partners add column data_kind text not null default 'internal' check(data_kind in ('real','internal','demo','synthetic'));
alter table acquisition_sources add column data_kind text not null default 'internal' check(data_kind in ('real','internal','demo','synthetic'));
alter table demand_events add column data_kind text not null default 'internal' check(data_kind in ('real','internal','demo','synthetic'));

create table pilot_runs (
 id text primary key, market_id text not null references market_cells(id), name text not null,
 starts_on date not null, ends_on date not null,
 state text not null default 'draft' check(state in ('draft','enrolling','live','paused','complete')),
 data_kind text not null default 'internal' check(data_kind in ('real','internal','demo','synthetic')),
 target_members integer not null default 150 check(target_members between 1 and 200),
 hard_cap integer not null default 200 check(hard_cap between 1 and 200 and hard_cap>=target_members),
 paid_load_guidance numeric(4,3) not null default 0.6 check(paid_load_guidance between 0 and 1),
 operator_owner text not null, support_owner text not null, backup_support_owner text not null,
 budget numeric(12,2) not null default 0 check(budget>=0),
 checklist jsonb not null default '{}' check(jsonb_typeof(checklist)='object'),
 success_criteria jsonb not null default '{"firstUse":0.5,"repeatUse":0.3,"weekFourUse":0.25,"weeklyLaborMinutes":180}' check(jsonb_typeof(success_criteria)='object'),
 release_sha text not null default '', config_snapshot jsonb not null default '{}' check(jsonb_typeof(config_snapshot)='object'),
 created_by text not null, created_at timestamptz not null default now(),
 check(extract(isodow from starts_on)=1), check(ends_on=starts_on+28), unique(id,market_id)
);
create unique index pilot_one_active_run on pilot_runs(market_id,data_kind) where state in ('enrolling','live');
alter table weekly_releases add foreign key(run_id,market_id) references pilot_runs(id,market_id);
create table pilot_week_supplies (
 run_id text not null references pilot_runs(id), week_key text not null,
 supply_id text not null unique references network_drop_supplies(id), committed_quantity integer not null check(committed_quantity>0),
 confirmed_by text not null, confirmed_at timestamptz not null default now(),
 primary key(run_id,week_key,supply_id)
);
create table pilot_admissions (
 run_id text not null references pilot_runs(id), member_id text not null references uptick_members(id),
 source_id text references acquisition_sources(id), data_kind text not null check(data_kind in ('real','internal','demo','synthetic')),
 admitted_at timestamptz not null default now(), primary key(run_id,member_id)
);
create table pilot_waitlist (
 run_id text not null references pilot_runs(id), member_id text not null references uptick_members(id),
 reason text not null, requested_at timestamptz not null default now(), primary key(run_id,member_id)
);
create table partner_commitments (
 id text primary key, run_id text not null references pilot_runs(id), partner_id text not null references acquisition_partners(id),
 source_id text not null references acquisition_sources(id),
 channel text not null check(channel in ('resident_email','newsletter','lobby_card','front_desk','move_in','partner_screen')),
 planned_at timestamptz not null, owner text not null, intended_population integer check(intended_population>=0),
 state text not null default 'planned' check(state in ('planned','completed','missed','canceled')),
 completed_at timestamptz, evidence text not null default '', reported_delivered integer check(reported_delivered>=0),
 created_at timestamptz not null default now(), check(state<>'completed' or (completed_at is not null and length(trim(evidence))>0))
);
create table economic_entries (
 id text primary key, market_id text not null references market_cells(id), run_id text references pilot_runs(id),
 program_id text references growth_programs(id),
 category text not null check(category in ('uptick_revenue','uptick_expense','merchant_benefit_exposure','sponsor_benefit_exposure','reserved_recovery_liquidity','retail_value')),
 amount numeric(12,2) not null check(amount<>0), basis text not null check(basis in ('committed','actual')),
 payer text not null, payee text not null, occurred_on date not null,
 evidence text not null check(length(trim(evidence))>0), reversal_of text unique references economic_entries(id),
 dedup_key text not null unique, created_by text not null, created_at timestamptz not null default now()
);
create table labor_entries (
 id text primary key, run_id text not null references pilot_runs(id), worker text not null,
 minutes integer not null check(minutes between 1 and 1440), occurred_on date not null,
 kind text not null check(kind in ('setup','operations','on_call')), note text not null,
 created_by text not null, created_at timestamptz not null default now()
);
create function protect_pilot_run() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if old.state <> 'draft' and (to_jsonb(new)-'state'-'checklist'-'release_sha'-'config_snapshot') is distinct from (to_jsonb(old)-'state'-'checklist'-'release_sha'-'config_snapshot') then
  raise exception 'An enrolled pilot keeps its dates, cohort policy and owners; create a new run';
 end if;
 return new;
end $$;
create trigger pilot_run_commitment before update on pilot_runs for each row execute function protect_pilot_run();
create function protect_pilot_week_supply() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if exists(select 1 from pilot_admissions where run_id=old.run_id) then
  raise exception 'Admitted pilot supply commitments cannot be removed or reduced';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger pilot_week_obligation before update or delete on pilot_week_supplies for each row execute function protect_pilot_week_supply();
create function classify_demand_event() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 new.data_kind := coalesce((select data_kind from uptick_members where id=new.member_id),(select data_kind from acquisition_sources where id=new.source_id),(select data_kind from market_cells where id=new.market_id),'internal');
 return new;
end $$;
create trigger demand_event_classification before insert on demand_events for each row execute function classify_demand_event();
do $$ declare t text; begin
 foreach t in array array['pilot_runs','pilot_week_supplies','pilot_admissions','pilot_waitlist','partner_commitments','economic_entries','labor_entries'] loop
  execute format('alter table %I enable row level security',t);
 end loop;
 foreach t in array array['pilot_admissions','economic_entries','labor_entries'] loop
  execute format('create trigger immutable_%I before update or delete on %I for each row execute function reject_history_change()',t,t);
 end loop;
end $$;
