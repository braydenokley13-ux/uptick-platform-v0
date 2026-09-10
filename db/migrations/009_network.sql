-- New member relationships require explicit consent; legacy subscribers are not enrolled.
create table market_cells (
 id text primary key, name text not null, slug text not null unique,
 timezone text not null default 'America/New_York',
 state text not null default 'draft' check(state in ('draft','building','pilot','live','paused')),
 boundary_note text not null default '', center_latitude numeric(9,6), center_longitude numeric(9,6),
 created_at timestamptz not null default now(),
 check(center_latitude between -90 and 90), check(center_longitude between -180 and 180)
);
create table market_zips (market_id text not null references market_cells(id), zip text not null check(zip ~ '^[0-9]{5}$'), primary key(market_id,zip));
alter table locations add column latitude numeric(9,6) check(latitude between -90 and 90);
alter table locations add column longitude numeric(9,6) check(longitude between -180 and 180);
alter table locations add column postal_code text check(postal_code ~ '^[0-9]{5}$');
create table market_locations (
 market_id text not null references market_cells(id), location_id text not null,
 organization_id text not null, drive_minutes integer check(drive_minutes between 1 and 180),
 active boolean not null default true, primary key(market_id,location_id),
 foreign key(location_id,organization_id) references locations(id,organization_id)
);
create table acquisition_partners (
 id text primary key, name text not null, kind text not null,
 state text not null default 'active' check(state in ('active','paused')),
 agreement_note text not null default '', address text not null default '',
 latitude numeric(9,6) check(latitude between -90 and 90), longitude numeric(9,6) check(longitude between -180 and 180),
 created_at timestamptz not null default now()
);
create table partner_markets (partner_id text not null references acquisition_partners(id), market_id text not null references market_cells(id), primary key(partner_id,market_id));
create table acquisition_sources (
 id text primary key, partner_id text references acquisition_partners(id), market_id text not null references market_cells(id),
 token text not null unique, name text not null, channel text not null, campaign text not null,
 cost numeric(12,2) check(cost >= 0), state text not null default 'active' check(state in ('active','paused')),
 created_at timestamptz not null default now(), foreign key(partner_id,market_id) references partner_markets(partner_id,market_id)
);
create table uptick_members (
 id text primary key, customer_id text not null unique references customers(id),
 home_zip text not null check(home_zip ~ '^[0-9]{5}$'), work_zip text check(work_zip ~ '^[0-9]{5}$'),
 market_id text references market_cells(id), source_id text references acquisition_sources(id),
 state text not null default 'pending' check(state in ('pending','active','paused')),
 verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,customer_id)
);
create table member_access (
 id text primary key, member_id text not null references uptick_members(id),
 token_hash text not null unique, token_encrypted text not null,
 purpose text not null default 'access' check(purpose in ('access','drop')),
 expires_at timestamptz not null, confirmed_at timestamptz,
 consent_requested boolean not null default false, disclosure text not null,
 home_zip text not null check(home_zip ~ '^[0-9]{5}$'), work_zip text check(work_zip ~ '^[0-9]{5}$'),
 source_id text references acquisition_sources(id), created_at timestamptz not null default now(),
 unique(id,member_id), check(expires_at > created_at)
);
create table member_consents (
 sequence bigint generated always as identity unique,
 id text primary key, member_id text not null references uptick_members(id), accepted boolean not null,
 disclosure_version text not null, disclosure text not null, source_ui text not null,
 created_at timestamptz not null default now()
);
create index member_consent_latest on member_consents(member_id,created_at desc);
create table network_drop_supplies (
 id text primary key, market_id text not null references market_cells(id), organization_id text not null,
 location_id text not null, offer_id text not null unique, offer_version integer not null,
 state text not null default 'draft' check(state in ('draft','review','approved','paused','ended')),
 starts_at timestamptz not null, expires_at timestamptz not null,
 inventory_policy text not null default 'redemption' check(inventory_policy in ('unlimited','redemption','claim','timed')),
 quantity integer check(quantity > 0), reservation_minutes integer check(reservation_minutes between 5 and 10080),
 verification_mode text not null default 'staff_tap' check(verification_mode in ('staff_tap','public_tap','self_confirm')),
 self_confirm_approved boolean not null default false,
 staff_instructions text not null default '', fallback_plan text not null default '',
 funding_source text not null default 'merchant' check(funding_source in ('merchant','uptick','partner','brand')),
 shareable boolean not null default false, referral_cap integer not null default 5 check(referral_cap between 0 and 100),
 growth_fee numeric(12,2) check(growth_fee >= 0), spend_cap numeric(12,2) check(spend_cap >= 0),
 approved_by text, created_at timestamptz not null default now(),
 unique(id,organization_id), unique(id,market_id), unique(id,offer_id,organization_id),
 foreign key(offer_id,organization_id) references offers(id,organization_id),
 foreign key(offer_id,offer_version) references offer_versions(offer_id,version),
 foreign key(location_id,organization_id) references locations(id,organization_id),
 foreign key(market_id,location_id) references market_locations(market_id,location_id),
 check(expires_at > starts_at), check(inventory_policy='unlimited' or quantity is not null),
 check(inventory_policy<>'timed' or reservation_minutes is not null),
 check(state<>'approved' or (approved_by is not null and (verification_mode<>'self_confirm' or self_confirm_approved)))
);
create table supply_adjustments (
 id text primary key, supply_id text not null references network_drop_supplies(id), delta integer not null check(delta <> 0),
 reason text not null, actor_id text not null, created_at timestamptz not null default now()
);
create function protect_network_supply() returns trigger language plpgsql as $$ begin
 if old.approved_by is not null and (to_jsonb(new)-'state') is distinct from (to_jsonb(old)-'state') then
 raise exception 'Approved Drop commitment is immutable; use audited inventory adjustments or a new Drop';
 end if;
 return new;
