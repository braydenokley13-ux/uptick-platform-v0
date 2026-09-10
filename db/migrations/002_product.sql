-- Offer strategy is versioned with the promise that customers actually receive.
create table offer_product_metadata (
 offer_id text not null,
 version integer not null,
 goal text not null default 'return' check (length(goal) <= 80),
 template_id text check (length(template_id) <= 80),
 customer_value numeric(10,2) check (customer_value >= 0),
 reward_cost numeric(10,2) check (reward_cost >= 0),
 required_purchase numeric(10,2) check (required_purchase >= 0),
 staff_instructions text not null default '' check (length(staff_instructions) <= 1500),
 created_at timestamptz not null default now(),
 primary key (offer_id,version),
 foreign key (offer_id,version) references offer_versions(offer_id,version)
);
alter table offer_product_metadata enable row level security;
create trigger immutable_offer_product_metadata before update or delete on offer_product_metadata for each row execute function reject_history_change();
