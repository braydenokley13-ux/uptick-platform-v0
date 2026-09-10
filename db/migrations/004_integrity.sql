-- Enforce tenant ownership even when a server-side query is accidentally scoped incorrectly.
alter table locations add constraint locations_id_org unique(id,organization_id);
alter table offers add constraint offers_id_org unique(id,organization_id);
alter table offers add constraint offers_location_org foreign key(location_id,organization_id) references locations(id,organization_id);
alter table sources add constraint sources_id_offer unique(id,offer_id);
alter table broadcasts add constraint broadcasts_id_offer_org unique(id,offer_id,organization_id);
alter table broadcasts add constraint broadcasts_offer_org foreign key(offer_id,organization_id) references offers(id,organization_id);
alter table claims add constraint claims_offer_org foreign key(offer_id,organization_id) references offers(id,organization_id);
alter table claims add constraint claims_source_offer foreign key(source_id,offer_id) references sources(id,offer_id);
alter table claims add constraint claims_broadcast_offer_org foreign key(broadcast_id,offer_id,organization_id) references broadcasts(id,offer_id,organization_id);
alter table claims add constraint claims_id_customer_org unique(id,customer_id,organization_id);
alter table claims add constraint claims_id_org unique(id,organization_id);
alter table senders add constraint senders_id_org unique(id,organization_id);
create unique index senders_unique_phone on senders(phone) where phone is not null;
alter table redemptions add constraint redemptions_claim_org foreign key(claim_id,organization_id) references claims(id,organization_id);
alter table messages add constraint messages_claim_customer_org foreign key(claim_id,customer_id,organization_id) references claims(id,customer_id,organization_id);
alter table messages add constraint messages_sender_org foreign key(sender_id,organization_id) references senders(id,organization_id);
alter table subscriptions add constraint subscriptions_scope_org check((scope='network' and organization_id is null) or (scope<>'network' and scope=organization_id and organization_id is not null));
alter table consent_events add constraint consent_scope_org check((purpose='network' and organization_id is null) or (purpose<>'network' and organization_id is not null));
alter table claims add constraint claims_redemption_state check((state='redeemed' and redeemed_at is not null) or (state<>'redeemed' and redeemed_at is null));

-- A pass always preserves the exact promise and acquisition source originally issued.
create function protect_claim_history() returns trigger language plpgsql as $$ begin
 if new.id is distinct from old.id or new.customer_id is distinct from old.customer_id
 or new.organization_id is distinct from old.organization_id or new.offer_id is distinct from old.offer_id
 or new.offer_version is distinct from old.offer_version or new.source_id is distinct from old.source_id
 or new.broadcast_id is distinct from old.broadcast_id or new.token_hash is distinct from old.token_hash
 or new.token_encrypted is distinct from old.token_encrypted or new.snapshot is distinct from old.snapshot
 or new.created_at is distinct from old.created_at then raise exception 'Issued pass history is immutable'; end if;
 if old.state<>'active' and (new.state is distinct from old.state or new.redeemed_at is distinct from old.redeemed_at)
 then raise exception 'A completed pass cannot be reset'; end if;
 if old.opened_at is not null and new.opened_at is distinct from old.opened_at
 then raise exception 'First pass opening is immutable'; end if;
 return new;
end $$;
create trigger immutable_claim_context before update on claims for each row execute function protect_claim_history();

create function protect_source_history() returns trigger language plpgsql as $$ begin
 if new.id is distinct from old.id or new.token is distinct from old.token
 or new.offer_id is distinct from old.offer_id or new.placement_id is distinct from old.placement_id
 or new.campaign is distinct from old.campaign or new.creative is distinct from old.creative
 or new.created_at is distinct from old.created_at then raise exception 'Source attribution is immutable; create a new source'; end if;
 return new;
end $$;
create trigger immutable_source_context before update on sources for each row execute function protect_source_history();
create trigger immutable_message_events before update or delete on message_events for each row execute function reject_history_change();
create trigger immutable_inbound_events before update or delete on inbound_events for each row execute function reject_history_change();
