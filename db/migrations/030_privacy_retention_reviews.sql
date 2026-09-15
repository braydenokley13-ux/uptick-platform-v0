-- Privacy removal is a narrow exception for free-text notes, never for a
-- member's cohort, entitlement, price, inventory, state or redemption evidence.
create table privacy_note_redactions (
 id text primary key, request_id text not null references privacy_requests(id),
 member_id text not null references uptick_members(id),
 table_name text not null, row_id text not null, fields text[] not null,
 actor_id text not null, created_at timestamptz not null default now()
);
create table privacy_retention_reviews (
 id text primary key, sequence bigint generated always as identity unique,
 member_id text not null references member_erasure_records(member_id),
 category text not null check(category in ('consent','operational','financial')),
 outcome text not null check(outcome in ('deidentified','hold')),
 policy_id text not null references privacy_policy_versions(id),
 evidence_encrypted text not null, next_review_at timestamptz,
 actor_id text not null, created_at timestamptz not null default now(),
 check((outcome='hold' and next_review_at>created_at) or (outcome='deidentified' and next_review_at is null))
);
alter table privacy_note_redactions enable row level security;
alter table privacy_retention_reviews enable row level security;

create function privacy_scrub_audit_detail(input_value jsonb, field_name text default '') returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare result jsonb; item record; begin
 if lower(field_name) in ('phone','email','address','name','note','reason','resolution','evidence','body','homezip','workzip','home_zip','work_zip','report_note')
 then return to_jsonb('Personal details removed under a verified privacy request.'::text); end if;
 if jsonb_typeof(input_value)='object' then
  result:='{}'::jsonb;
  for item in select e.key,e.value v from jsonb_each(input_value) e loop
   result:=result||jsonb_build_object(item.key,privacy_scrub_audit_detail(item.v,item.key));
  end loop;
  return result;
 elsif jsonb_typeof(input_value)='array' then
  select coalesce(jsonb_agg(privacy_scrub_audit_detail(v)),'[]'::jsonb) into result from jsonb_array_elements(input_value) v;
  return result;
 end if;
 return input_value;
end $$;

create function privacy_note_redaction_allowed(tab text, before_row jsonb, after_row jsonb)
returns boolean language plpgsql set search_path=public,pg_temp as $$
declare event privacy_note_redactions; allowed text[]; field text; identifier text;
begin
 allowed := case tab
  when 'member_service_events' then array['reason']
  when 'member_destination_reviews' then array['evidence']
  when 'fulfillment_incidents' then array['report_note','resolution']
  when 'recovery_failures' then array['reason']
  when 'redemption_evidence' then array['reason']
  when 'recovery_redemptions' then array['reason']
  when 'audit_events' then array['detail']
  else null end;
 if allowed is null then return false; end if;
 identifier := coalesce(before_row->>'id', before_row->>'recovery_id');
 select r.* into event from privacy_note_redactions r join privacy_requests p on p.id=r.request_id
 where r.id=current_setting('uptick.privacy_redaction_id',true)
  and r.table_name=tab and r.row_id=identifier and r.member_id=p.member_id
  and p.kind='deletion' and p.state in ('verified','completed');
 if event.id is null or not(event.fields <@ allowed) or cardinality(event.fields)=0 then return false; end if;
 if (before_row-event.fields) is distinct from (after_row-event.fields) then return false; end if;
 foreach field in array event.fields loop
  if tab='audit_events' then
   if after_row->field is distinct from privacy_scrub_audit_detail(before_row->field) then return false; end if;
  elsif after_row->>field is distinct from 'Personal details removed under a verified privacy request.' then return false; end if;
 end loop;
 return true;
end $$;

create or replace function reject_history_change() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if tg_op='UPDATE' and privacy_note_redaction_allowed(tg_table_name,to_jsonb(old),to_jsonb(new)) then return new; end if;
 raise exception 'Historical records are immutable';
end $$;
create or replace function protect_fulfillment_incident() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if privacy_note_redaction_allowed(tg_table_name,to_jsonb(old),to_jsonb(new)) then return new; end if;
 if (to_jsonb(new)-'state'-'resolution') is distinct from (to_jsonb(old)-'state'-'resolution')
 then raise exception 'Incident evidence and context are immutable'; end if;
 if (old.state='resolved' and new.state not in ('resolved','closed')) or (old.state='closed' and new.state<>'closed')
 then raise exception 'Incident state cannot move backwards'; end if;
 return new;
end $$;
create trigger immutable_privacy_note_redactions before update or delete on privacy_note_redactions for each row execute function reject_history_change();
create trigger immutable_privacy_retention_reviews before update or delete on privacy_retention_reviews for each row execute function reject_history_change();

create view privacy_retention_queue as
 select e.member_id,c.category,e.policy_id original_policy_id,
  coalesce(r.next_review_at,(e.retained_categories->c.category->>'reviewAt')::timestamptz) review_due_at,
  r.outcome,r.id last_review_id
 from member_erasure_records e cross join (values ('consent'),('operational'),('financial')) c(category)
 left join lateral(select * from privacy_retention_reviews r where r.member_id=e.member_id and r.category=c.category order by sequence desc limit 1) r on true
 where r.outcome is distinct from 'deidentified';
