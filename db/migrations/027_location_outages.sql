create table location_outages (
 id text primary key, location_id text not null references locations(id),
 reason text not null check(length(trim(reason)) between 10 and 1500),
 owner text not null, opened_by text not null, opened_at timestamptz not null default now(),
 request_key text not null unique, closed_at timestamptz, closed_by text,
 resolution_evidence text not null default '',
 check(closed_at is null or (closed_by is not null and length(trim(resolution_evidence))>=10))
);
create unique index one_open_location_outage on location_outages(location_id) where closed_at is null;
create table location_outage_obligations (
 outage_id text not null references location_outages(id), grant_id text not null references fulfillment_grants(id),
 created_at timestamptz not null default now(), primary key(outage_id,grant_id)
);
alter table location_outages enable row level security;
alter table location_outage_obligations enable row level security;
create function protect_location_outage() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if (to_jsonb(new)-'closed_at'-'closed_by'-'resolution_evidence') is distinct from (to_jsonb(old)-'closed_at'-'closed_by'-'resolution_evidence')
  or (old.closed_at is not null and to_jsonb(new) is distinct from to_jsonb(old))
 then raise exception 'Location outage evidence is immutable'; end if;
 return new;
end $$;
create trigger immutable_location_outage before update on location_outages for each row execute function protect_location_outage();
create trigger no_location_outage_deletion before delete on location_outages for each row execute function reject_history_change();
create trigger immutable_location_outage_obligations before update or delete on location_outage_obligations for each row execute function reject_history_change();
