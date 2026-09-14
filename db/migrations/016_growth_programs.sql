-- Growth is a versioned commercial agreement. Benefit supply can be proposed
-- independently and does not become approved capacity until an operator links
-- a reviewed supply record to an approved program version.
create table growth_programs (
 id text primary key,
 buyer_organization_id text not null references organizations(id),
 market_id text not null references market_cells(id),
 status text not null default 'review' check(status in ('review','approved','active','completed','terminated')),
 current_version integer not null default 1 check(current_version>0),
 pending_version integer check(pending_version>0),
 approved_version integer check(approved_version>0),
 created_by text not null, created_at timestamptz not null default now(),
 unique(id,buyer_organization_id), unique(id,market_id),
 check(pending_version is null or pending_version<=current_version),
 check(approved_version is null or approved_version<=current_version)
);

create table growth_program_versions (
 program_id text not null references growth_programs(id), version integer not null check(version>0),
 name text not null check(length(trim(name)) between 3 and 120),
 objective text not null check(objective in ('introduce_store','introduce_breakfast','introduce_product','morning_discovery','quieter_period')),
 objective_note text not null default '' check(length(objective_note)<=1000),
 starts_on date not null, ends_on date not null,
 buyer_organization_id text not null references organizations(id),
 funder_organization_id text not null references organizations(id),
 fulfiller_organization_id text not null references organizations(id),
 negotiated_fee_cents integer check(negotiated_fee_cents>=0),
 commercial_status text not null check(commercial_status in ('negotiating','agreed','invoiced','paid','credited','waived')),
 benefit_ceiling integer not null check(benefit_ceiling between 1 and 1000000),
 operating_constraints text not null check(length(trim(operating_constraints)) between 10 and 2000),
 evaluation_plan text not null check(length(trim(evaluation_plan)) between 10 and 2000),
 proposed_by text not null, created_at timestamptz not null default now(),
 primary key(program_id,version),
 foreign key(program_id,buyer_organization_id) references growth_programs(id,buyer_organization_id),
 check(ends_on>=starts_on),
 check(commercial_status='negotiating' or negotiated_fee_cents is not null)
);

alter table growth_programs add constraint growth_program_current_version
 foreign key(id,current_version) references growth_program_versions(program_id,version)
 deferrable initially deferred;
alter table growth_programs add constraint growth_program_pending_version
 foreign key(id,pending_version) references growth_program_versions(program_id,version)
 deferrable initially deferred;
alter table growth_programs add constraint growth_program_approved_version
 foreign key(id,approved_version) references growth_program_versions(program_id,version)
 deferrable initially deferred;

create table growth_program_locations (
 program_id text not null, program_version integer not null,
 location_id text not null, fulfiller_organization_id text not null,
 primary key(program_id,program_version,location_id),
 foreign key(program_id,program_version) references growth_program_versions(program_id,version),
 foreign key(location_id,fulfiller_organization_id) references locations(id,organization_id)
);

