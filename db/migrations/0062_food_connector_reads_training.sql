-- 0062_food_connector_reads_training.sql
-- 23 November 2026 (request Rodrigo): the Food connector may read training, templates, exercises and body weight so that
-- Claude can analyse progression, volume and the weight trend in the coaching chat. Read only: the role food_connector
-- gets SELECT and nothing else on these tables; every policy allows only the app owner's rows that are not deleted.
-- user_setting: besides nutrition_targets (0047, holds creatine since 23 November 2026) also goal_weight,
-- training_shares and weekly_goal.
-- No schema change, no refresh-schema needed. Idempotent.

begin;

do $$
declare
  t text;
begin
  foreach t in array array['exercise', 'template', 'template_exercise', 'template_set', 'workout', 'workout_exercise', 'workout_set', 'body_weight'] loop
    execute format('grant select on public.%I to food_connector', t);
    execute format('revoke insert, update, delete, truncate on public.%I from food_connector', t);
    execute format('drop policy if exists %I on public.%I', t || '_connector_read', t);
    execute format('create policy %I on public.%I for select to food_connector using (deleted_at is null and user_id in (select user_id from private.app_owner))', t || '_connector_read', t);
  end loop;
end $$;

grant select on public.user_setting to food_connector;
revoke insert, update, delete, truncate on public.user_setting from food_connector;
drop policy if exists user_setting_connector on public.user_setting;
create policy user_setting_connector on public.user_setting for select to food_connector
  using (deleted_at is null and key in ('nutrition_targets', 'goal_weight', 'training_shares', 'weekly_goal')
    and user_id in (select user_id from private.app_owner));

commit;

select 'ROW ' || string_agg(table_name || ': ' || privilege_type, ', ' order by table_name, privilege_type)
  from information_schema.role_table_grants where grantee = 'food_connector';
