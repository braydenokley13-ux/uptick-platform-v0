-- Reconcile sender-level STOP history into the program-wide suppression table.
--
-- Migration 011 recorded opt-outs per sender in member_suppressions. Migration
-- 014 introduced member_global_suppressions so that replacing a sender cannot
-- evade a member's STOP, but it did not copy the existing sender-level history.
-- A member who sent STOP before 014 therefore kept protection only while the
-- original sender was in use: after a sender rotation the per-sender lookup
-- misses and the member could be messaged again.
--
-- This migration is forward-only and idempotent. It never overwrites a newer
-- global record, and it never rewrites migration 014.
--
-- Conservative handling of ambiguity:
--   * Only the latest sender-level row per phone is considered.
--   * If several senders share that same latest timestamp and disagree, STOP
--     wins -- an opt-out is never discarded because ordering was ambiguous.
--   * Phones that do not match the strict global format are left alone and
--     reported, because the global table cannot represent them.

do $$
declare
  skipped integer;
begin

  with ranked as (
    select
      s.phone,
      s.suppressed,
      s.sender_id,
      s.updated_at,
      -- STOP wins within an identical timestamp, hence the suppressed ordering.
      row_number() over (
        partition by s.phone
        order by s.updated_at desc, s.suppressed desc, s.sender_id
      ) rn
    from member_suppressions s
    where s.phone ~ '^\+1[0-9]{10}$'
  ),
  latest as (
    select phone, suppressed, sender_id, updated_at from ranked where rn = 1
  )
  insert into member_global_suppressions(phone, suppressed, source_sender_id, updated_at)
  select l.phone, l.suppressed, l.sender_id, l.updated_at
  from latest l
  on conflict (phone) do update
    set suppressed = excluded.suppressed,
        source_sender_id = excluded.source_sender_id,
        updated_at = excluded.updated_at
    -- Only fill a gap left by 014. A global record that is already at least as
    -- recent as the sender-level history is the trustworthy one and stands.
    where member_global_suppressions.updated_at < excluded.updated_at;

  select count(*) into skipped
  from member_suppressions
  where phone !~ '^\+1[0-9]{10}$';

  if skipped > 0 then
    raise warning
      'Suppression reconciliation skipped % sender-level row(s) whose phone is not in +1XXXXXXXXXX form. Review these manually before relying on program-wide suppression.',
      skipped;
  end if;

end $$;
