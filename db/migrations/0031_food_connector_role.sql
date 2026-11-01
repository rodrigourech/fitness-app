-- 0031_food_connector_role.sql
-- Database role for the Food connector (Neon Function foodmcp, decision 1 November 2026). The role may only read and
-- write food_item and food_entry of the app owner: no other table, no delete (soft delete via deleted_at), no DDL.
-- The role is created without login; the password is set once by hand in the SQL editor and never committed:
--   alter role food_connector with login password '<random 32+ characters>';
-- Then FOOD_DATABASE_URL = postgresql://food_connector:<password>@<pooled host>/neondb?sslmode=require (see docs/food-connector.md).
-- Idempotent.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'food_connector') then
    create role food_connector nologin;
  end if;
end $$;

grant usage on schema public to food_connector;
grant usage on schema private to food_connector;
grant select on private.app_owner to food_connector;
grant select, insert, update on public.food_item, public.food_entry to food_connector;
revoke delete, truncate on public.food_item, public.food_entry from food_connector;

do $$
declare
  t text;
begin
  foreach t in array array['food_item', 'food_entry'] loop
    execute format('drop policy if exists %I on public.%I', t || '_connector', t);
    execute format('create policy %I on public.%I for all to food_connector using (user_id in (select user_id from private.app_owner)) with check (user_id in (select user_id from private.app_owner))', t || '_connector', t);
  end loop;
end $$;

commit;

select 'ROW ' || string_agg(table_name || ': ' || privilege_type, ', ' order by table_name, privilege_type)
  from information_schema.role_table_grants where grantee = 'food_connector';
