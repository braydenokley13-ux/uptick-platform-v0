create table if not exists organizations (
 id text primary key, name text not null, capabilities text[] not null default '{merchant}', timezone text not null default 'America/New_York', is_demo boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists locations (id text primary key, organization_id text not null references organizations(id), name text not null, address text not null, created_at timestamptz not null default now());
create table if not exists memberships (user_id text not null, organization_id text not null references organizations(id), role text not null check(role in ('merchant','operator')), can_export boolean not null default false, primary key(user_id,organization_id));
create table if not exists senders (id text primary key, organization_id text not null unique references organizations(id), service_sid text unique, phone text, approved boolean not null default false);
create table if not exists offers (
 id text primary key, organization_id text not null references organizations(id), location_id text not null references locations(id), kind text not null check(kind in ('anchor','drop')), state text not null check(state in ('draft','review','scheduled','live','paused','ended')), title text not null, current_version integer not null default 1, created_at timestamptz not null default now()
);
create table if not exists offer_versions (
 offer_id text not null references offers(id), version integer not null, qualification text not null, reward text not null, terms text not null, starts_at timestamptz not null, expires_at timestamptz not null, limit_mode text not null default 'unlimited' check(limit_mode in ('unlimited','claim','redemption')), quantity integer check(quantity > 0), created_at timestamptz not null default now(), primary key(offer_id,version), check(expires_at > starts_at), check(limit_mode='unlimited' or quantity is not null)
);
create table if not exists placements (id text primary key, location_id text not null references locations(id), name text not null, external_reference text, status text not null default 'intended' check(status in ('intended','confirmed','paused')), confirmed_at timestamptz);
create table if not exists sources (
 id text primary key, token text not null unique, offer_id text not null references offers(id), placement_id text references placements(id), campaign text not null, creative text not null, state text not null default 'active' check(state in ('active','revoked')), created_at timestamptz not null default now()
);
create table if not exists source_visits (id text primary key, source_id text not null references sources(id), created_at timestamptz not null default now());
create table if not exists customers (id text primary key, phone text not null unique, created_at timestamptz not null default now());
create table if not exists relationships (customer_id text not null references customers(id), organization_id text not null references organizations(id), acquisition_claim_id text, possession_confirmed_at timestamptz, created_at timestamptz not null default now(), primary key(customer_id,organization_id));
create table if not exists claims (
 id text primary key, customer_id text not null references customers(id), organization_id text not null references organizations(id), offer_id text not null references offers(id), offer_version integer not null, source_id text references sources(id), broadcast_id text, token_hash text not null unique, token_encrypted text not null, snapshot jsonb not null, state text not null default 'active' check(state in ('active','redeemed','invalidated')), created_at timestamptz not null default now(), opened_at timestamptz, redeemed_at timestamptz, unique(customer_id,offer_id), foreign key(offer_id,offer_version) references offer_versions(offer_id,version)
);
create table if not exists redemptions (id text primary key, claim_id text not null unique references claims(id), organization_id text not null references organizations(id), created_at timestamptz not null default now());
create table if not exists consent_events (
 id text primary key, customer_id text not null references customers(id), organization_id text references organizations(id), purpose text not null check(purpose in ('fulfillment','merchant','network')), accepted boolean not null, disclosure_version text not null, disclosure text not null, source_ui text not null, phone text not null, created_at timestamptz not null default now()
);
create table if not exists subscriptions (customer_id text not null references customers(id), scope text not null, organization_id text references organizations(id), state text not null check(state in ('pending','subscribed','unsubscribed')), updated_at timestamptz not null default now(), primary key(customer_id,scope));
create table if not exists suppressions (phone text not null, sender_id text not null references senders(id), suppressed boolean not null, updated_at timestamptz not null default now(), primary key(phone,sender_id));
create table if not exists broadcasts (id text primary key, offer_id text not null unique references offers(id), organization_id text not null references organizations(id), scheduled_at timestamptz not null, week_key text not null, state text not null default 'scheduled' check(state in ('scheduled','queued','paused','complete')), approved_by text not null, created_at timestamptz not null default now());
create unique index if not exists one_drop_per_week on broadcasts(organization_id,week_key) where state <> 'paused';
create table if not exists messages (
 id text primary key, organization_id text not null references organizations(id), customer_id text not null references customers(id), sender_id text not null references senders(id), claim_id text not null references claims(id), broadcast_id text references broadcasts(id), purpose text not null check(purpose in ('fulfillment','merchant')), state text not null default 'queued', provider_sid text unique, error_code text, suppression_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(claim_id,purpose)
);
create table if not exists message_events (id text primary key, message_id text references messages(id), provider_sid text not null, state text not null, error_code text, created_at timestamptz not null default now(), unique(provider_sid,state));
create table if not exists inbound_events (provider_sid text primary key, sender_id text not null references senders(id), action text not null, created_at timestamptz not null default now());
create table if not exists audit_events (id text primary key, organization_id text references organizations(id), actor text not null, action text not null, entity_id text not null, detail jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists rate_limits (key text primary key, window_at timestamptz not null default now(), count integer not null default 1);
create index if not exists claims_merchant on claims(organization_id,created_at);
create index if not exists consent_history on consent_events(customer_id,organization_id,created_at);
create index if not exists dispatch_queue on messages(state,created_at);
create index if not exists broadcasts_due on broadcasts(state,scheduled_at);
-- All customer/operating data is private. Browser access is denied, even with a valid Supabase JWT.
-- The authenticated Next server checks live memberships on every operation. Use a dedicated backend role.
do $$ declare t text; begin
 foreach t in array array['organizations','locations','memberships','senders','offers','offer_versions','placements','sources','source_visits','customers','relationships','claims','redemptions','consent_events','subscriptions','suppressions','broadcasts','messages','message_events','inbound_events','audit_events','rate_limits'] loop
 execute format('alter table %I enable row level security',t);
 end loop;
end $$;
create or replace function reject_history_change() returns trigger language plpgsql as $$ begin raise exception 'Historical records are immutable'; end $$;
create trigger immutable_offer_versions before update or delete on offer_versions for each row execute function reject_history_change();
create trigger immutable_consent before update or delete on consent_events for each row execute function reject_history_change();
create trigger immutable_audit before update or delete on audit_events for each row execute function reject_history_change();
create trigger immutable_redemptions before update or delete on redemptions for each row execute function reject_history_change();
