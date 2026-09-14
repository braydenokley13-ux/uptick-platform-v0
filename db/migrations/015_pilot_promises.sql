-- Existing Drop records remain internal and are not silently certified as pilot
-- supply. A pilot_supply_terms row is the explicit, operator-created contract.
alter table network_drop_supplies add column data_kind text not null default 'internal'
 check(data_kind in ('real','internal','demo','synthetic'));
alter table network_drop_supplies add constraint network_supply_location_identity
 unique(id,location_id,organization_id);

create table pilot_supply_terms (
 supply_id text primary key references network_drop_supplies(id),
 exact_item text not null check(length(trim(exact_item)) between 3 and 200),
 item_sku text not null check(length(trim(item_sku)) between 1 and 100),
 size_label text not null check(length(trim(size_label)) between 1 and 100),
 usable_hours text not null check(length(trim(usable_hours)) between 3 and 500),
 dependency_key text not null check(length(trim(dependency_key)) between 3 and 100),
 required_spend numeric(12,2) not null default 0 check(required_spend=0),
 member_fee numeric(12,2) not null default 0 check(member_fee=0),
 funder_organization_id text not null references organizations(id),
 fulfiller_organization_id text not null references organizations(id),
 data_kind text not null check(data_kind in ('real','internal','demo','synthetic')),
 created_by text not null, created_at timestamptz not null default now(),
 foreign key(supply_id,fulfiller_organization_id)
  references network_drop_supplies(id,organization_id)
);

-- Readiness is deliberately a time-bound checklist, rather than an invented
-- score. It is refreshed as the real counter, staff and stock change.
create table destination_readiness (
 supply_id text primary key,
 organization_id text not null, location_id text not null,
 state text not null default 'not_ready'
  check(state in ('not_ready','ready','restricted','suspended')),
 owner_approved_by text,
 primary_manager text not null default '', primary_contact text not null default '',
 backup_contact text not null default '', stock_confirmed_at timestamptz,
 exact_item_confirmed boolean not null default false,
 staff_instructions_confirmed boolean not null default false,
 shifts_briefed_at timestamptz, valid_hours_confirmed boolean not null default false,
 qr_rehearsed_at timestamptz, support_escalation text not null default '',
 valid_until timestamptz, updated_by text not null, updated_at timestamptz not null default now(),
 foreign key(supply_id,location_id,organization_id)
  references network_drop_supplies(id,location_id,organization_id),
 check(state<>'ready' or (
  owner_approved_by is not null and length(trim(primary_manager))>=2
  and length(trim(primary_contact))>=3 and length(trim(backup_contact))>=3
  and stock_confirmed_at is not null and exact_item_confirmed
  and staff_instructions_confirmed and shifts_briefed_at is not null
  and valid_hours_confirmed and qr_rehearsed_at is not null
  and length(trim(support_escalation))>=10 and valid_until is not null
 ))
);

-- Same-counter fallback capacity is independent of the primary item's failed
-- dependency. A recovery reservation consumes this separate finite pool.
create table pilot_supply_fallbacks (
 id text primary key, supply_id text not null unique references network_drop_supplies(id),
 substitute_item text not null check(length(trim(substitute_item)) between 3 and 200),
 substitute_sku text not null check(length(trim(substitute_sku)) between 1 and 100),
 size_label text not null check(length(trim(size_label)) between 1 and 100),
 dependency_key text not null check(length(trim(dependency_key)) between 3 and 100),
 usable_capacity integer not null check(usable_capacity between 1 and 1000000),
 required_spend numeric(12,2) not null default 0 check(required_spend=0),
 member_fee numeric(12,2) not null default 0 check(member_fee=0),
 instructions text not null check(length(trim(instructions)) between 10 and 1500),
 payer_organization_id text not null references organizations(id),
 state text not null default 'draft'
  check(state in ('draft','approved','paused','exhausted')),
 approved_by text, created_by text not null, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(state<>'approved' or approved_by is not null)
);

