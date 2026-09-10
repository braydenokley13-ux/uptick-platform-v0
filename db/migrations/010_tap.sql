-- A permanent point belongs to a store, independently of any Drop or member pass.
create table redemption_points (
 id text primary key, organization_id text not null references organizations(id),
 location_id text not null, name text not null, exposure text not null check(exposure in ('staff','public')),
 state text not null default 'active' check(state in ('active','revoked')),
 created_by text not null, created_at timestamptz not null default now(), revoked_at timestamptz,
 unique(id,organization_id), foreign key(location_id,organization_id) references locations(id,organization_id)
);
create table redemption_credentials (
 id text primary key, point_id text not null references redemption_points(id),
 public_token text not null unique, credential_type text not null check(credential_type in ('qr','secure_nfc')),
 state text not null default 'active' check(state in ('active','revoked')),
 version integer not null check(version > 0), replaces_id text unique references redemption_credentials(id),
 uid text, profile text, meta_key_ref text, file_key_ref text,
 last_counter integer not null default -1 check(last_counter between -1 and 16777215),
 last_validated_at timestamptz, created_by text not null, created_at timestamptz not null default now(), revoked_at timestamptz,
 unique(point_id,credential_type,version), unique(id,point_id),
 check((credential_type='qr' and uid is null and profile is null and meta_key_ref is null and file_key_ref is null)
 or (credential_type='secure_nfc' and uid is not null and profile is not null and meta_key_ref is not null and file_key_ref is not null
 and uid ~ '^[0-9A-F]{14}$' and profile='ntag424-encrypted-picc-empty-mac-v1'
 and meta_key_ref ~ '^UPTICK_NFC_KEY_[A-Z0-9_]{1,80}$' and file_key_ref ~ '^UPTICK_NFC_KEY_[A-Z0-9_]{1,80}$'))
);
create unique index redemption_one_active_credential on redemption_credentials(point_id,credential_type) where state='active';
create unique index redemption_active_uid on redemption_credentials(uid) where state='active' and uid is not null;
create table redemption_evidence (
 id text primary key, claim_id text not null unique references claims(id), organization_id text not null,
 point_id text, credential_id text references redemption_credentials(id),
 method text not null check(method in ('qr','secure_nfc','self_confirm','operator_override')),
 verification_level integer not null check(verification_level between 0 and 2),
 verification_policy text not null check(verification_policy in ('staff_tap','public_tap','self_confirm','legacy_staff_tap')),
 staff_gated boolean not null default false, transaction_verified boolean not null default false check(transaction_verified=false),
 nfc_counter integer, actor text not null, reason text, created_at timestamptz not null default now(),
 foreign key(claim_id,organization_id) references claims(id,organization_id),
 foreign key(point_id,organization_id) references redemption_points(id,organization_id),
 foreign key(credential_id,point_id) references redemption_credentials(id,point_id),
 check((method='qr' and verification_level=1 and point_id is not null and credential_id is not null and nfc_counter is null)
 or (method='secure_nfc' and verification_level=2 and point_id is not null and credential_id is not null and nfc_counter is not null)
 or (method in ('self_confirm','operator_override') and verification_level=0 and point_id is null and credential_id is null and nfc_counter is null)),
 check(method<>'operator_override' or length(reason)>=12)
);
-- Rehearsals never create claims, redemptions, or production verification evidence.
create table tap_test_events (
 id text primary key, actor text not null, point_id text references redemption_points(id),
 scenario text not null check(scenario in ('qr','secure_nfc_vector','wrong_location','replay','revoked')),
 outcome text not null check(outcome in ('simulated_success','simulated_rejection')),
 detail jsonb not null check(jsonb_typeof(detail)='object'), created_at timestamptz not null default now()
);
create trigger immutable_redemption_evidence before update or delete on redemption_evidence for each row execute function reject_history_change();
create trigger immutable_tap_test_events before update or delete on tap_test_events for each row execute function reject_history_change();
create function protect_redemption_point() returns trigger language plpgsql as $$ begin
 if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id or new.location_id is distinct from old.location_id or new.exposure is distinct from old.exposure
 then raise exception 'A redemption point cannot move or change its verification policy; create a replacement'; end if;
 if old.state='revoked' and new.state<>'revoked' then raise exception 'A revoked point cannot be restored'; end if;
 return new;
end $$;
create trigger protect_redemption_point before update on redemption_points for each row execute function protect_redemption_point();
create function protect_redemption_credential() returns trigger language plpgsql as $$ begin
 if new.id is distinct from old.id or new.point_id is distinct from old.point_id or new.public_token is distinct from old.public_token or new.credential_type is distinct from old.credential_type
 or new.version is distinct from old.version or new.replaces_id is distinct from old.replaces_id or new.uid is distinct from old.uid or new.profile is distinct from old.profile
 or new.meta_key_ref is distinct from old.meta_key_ref or new.file_key_ref is distinct from old.file_key_ref
 then raise exception 'Credential provisioning is immutable; rotate the credential'; end if;
 if old.state='revoked' and new.state<>'revoked' then raise exception 'A revoked credential cannot be restored'; end if;
 if new.last_counter<old.last_counter then raise exception 'A secure Tap counter cannot go backwards'; end if;
 return new;
end $$;
create trigger protect_redemption_credential before update on redemption_credentials for each row execute function protect_redemption_credential();
do $$ declare t text; begin
 foreach t in array array['redemption_points','redemption_credentials','redemption_evidence','tap_test_events'] loop
 execute format('alter table %I enable row level security',t);
 end loop;
end $$;
