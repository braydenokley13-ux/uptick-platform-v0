-- Preserve the choices made for the first request for this exact private pass.
-- Historical passes deliberately get no inferred marketing choices: opening them
-- confirms possession only, while their private preferences can still record a new opt-in.
create table claim_consent_choices (
 claim_id text primary key references claims(id),
 merchant_requested boolean not null default false,
 network_requested boolean not null default false,
 created_at timestamptz not null default now()
);
alter table claim_consent_choices enable row level security;
create trigger immutable_claim_consent_choices before update or delete on claim_consent_choices for each row execute function reject_history_change();