-- A release is published only in the same transaction that inserts every one
-- of its grants. The existing member_allocations row remains the sole
-- member-week anchor.
create table weekly_releases (
 id text primary key, run_id text, market_id text not null references market_cells(id),
 week_key text not null check(week_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 state text not null check(state='published'),
 data_kind text not null check(data_kind in ('real','internal','demo','synthetic')),
 member_count integer not null check(member_count between 1 and 200),
 reviewed_by text not null, request_key text not null unique,
 request_fingerprint text not null, published_at timestamptz not null default now(),
 check(data_kind<>'real' or run_id is not null), unique(id,market_id)
);
create unique index one_run_weekly_release on weekly_releases(run_id,week_key)
 where run_id is not null;
create unique index one_internal_market_weekly_release on weekly_releases(market_id,week_key)
 where run_id is null;

create table fulfillment_grants (
 id text primary key, release_id text not null, allocation_id text not null unique,
 member_id text not null, market_id text not null, week_key text not null,
 supply_id text not null, organization_id text not null, location_id text not null,
 offer_id text not null, offer_version integer not null,
 reserved_quantity integer not null default 1 check(reserved_quantity=1),
 member_snapshot jsonb not null check(jsonb_typeof(member_snapshot)='object'),
 expires_at timestamptz not null,
 source_program_id text, source_program_version integer,
 data_kind text not null check(data_kind in ('real','internal','demo','synthetic')),
 state text not null default 'issued' check(state in ('issued','claimed','redeemed')),
 claimed_at timestamptz, redeemed_at timestamptz, created_at timestamptz not null default now(),
 unique(allocation_id,supply_id), unique(id,member_id),
 foreign key(release_id,market_id) references weekly_releases(id,market_id),
 foreign key(allocation_id,member_id) references member_allocations(id,member_id),
 foreign key(allocation_id,supply_id) references allocation_options(allocation_id,supply_id),
 foreign key(supply_id,market_id) references network_drop_supplies(id,market_id),
 foreign key(supply_id,offer_id,organization_id)
  references network_drop_supplies(id,offer_id,organization_id),
 foreign key(location_id,organization_id) references locations(id,organization_id),
 foreign key(offer_id,offer_version) references offer_versions(offer_id,version),
 check((source_program_id is null)=(source_program_version is null)),
 check((state='issued' and claimed_at is null and redeemed_at is null)
  or (state='claimed' and claimed_at is not null and redeemed_at is null)
  or (state='redeemed' and claimed_at is not null and redeemed_at is not null))
);
alter table member_claims add column grant_id text unique references fulfillment_grants(id);

create table fulfillment_incidents (
 id text primary key, grant_id text not null, member_id text not null,
 claim_id text references claims(id), supply_id text not null references network_drop_supplies(id),
 location_id text not null references locations(id),
 incident_type text not null check(incident_type in (
  'out_of_stock','staff_refusal','unexpected_closure','incorrect_terms','qr_failure',
  'redemption_failure','messaging_issue','member_complaint','inventory_mismatch','other'
 )),
 severity text not null check(severity in ('low','medium','high','critical')),
 occurred_at timestamptz not null, owner text not null, report_note text not null default '',
 state text not null default 'open' check(state in ('open','recovering','resolved','closed')),
 resolution text not null default '', idempotency_key text not null unique,
 created_by text not null, created_at timestamptz not null default now(),
 foreign key(grant_id,member_id) references fulfillment_grants(id,member_id)
);

-- A recovery uses the original claim/pass as its member credential. It does
-- not create another weekly allocation, claim, or paid placement.
create table recovery_grants (
 id text primary key, incident_id text not null unique references fulfillment_incidents(id),
 original_grant_id text not null, member_id text not null,
 original_claim_id text unique references claims(id),
 remedy_type text not null check(remedy_type in ('same_counter','replacement_supply')),
 fallback_id text references pilot_supply_fallbacks(id),
 replacement_supply_id text references network_drop_supplies(id),
 target_organization_id text not null references organizations(id),
 target_location_id text not null,
 reserved_quantity integer not null default 1 check(reserved_quantity=1),
 payer_organization_id text not null references organizations(id),
 payer_evidence text not null check(length(trim(payer_evidence)) between 3 and 1000),
 member_snapshot jsonb not null check(jsonb_typeof(member_snapshot)='object'),
 expires_at timestamptz not null, data_kind text not null
  check(data_kind in ('real','internal','demo','synthetic')),
 state text not null default 'issued' check(state in ('issued','redeemed')),
 counts_as_weekly_benefit boolean not null default false check(not counts_as_weekly_benefit),
 counts_as_paid_placement boolean not null default false check(not counts_as_paid_placement),
 issued_by text not null, issued_at timestamptz not null default now(), redeemed_at timestamptz,
 foreign key(original_grant_id,member_id) references fulfillment_grants(id,member_id),
 foreign key(target_location_id,target_organization_id)
  references locations(id,organization_id),
 check((remedy_type='same_counter' and fallback_id is not null and replacement_supply_id is null)
  or (remedy_type='replacement_supply' and fallback_id is null and replacement_supply_id is not null)),
 check(expires_at>issued_at),
 check((state='issued' and redeemed_at is null) or (state='redeemed' and redeemed_at is not null))
);

create table recovery_redemptions (
 id text primary key, recovery_grant_id text not null unique references recovery_grants(id),
 original_claim_id text not null references claims(id),
 point_id text, credential_id text references redemption_credentials(id),
 method text not null check(method in ('qr','secure_nfc','operator_override')),
 verification_level integer not null check(verification_level between 0 and 2),
 staff_gated boolean not null, transaction_verified boolean not null default false
  check(transaction_verified=false),
 nfc_counter integer, actor text not null, reason text, created_at timestamptz not null default now(),
 foreign key(credential_id,point_id) references redemption_credentials(id,point_id),
 check((method='qr' and verification_level=1 and point_id is not null and credential_id is not null and nfc_counter is null)
  or (method='secure_nfc' and verification_level=2 and point_id is not null and credential_id is not null and nfc_counter is not null)
  or (method='operator_override' and verification_level=0 and point_id is null and credential_id is null and nfc_counter is null)),
 check(method<>'operator_override' or length(trim(reason))>=12)
);

create index fulfillment_grants_supply on fulfillment_grants(supply_id,state,expires_at);
create index fulfillment_incidents_queue on fulfillment_incidents(state,occurred_at);
create index recovery_grants_member on recovery_grants(member_id,state,expires_at);
create unique index one_recovery_per_original_grant
 on recovery_grants(original_grant_id);

create function protect_pilot_supply_terms() returns trigger language plpgsql
 set search_path=public,pg_temp as $$ begin
 if exists(select 1 from network_drop_supplies where id=old.supply_id and approved_by is not null)
 then raise exception 'Published pilot supply terms are immutable; create new supply'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger immutable_pilot_supply_terms before update or delete on pilot_supply_terms
 for each row execute function protect_pilot_supply_terms();

create function protect_pilot_fallback() returns trigger language plpgsql
 set search_path=public,pg_temp as $$ begin
 if tg_op='DELETE' and old.approved_by is not null
 then raise exception 'Approved fallback terms are immutable; create new supply'; end if;
 if tg_op='DELETE' then return old; end if;
 if old.approved_by is not null
  and (to_jsonb(new)-'state'-'updated_at') is distinct from (to_jsonb(old)-'state'-'updated_at')
 then raise exception 'Approved fallback terms are immutable; create new supply'; end if;
 return new;
end $$;
create trigger immutable_pilot_fallback_terms before update or delete on pilot_supply_fallbacks
 for each row execute function protect_pilot_fallback();

create function validate_grant_claim_mapping() returns trigger language plpgsql
 set search_path=public,pg_temp as $$ begin
 if new.grant_id is not null and not exists(
  select 1 from fulfillment_grants g where g.id=new.grant_id
   and g.allocation_id=new.allocation_id and g.member_id=new.member_id
   and g.supply_id=new.supply_id and g.offer_id=new.offer_id
 ) then raise exception 'Claim must transfer its existing fulfillment grant'; end if;
 return new;
end $$;
create trigger valid_grant_claim before insert on member_claims
 for each row execute function validate_grant_claim_mapping();

create function protect_fulfillment_grant() returns trigger language plpgsql
 set search_path=public,pg_temp as $$ begin
 if (to_jsonb(new)-'state'-'claimed_at'-'redeemed_at')
  is distinct from (to_jsonb(old)-'state'-'claimed_at'-'redeemed_at')
 then raise exception 'Issued fulfillment grant context is immutable'; end if;
 if (old.state='claimed' and new.state not in ('claimed','redeemed'))
  or (old.state='redeemed' and new.state<>'redeemed')
 then raise exception 'Fulfillment grant state cannot move backwards'; end if;
 return new;
end $$;
create trigger immutable_fulfillment_grant before update on fulfillment_grants
 for each row execute function protect_fulfillment_grant();

create function protect_fulfillment_incident() returns trigger language plpgsql
 set search_path=public,pg_temp as $$ begin
 if (to_jsonb(new)-'state'-'resolution') is distinct from (to_jsonb(old)-'state'-'resolution')
 then raise exception 'Incident evidence and context are immutable'; end if;
 if (old.state='resolved' and new.state not in ('resolved','closed'))
  or (old.state='closed' and new.state<>'closed')
 then raise exception 'Incident state cannot move backwards'; end if;
 return new;
end $$;
create trigger immutable_fulfillment_incident before update on fulfillment_incidents
 for each row execute function protect_fulfillment_incident();

create function protect_recovery_grant() returns trigger language plpgsql
 set search_path=public,pg_temp as $$ begin
 if new.original_claim_id is distinct from old.original_claim_id and (
   old.original_claim_id is not null or new.original_claim_id is null or not exists(
    select 1 from member_claims mc where mc.claim_id=new.original_claim_id
     and mc.grant_id=new.original_grant_id and mc.member_id=new.member_id
   )
 ) then raise exception 'Recovery can bind only to its original grant claim'; end if;
 if (to_jsonb(new)-'state'-'redeemed_at'-'original_claim_id') is distinct from (to_jsonb(old)-'state'-'redeemed_at'-'original_claim_id')
 then raise exception 'Issued recovery context is immutable'; end if;
 if old.state='redeemed' and new.state<>'redeemed'
 then raise exception 'A redeemed recovery cannot be reset'; end if;
 return new;
end $$;
create trigger immutable_recovery_grant before update on recovery_grants
 for each row execute function protect_recovery_grant();

create trigger immutable_weekly_releases before update or delete on weekly_releases
 for each row execute function reject_history_change();
create trigger immutable_recovery_redemptions before update or delete on recovery_redemptions
 for each row execute function reject_history_change();

do $$ declare t text; begin
 foreach t in array array[
  'pilot_supply_terms','destination_readiness','pilot_supply_fallbacks','weekly_releases',
  'fulfillment_grants','fulfillment_incidents','recovery_grants','recovery_redemptions'
 ] loop execute format('alter table %I enable row level security',t); end loop;
end $$;