end $$;
create trigger immutable_network_supply_commitment before update on network_drop_supplies for each row execute function protect_network_supply();
create table member_allocations (
 id text primary key, member_id text not null references uptick_members(id), market_id text not null references market_cells(id),
 week_key text not null, algorithm_version text not null default 'local-v1',
 created_at timestamptz not null default now(), unique(member_id,week_key), unique(id,member_id), unique(id,market_id)
);
create table allocation_options (
 allocation_id text not null, supply_id text not null, market_id text not null,
 rank integer not null check(rank between 1 and 3), reason jsonb not null check(jsonb_typeof(reason)='object'),
 primary key(allocation_id,supply_id), unique(allocation_id,rank),
 foreign key(allocation_id,market_id) references member_allocations(id,market_id),
 foreign key(supply_id,market_id) references network_drop_supplies(id,market_id)
);
create table member_claims (
 claim_id text primary key, member_id text not null, customer_id text not null, organization_id text not null,
 supply_id text not null, offer_id text not null, allocation_id text not null unique,
 reserved_until timestamptz, created_at timestamptz not null default now(),
 foreign key(member_id,customer_id) references uptick_members(id,customer_id),
 foreign key(claim_id,customer_id,organization_id) references claims(id,customer_id,organization_id),
 foreign key(supply_id,offer_id,organization_id) references network_drop_supplies(id,offer_id,organization_id),
 foreign key(allocation_id,member_id) references member_allocations(id,member_id),
 foreign key(allocation_id,supply_id) references allocation_options(allocation_id,supply_id)
);
create table demand_events (
 id text primary key, member_id text references uptick_members(id), market_id text references market_cells(id),
 organization_id text references organizations(id), location_id text references locations(id),
 source_id text references acquisition_sources(id), supply_id text references network_drop_supplies(id),
 allocation_id text references member_allocations(id), claim_id text references claims(id),
 kind text not null, evidence_class text not null default 'observed' check(evidence_class in ('observed','derived','inferred','estimated','unavailable')),
 detail jsonb not null default '{}' check(jsonb_typeof(detail)='object'),
 dedup_key text unique, created_at timestamptz not null default now()
);
create index demand_member_timeline on demand_events(member_id,created_at);
create index demand_source_cohorts on demand_events(source_id,kind,created_at);
create table member_referrals (
 id text primary key, member_id text not null references uptick_members(id), supply_id text references network_drop_supplies(id),
 public_token text not null unique, max_joins integer not null default 5 check(max_joins between 1 and 100),
 created_at timestamptz not null default now(), expires_at timestamptz not null
);
create table referral_joins (
 referral_id text not null references member_referrals(id), member_id text not null unique references uptick_members(id),
 created_at timestamptz not null default now(), primary key(referral_id,member_id)
);
create table network_experiments (
 id text primary key, market_id text not null references market_cells(id), hypothesis text not null,
 primary_metric text not null, starts_at timestamptz not null, ends_at timestamptz not null,
 exclusions jsonb not null default '{}', state text not null default 'draft' check(state in ('draft','running','complete')),
 check(ends_at > starts_at)
);
create table experiment_assignments (
 experiment_id text not null references network_experiments(id), member_id text not null references uptick_members(id),
 arm text not null check(arm in ('control','treatment')), eligibility_snapshot jsonb not null,
 created_at timestamptz not null default now(), primary key(experiment_id,member_id)
);
do $$ declare t text; begin
 foreach t in array array['market_cells','market_zips','market_locations','acquisition_partners','partner_markets','acquisition_sources','uptick_members','member_access','member_consents','network_drop_supplies','supply_adjustments','member_allocations','allocation_options','member_claims','demand_events','member_referrals','referral_joins','network_experiments','experiment_assignments'] loop
 execute format('alter table %I enable row level security',t);
 end loop;
 foreach t in array array['member_consents','supply_adjustments','member_allocations','allocation_options','member_claims','demand_events','referral_joins','experiment_assignments'] loop
 execute format('create trigger immutable_%I before update or delete on %I for each row execute function reject_history_change()',t,t);
 end loop;
end $$;