create table growth_program_week_plans (
 program_id text not null, program_version integer not null,
 week_key text not null check(week_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 planned_placements integer not null check(planned_placements between 1 and 200),
 primary key(program_id,program_version,week_key),
 foreign key(program_id,program_version) references growth_program_versions(program_id,version)
);

create table growth_program_protections (
 program_id text not null, program_version integer not null,
 protected_location_id text not null references locations(id),
 competing_category text not null check(length(trim(competing_category)) between 2 and 80),
 radius_miles numeric(4,2) not null check(radius_miles>0 and radius_miles<=1.5),
 starts_on date not null, ends_on date not null,
 placement_scope text not null check(placement_scope in ('paid_featured')),
 exceptions jsonb not null default '[]' check(jsonb_typeof(exceptions)='array'),
 terms_status text not null default 'proposed' check(terms_status in ('proposed')),
 termination_conditions text not null check(length(trim(termination_conditions)) between 10 and 1500),
 primary key(program_id,program_version),
 foreign key(program_id,program_version) references growth_program_versions(program_id,version),
 check(ends_on>=starts_on)
);

create table growth_program_approvals (
 id text primary key, program_id text not null, program_version integer not null,
 run_id text not null, decision text not null check(decision in ('approved','rejected')),
 capacity_snapshot jsonb not null check(jsonb_typeof(capacity_snapshot)='object'),
 note text not null, decided_by text not null, decided_at timestamptz not null default now(),
 unique(program_id,program_version,decision),
 foreign key(program_id,program_version) references growth_program_versions(program_id,version)
);

create table program_supply_links (
 program_id text not null, program_version integer not null,
 supply_id text not null unique references network_drop_supplies(id),
 week_key text not null check(week_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 linked_by text not null, created_at timestamptz not null default now(),
 primary key(program_id,program_version,supply_id),
 foreign key(program_id,program_version) references growth_program_versions(program_id,version)
);

alter table fulfillment_grants add constraint fulfillment_grant_program_pair
 check((source_program_id is null)=(source_program_version is null));
alter table fulfillment_grants add constraint fulfillment_grant_program_version
 foreign key(source_program_id,source_program_version) references growth_program_versions(program_id,version);
create function validate_fulfillment_grant_program() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if new.source_program_id is not null and not exists(
  select 1 from growth_programs p
  join program_supply_links l on l.program_id=p.id and l.program_version=p.approved_version
  where p.id=new.source_program_id and p.approved_version=new.source_program_version
   and p.status in ('approved','active') and l.supply_id=new.supply_id and l.week_key=new.week_key
 ) then raise exception 'Paid grant source must be an approved Program supply link for this week'; end if;
 return new;
end $$;
create trigger valid_fulfillment_grant_program before insert on fulfillment_grants
 for each row execute function validate_fulfillment_grant_program();

create table merchant_supply_proposals (
 id text primary key, program_id text, program_version integer,
 supplier_organization_id text not null references organizations(id),
 funder_organization_id text not null references organizations(id),
 fulfiller_organization_id text not null references organizations(id),
 market_id text not null references market_cells(id),
 location_id text not null, exact_item text not null check(length(trim(exact_item)) between 3 and 200),
 item_identifier text not null default '' check(length(item_identifier)<=100),
 usable_hours text not null check(length(trim(usable_hours)) between 3 and 500),
 starts_on date not null, ends_on date not null,
 quantity integer not null check(quantity between 1 and 1000000),
 required_spend_cents integer not null default 0 check(required_spend_cents=0),
 member_fee_cents integer not null default 0 check(member_fee_cents=0),
 fallback_substitute text not null check(length(trim(fallback_substitute)) between 3 and 200),
 fallback_instructions text not null check(length(trim(fallback_instructions)) between 10 and 1500),
 fallback_payer_organization_id text not null references organizations(id),
 state text not null default 'review' check(state in ('review')),
 proposed_by text not null, created_at timestamptz not null default now(),
 foreign key(program_id,program_version) references growth_program_versions(program_id,version),
 foreign key(location_id,fulfiller_organization_id) references locations(id,organization_id),
 check((program_id is null)=(program_version is null)), check(ends_on>=starts_on)
);

create table growth_program_credits (
 id text primary key, program_id text not null references growth_programs(id),
 amount_cents integer not null check(amount_cents>0), reason text not null check(length(trim(reason)) between 10 and 1000),
 reference text not null default '', approved_by text not null, created_at timestamptz not null default now()
);

create table growth_program_terminations (
 id text primary key, program_id text not null unique references growth_programs(id),
 reason text not null check(length(trim(reason)) between 10 and 1000),
 terminated_by text not null, created_at timestamptz not null default now()
);

-- Locking this one row serializes approval checks, including protection and
-- member-attention conflicts, so two operators cannot approve incompatible work.
create table growth_program_coordination (
 singleton boolean primary key default true check(singleton), touched_at timestamptz not null default now()
);
insert into growth_program_coordination(singleton) values(true);

create function protect_growth_program() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if (to_jsonb(new)-'status'-'current_version'-'pending_version'-'approved_version') is distinct from (to_jsonb(old)-'status'-'current_version'-'pending_version'-'approved_version') then
  raise exception 'Growth Program identity is immutable; create a prospective version';
 end if;
 if old.status='terminated' and new is distinct from old then
  raise exception 'A terminated Growth Program cannot be reopened';
 end if;
 return new;
end $$;
create trigger growth_program_identity before update on growth_programs for each row execute function protect_growth_program();

do $$ declare t text; begin
 foreach t in array array['growth_programs','growth_program_versions','growth_program_locations','growth_program_week_plans','growth_program_protections','growth_program_approvals','program_supply_links','merchant_supply_proposals','growth_program_credits','growth_program_terminations','growth_program_coordination'] loop
  execute format('alter table %I enable row level security',t);
 end loop;
 foreach t in array array['growth_program_versions','growth_program_locations','growth_program_week_plans','growth_program_protections','growth_program_approvals','program_supply_links','merchant_supply_proposals','growth_program_credits','growth_program_terminations'] loop
  execute format('create trigger immutable_%I before update or delete on %I for each row execute function reject_history_change()',t,t);
 end loop;
end $$;
