-- Exported art retains the merchant identity and sample disclosure from its creation.
alter table source_creatives add column merchant_name text not null default '';
alter table source_creatives add column is_demo boolean not null default false;
alter table source_creatives disable trigger immutable_source_creatives;
update source_creatives cr set merchant_name=g.name,is_demo=g.is_demo
 from sources s join offers o on o.id=s.offer_id join organizations g on g.id=o.organization_id
 where cr.source_id=s.id;
alter table source_creatives enable trigger immutable_source_creatives;

-- Each source has one successor, with a preserved, valid version of the same offer.
create unique index source_creatives_one_successor on source_creatives(parent_source_id) where parent_source_id is not null;
create function validate_creative_context() returns trigger language plpgsql as $$
declare source_offer text; parent_offer text; parent_version integer;
begin
 select offer_id into source_offer from sources where id=new.source_id;
 if not exists(select 1 from offer_versions where offer_id=source_offer and version=new.offer_version)
 then raise exception 'Creative must reference an existing version of its source offer'; end if;
 if new.parent_source_id is not null then
  select s.offer_id,c.version into parent_offer,parent_version from sources s join source_creatives c on c.source_id=s.id where s.id=new.parent_source_id;
  if parent_offer is distinct from source_offer or parent_version is null or new.version<>parent_version+1
  then raise exception 'Creative replacement must follow the same source offer and version sequence'; end if;
 elsif new.version<>1 then raise exception 'The first creative must be version 1';
 end if;
 return new;
end $$;
create trigger valid_creative_context before insert on source_creatives for each row execute function validate_creative_context();
alter table offer_reviews add constraint offer_reviews_saved_version foreign key(offer_id,offer_version) references offer_versions(offer_id,version);
