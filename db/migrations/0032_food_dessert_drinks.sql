-- 0032_food_dessert_drinks.sql
-- Nutrition (decisions 1 November 2026, evening): two more categories, dessert and drinks (beer or alcohol on a night
-- out), plus four drink staples as rough guides per serving. Meal prep needs no schema change: every portion is its
-- own food_entry on the day it is eaten (portions_cooked and portions_eaten = 1).
-- Run before the app with the new categories is pushed; otherwise the sync of such entries is rejected.
-- No new columns, so no schema cache refresh is needed. Idempotent.

begin;

alter table public.food_entry drop constraint if exists food_entry_category_check;
alter table public.food_entry add constraint food_entry_category_check
  check (category in ('breakfast', 'lunch', 'dinner', 'snack', 'cheat', 'dessert', 'drinks'));

insert into public.food_item (id, user_id, name, store, basis, kcal, protein_g, piece_g, package_g, note, created_at, updated_at)
select v.id::uuid, o.user_id, v.name, null, 'serving', v.kcal, v.protein, v.piece, null, 'Richtwert', now(), now()
  from private.app_owner o
 cross join (values
  ('c5a0f6d1-0001-4f00-8000-00000000000f', 'Beer 5 dl', 210, 2.5, 500::numeric),
  ('c5a0f6d1-0001-4f00-8000-000000000010', 'Beer alcohol-free 5 dl', 110, 2, 500),
  ('c5a0f6d1-0001-4f00-8000-000000000011', 'Wine 1 dl', 85, 0, 100),
  ('c5a0f6d1-0001-4f00-8000-000000000012', 'Long drink', 180, 0, 300)
 ) v(id, name, kcal, protein, piece)
on conflict (id) do nothing;

commit;

select 'ROW ' || (select pg_get_constraintdef(oid) from pg_constraint where conname = 'food_entry_category_check')
  || ' | ' || (select count(*) from public.food_item where deleted_at is null) || ' staples';
