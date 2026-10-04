-- 0002_app_owner.sql
-- Restrict all data access to the app owner.
-- Reason: Neon Auth currently allows anyone to sign up (restricted sign-ups not yet available).
-- Prerequisite: user rodrigo@fitness-app.local exists in Neon Auth.

begin;

-- Owner list in a schema that the Data API does not expose
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table private.app_owner (
  user_id text primary key
);
revoke all on private.app_owner from public, authenticated;

-- true if the requesting user is an app owner
create or replace function private.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.app_owner o where o.user_id = auth.user_id()
  )
$$;
revoke all on function private.is_app_owner() from public;
grant execute on function private.is_app_owner() to authenticated;

-- Register the owner (fails and rolls back if the user does not exist exactly once)
insert into private.app_owner (user_id)
select u.id::text
from neon_auth."user" u
where u.email = 'rodrigo@fitness-app.local';

do $$
begin
  if (select count(*) from private.app_owner) <> 1 then
    raise exception 'Expected exactly one owner, found %', (select count(*) from private.app_owner);
  end if;
end
$$;

-- Replace policies: own rows AND app owner
do $$
declare
  t text;
begin
  foreach t in array array[
    'exercise', 'exercise_link', 'template', 'template_exercise', 'template_set',
    'workout', 'workout_exercise', 'workout_set', 'body_weight'
  ] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format('drop policy %I on public.%I', t || '_insert', t);
    execute format('drop policy %I on public.%I', t || '_update', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.user_id()) and (select private.is_app_owner()))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.user_id()) and (select private.is_app_owner()))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.user_id()) and (select private.is_app_owner())) with check (user_id = (select auth.user_id()) and (select private.is_app_owner()))',
      t || '_update', t);
  end loop;
end
$$;

drop policy exercise_catalog_read on public.exercise_catalog;
create policy exercise_catalog_read on public.exercise_catalog
  for select to authenticated using ((select private.is_app_owner()));

commit;
