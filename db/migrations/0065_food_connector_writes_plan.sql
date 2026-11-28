-- 0065_food_connector_writes_plan.sql
-- 27 November 2026 (Änderungsauftrag Rodrigo «Fitness-Connector darf Vorlagen und Übungen ändern»): plan changes from the
-- coaching chat go through the Food connector (preview, «ja», confirm; functions/plan.ts, version 1.5.0).
--   template, template_exercise, template_set, exercise, exercise_link: SELECT, INSERT and UPDATE for food_connector,
--     never DELETE or TRUNCATE. Removing means deleted_at, archiving archived_at, as in the app.
--   The read policy of these five tables no longer filters deleted_at: Postgres checks the new row of an UPDATE against
--     the SELECT policy too, so setting deleted_at would fail. The connector filters deleted rows itself (loadTraining).
--   insert and update only for rows of the app owner (with check), so no row can be moved to another user.
--   workout, workout_exercise, workout_set, body_weight and user_setting stay read only (0062); checked below.
-- No schema change, no refresh-schema needed. Idempotent.

begin;

do $$
declare
  t text;
  owner_rows constant text := 'user_id in (select user_id from private.app_owner)';
begin
  foreach t in array array['template', 'template_exercise', 'template_set', 'exercise', 'exercise_link'] loop
    execute format('grant select, insert, update on public.%I to food_connector', t);
    execute format('revoke delete, truncate on public.%I from food_connector', t);
    execute format('drop policy if exists %I on public.%I', t || '_connector_read', t);
    execute format('create policy %I on public.%I for select to food_connector using (%s)', t || '_connector_read', t, owner_rows);
    execute format('drop policy if exists %I on public.%I', t || '_connector_insert', t);
    execute format('create policy %I on public.%I for insert to food_connector with check (%s)', t || '_connector_insert', t, owner_rows);
    execute format('drop policy if exists %I on public.%I', t || '_connector_update', t);
    execute format('create policy %I on public.%I for update to food_connector using (%s) with check (%s)', t || '_connector_update', t, owner_rows, owner_rows);
  end loop;
  -- Training log, body weight and settings: read only, as before
  foreach t in array array['workout', 'workout_exercise', 'workout_set', 'body_weight', 'user_setting'] loop
    execute format('revoke insert, update, delete, truncate on public.%I from food_connector', t);
  end loop;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['template', 'template_exercise', 'template_set', 'exercise', 'exercise_link'] loop
    if not (has_table_privilege('food_connector', 'public.' || t, 'SELECT') and has_table_privilege('food_connector', 'public.' || t, 'INSERT')
            and has_table_privilege('food_connector', 'public.' || t, 'UPDATE'))
       or has_table_privilege('food_connector', 'public.' || t, 'DELETE') or has_table_privilege('food_connector', 'public.' || t, 'TRUNCATE') then
      raise exception 'Rights on % not as planned', t;
    end if;
  end loop;
  foreach t in array array['workout', 'workout_exercise', 'workout_set', 'body_weight', 'user_setting'] loop
    if has_table_privilege('food_connector', 'public.' || t, 'INSERT') or has_table_privilege('food_connector', 'public.' || t, 'UPDATE')
       or has_table_privilege('food_connector', 'public.' || t, 'DELETE') or has_table_privilege('food_connector', 'public.' || t, 'TRUNCATE') then
      raise exception '% must stay read only', t;
    end if;
  end loop;
end $$;

commit;

-- Check: write rights per table and the connector policies of the plan tables
select string_agg(table_name || ': ' || privileges, '; ' order by table_name) as rights
  from (select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
          from information_schema.role_table_grants where grantee = 'food_connector' and table_schema = 'public' group by table_name) g;
select string_agg(tablename || '.' || policyname || ' ' || cmd, ', ' order by tablename, policyname) as policies
  from pg_policies where 'food_connector' = any(roles) and tablename in ('template', 'template_exercise', 'template_set', 'exercise', 'exercise_link');
