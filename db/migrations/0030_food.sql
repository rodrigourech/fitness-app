-- 0030_food.sql
-- Nutrition (decisions 1 November 2026): staples with fixed values and food entries (only kcal and protein).
--   food_item: a staple, values per basis: per 100 g, per piece or per serving (piece_g / package_g optional)
--   food_entry: one meal or snack; items keeps the ingredients with amount and values (JSON, read-only for the app),
--     kcal and protein_g are the totals of the eaten portion; source app or claude (Food connector)
-- Same rules as all other tables (RLS, owner check, soft delete, sync guard). Starter staples with fixed ids for the
-- app owner; values are rough guides and can be replaced from a label photo. Idempotent.
-- After running: neon data-api refresh-schema --database neondb (before the app with the Food tab is pushed)

begin;

create table if not exists public.food_item (
  id          uuid primary key,
  user_id     text not null default (auth.user_id()),
  name        text not null,
  store       text,
  basis       text not null check (basis in ('100g', 'piece', 'serving')),
  kcal        numeric(7,1) not null check (kcal >= 0),
  protein_g   numeric(6,1) not null check (protein_g >= 0),
  piece_g     numeric(7,1) check (piece_g > 0),
  package_g   numeric(7,1) check (package_g > 0),
  note        text,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

create table if not exists public.food_entry (
  id              uuid primary key,
  user_id         text not null default (auth.user_id()),
  eaten_at        timestamptz not null,
  category        text not null check (category in ('breakfast', 'lunch', 'dinner', 'snack', 'cheat')),
  title           text not null,
  detail          text,
  items           jsonb not null default '[]'::jsonb,
  kcal            numeric(7,1) not null check (kcal >= 0),
  protein_g       numeric(6,1) not null check (protein_g >= 0),
  portions_cooked numeric(4,1) check (portions_cooked > 0),
  portions_eaten  numeric(4,1) check (portions_eaten > 0),
  source          text not null default 'app' check (source in ('app', 'claude')),
  created_at      timestamptz not null,
  updated_at      timestamptz not null,
  deleted_at      timestamptz,
  synced_at       timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['food_item', 'food_entry'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.user_id()) and (select private.is_app_owner()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.user_id()) and (select private.is_app_owner()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.user_id()) and (select private.is_app_owner())) with check (user_id = (select auth.user_id()) and (select private.is_app_owner()))', t || '_update', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sync_guard', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tg_sync_guard()', t || '_sync_guard', t);
    execute format('create index if not exists %I on public.%I (user_id, synced_at)', t || '_sync_idx', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

create index if not exists food_entry_eaten_idx on public.food_entry (user_id, eaten_at);

-- Starter staples (rough guides per basis; ESN per serving of 1.5 scoops = 45 g)
insert into public.food_item (id, user_id, name, store, basis, kcal, protein_g, piece_g, package_g, note, created_at, updated_at)
select v.id::uuid, o.user_id, v.name, v.store, v.basis, v.kcal, v.protein, v.piece, v.package, 'Richtwert', now(), now()
  from private.app_owner o
 cross join (values
  ('c5a0f6d1-0001-4f00-8000-000000000001', 'Chicken breast', null, '100g', 106, 23.5, null::numeric, null::numeric),
  ('c5a0f6d1-0001-4f00-8000-000000000002', 'Chicken thigh, skinless', null, '100g', 120, 19, null, null),
  ('c5a0f6d1-0001-4f00-8000-000000000003', 'Beef mince bio 10 %', 'Coop', '100g', 170, 20, null, 250),
  ('c5a0f6d1-0001-4f00-8000-000000000004', 'Chicken mince', null, '100g', 115, 20, null, null),
  ('c5a0f6d1-0001-4f00-8000-000000000005', 'Rice, raw', null, '100g', 350, 7, null, null),
  ('c5a0f6d1-0001-4f00-8000-000000000006', 'Sweet potato, raw', null, '100g', 86, 1.6, null, null),
  ('c5a0f6d1-0001-4f00-8000-000000000007', 'Pasta, raw', null, '100g', 355, 12.5, null, null),
  ('c5a0f6d1-0001-4f00-8000-000000000008', 'Egg', null, 'piece', 84, 7.5, 60, null),
  ('c5a0f6d1-0001-4f00-8000-000000000009', 'Sunflower oil, 1 tsp', null, 'piece', 45, 0, 5, null),
  ('c5a0f6d1-0001-4f00-8000-00000000000a', 'ESN shake, water', 'ESN', 'serving', 167, 34.5, 45, null),
  ('c5a0f6d1-0001-4f00-8000-00000000000b', 'ESN shake, milk 300 ml', 'ESN', 'serving', 338, 44.5, 345, null),
  ('c5a0f6d1-0001-4f00-8000-00000000000c', 'Skyr natural', null, '100g', 63, 11, null, null),
  ('c5a0f6d1-0001-4f00-8000-00000000000d', 'Onion', null, '100g', 40, 1.2, null, null),
  ('c5a0f6d1-0001-4f00-8000-00000000000e', 'Cola Zero', null, '100g', 0, 0, null, null)
 ) v(id, name, store, basis, kcal, protein, piece, package)
on conflict (id) do nothing;

commit;

select 'ROW ' || (select count(*) from public.food_item where deleted_at is null) || ' staples, '
  || (select count(*) from public.food_entry) || ' entries';
