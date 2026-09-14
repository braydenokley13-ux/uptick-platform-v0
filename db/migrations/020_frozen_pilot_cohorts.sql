alter table pilot_runs add column cohort_frozen_at timestamptz;
update pilot_runs set cohort_frozen_at=created_at where state in ('live','complete');

create function protect_frozen_pilot_cohort() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.cohort_frozen_at is not null then
    if new.cohort_frozen_at is distinct from old.cohort_frozen_at or new.state in ('draft','enrolling') then
      raise exception 'The fixed baseline cohort cannot be reopened or unfrozen';
    end if;
  end if;
  if new.state='live' and new.cohort_frozen_at is null then new.cohort_frozen_at=now(); end if;
  return new;
end;
$$;
create trigger protect_frozen_pilot_cohort before update on pilot_runs for each row execute function protect_frozen_pilot_cohort();

create function validate_pilot_admission() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare run pilot_runs;
begin
  select * into run from pilot_runs where id=new.run_id for update;
  if run.state<>'enrolling' or run.cohort_frozen_at is not null then
    raise exception 'Admissions require an enrolling pilot with an unfrozen cohort';
  end if;
  if new.data_kind<>run.data_kind or not exists(select 1 from uptick_members m where m.id=new.member_id and m.data_kind=run.data_kind and m.market_id=run.market_id and m.state='active' and m.verified_at is not null and (m.data_kind<>'real' or m.age_confirmed_at is not null)) then
    raise exception 'Admission must match an active verified pilot member';
  end if;
  if (select count(*) from pilot_admissions where run_id=new.run_id)>=run.hard_cap then
    raise exception 'Pilot admission hard cap reached';
  end if;
  return new;
end;
$$;
create trigger validate_pilot_admission before insert on pilot_admissions for each row execute function validate_pilot_admission();
