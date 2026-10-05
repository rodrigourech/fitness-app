-- 0009_user_setting.sql
-- Settings that follow the user across devices, e.g. the weekly goal (Stats tab).
-- One row per setting key; the app uses a fixed id per key, so two devices write the same row
-- (last write wins via tg_sync_guard). value is JSON, e.g. {"strength": 2, "run": 0}.
-- After running: neon data-api refresh-schema --database neondb

begin;

create table public.user_setting (
  id         uuid primary key,
  user_id    text not null default (auth.user_id()),
  key        text not null,
  value      jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at  timestamptz not null default now(),
  unique (user_id, key)
);

alter table public.user_setting enable row level security;

-- Same rules as all other tables: own rows and app owner, no delete (soft delete)
create policy user_setting_select on public.user_setting for select to authenticated
  using (user_id = (select auth.user_id()) and (select private.is_app_owner()));
create policy user_setting_insert on public.user_setting for insert to authenticated
  with check (user_id = (select auth.user_id()) and (select private.is_app_owner()));
create policy user_setting_update on public.user_setting for update to authenticated
  using (user_id = (select auth.user_id()) and (select private.is_app_owner()))
  with check (user_id = (select auth.user_id()) and (select private.is_app_owner()));

create trigger user_setting_sync_guard before insert or update on public.user_setting
  for each row execute function public.tg_sync_guard();

create index user_setting_sync_idx on public.user_setting (user_id, synced_at);

grant select, insert, update on public.user_setting to authenticated;

commit;
