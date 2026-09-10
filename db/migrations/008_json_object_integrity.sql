-- Both database drivers accept native object parameters. In particular, postgres.js
-- serializes jsonb itself; pre-stringifying would store a string and bypass pass limits.
alter table claims add constraint claim_snapshot_is_object check(jsonb_typeof(snapshot)='object');
alter table audit_events add constraint audit_detail_is_object check(jsonb_typeof(detail)='object');
alter table internal_test_runs add constraint internal_test_snapshot_is_object check(jsonb_typeof(snapshot)='object');
