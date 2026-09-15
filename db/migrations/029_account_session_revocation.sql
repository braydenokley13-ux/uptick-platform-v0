-- Application revocation is immediate even during a provider outage. No tokens
-- or factor secrets are stored in this ledger.
create table account_session_revocations (
 session_id text primary key,
 user_id text not null,
 reason text not null,
 revoked_at timestamptz not null default now()
);
alter table account_session_revocations enable row level security;
create index account_session_revocations_user on account_session_revocations(user_id);
create trigger immutable_account_session_revocations before update or delete on account_session_revocations
 for each row execute function reject_history_change();
