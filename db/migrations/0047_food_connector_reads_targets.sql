-- 0047_food_connector_reads_targets.sql
-- 15 November 2026 (decision Rodrigo, protein minimum 160 g): the Food connector shows «Ziel ≥ N g» from the app's
-- nutrition targets instead of a fixed 140 g. The role food_connector may read (only read) the app owner's row
-- nutrition_targets in user_setting. Without this grant the connector falls back to 160 g. Idempotent.

begin;

grant select on public.user_setting to food_connector;
drop policy if exists user_setting_connector on public.user_setting;
create policy user_setting_connector on public.user_setting for select to food_connector
  using (key = 'nutrition_targets' and user_id in (select user_id from private.app_owner));

commit;

select 'ROW ' || string_agg(table_name || ': ' || privilege_type, ', ' order by table_name, privilege_type)
  from information_schema.role_table_grants where grantee = 'food_connector';
