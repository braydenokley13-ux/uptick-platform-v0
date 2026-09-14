-- Every paid Program placement carries a category, even when the buyer does
-- not purchase its own radius protection. Existing protected versions have an
-- exact category to backfill; older unprotected versions remain explicitly
-- unclassified until they are replaced by a reviewed version.
alter table growth_program_versions
 add column placement_category text not null default 'unclassified'
 check(length(trim(placement_category)) between 2 and 80);

alter table growth_program_versions disable trigger immutable_growth_program_versions;
update growth_program_versions v
 set placement_category=p.competing_category
 from growth_program_protections p
 where p.program_id=v.program_id and p.program_version=v.version;
alter table growth_program_versions enable trigger immutable_growth_program_versions;

-- A supply can carry forward unchanged between sequential versions of one
-- Program and week. It cannot be sold into another Program or another week.
alter table program_supply_links
 drop constraint program_supply_links_supply_id_key;

create function validate_program_supply_link() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 perform 1 from growth_program_coordination where singleton=true for update;
 if exists(
  select 1 from program_supply_links l
  where l.supply_id=new.supply_id
   and (l.program_id<>new.program_id or l.week_key<>new.week_key)
 ) then
  raise exception 'Program supply is already committed to another Program or week';
 end if;
 return new;
end $$;
create trigger valid_program_supply_link before insert on program_supply_links
 for each row execute function validate_program_supply_link();

-- Credit evidence is the idempotency key for one Program. Historical blank
-- references remain readable, while every new application write requires one.
create unique index growth_program_credit_reference
 on growth_program_credits(program_id,reference) where reference<>'';
