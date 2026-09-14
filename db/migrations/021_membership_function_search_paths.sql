-- Keep membership trigger resolution independent of the caller's search path.
-- Forward fix: migration 014 is already applied to the hosted project.
alter function public.default_member_consent_action()
  set search_path = public, pg_temp;
alter function public.protect_member_support_context()
  set search_path = public, pg_temp;
