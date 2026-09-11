create table merchant_growth_preferences (
 organization_id text primary key references organizations(id),
 objective text not null default 'store_visits' check(objective in ('store_visits','morning_traffic','afternoon_traffic','trial','repeat_visits')),
 objective_note text not null default '', fixed_fee_budget numeric(12,2) check(fixed_fee_budget>=0),
 reward_spend_cap numeric(12,2) check(reward_spend_cap>=0),
 verification_preference text not null default 'staff_tap' check(verification_preference in ('staff_tap','public_tap','self_confirm')),
 updated_by text not null, updated_at timestamptz not null default now()
);
alter table merchant_growth_preferences enable row level security;
