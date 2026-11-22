-- 0053_food_photos_burger.sql
-- Photos for recipes and products (decision Rodrigo 22 November 2026) and the recipe «Burger mit Ofenkartoffeln».
--   food_photo: one row per photo of a recipe (kind dish, several per recipe, one is the cover) or of a product in the
--     staples (kind pack = front of the package, label = nutrition table). Exactly one of recipe_id and food_item_id.
--     The image itself lies unencrypted in the existing private bucket (key <user_id>/<id>), uploaded through the auth
--     proxy like the progress photos; food photos are not sensitive, so no passphrase. purged_at as in body_photo.
-- Same rules as all other tables (RLS with owner check, soft delete, sync guard). The Food connector has no access.
-- Seed: «Burger mit Ofenkartoffeln» for the app owner (fixed id), amounts from the entry of 21 November 2026 (two
-- patties from 250 g, 1041 kcal, 76 g protein), steps from the recipe of the Fitness Coaching chat.
-- Run before the app with food photos is pushed; afterwards refresh the Data API schema cache. Idempotent.

begin;

create table if not exists public.food_photo (
  id            uuid primary key,
  user_id       text not null default (auth.user_id()),
  recipe_id     uuid,
  food_item_id  uuid,
  kind          text not null check (kind in ('dish', 'pack', 'label')),
  is_cover      boolean not null default false,
  taken_on      date,
  mime          text not null default 'image/jpeg',
  width         integer,
  height        integer,
  bytes         integer,
  purged_at     timestamptz,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  deleted_at    timestamptz,
  synced_at     timestamptz not null default now(),
  constraint food_photo_one_owner check (num_nonnulls(recipe_id, food_item_id) = 1)
);

alter table public.food_photo enable row level security;
drop policy if exists food_photo_select on public.food_photo;
drop policy if exists food_photo_insert on public.food_photo;
drop policy if exists food_photo_update on public.food_photo;
create policy food_photo_select on public.food_photo for select to authenticated
  using (user_id = (select auth.user_id()) and (select private.is_app_owner()));
create policy food_photo_insert on public.food_photo for insert to authenticated
  with check (user_id = (select auth.user_id()) and (select private.is_app_owner()));
create policy food_photo_update on public.food_photo for update to authenticated
  using (user_id = (select auth.user_id()) and (select private.is_app_owner()))
  with check (user_id = (select auth.user_id()) and (select private.is_app_owner()));
drop trigger if exists food_photo_sync_guard on public.food_photo;
create trigger food_photo_sync_guard before insert or update on public.food_photo
  for each row execute function public.tg_sync_guard();
create index if not exists food_photo_sync_idx on public.food_photo (user_id, synced_at);
grant select, insert, update on public.food_photo to authenticated;

insert into public.recipe (id, user_id, name, category, protein_type, portions, prep_min, meal_prep, notes, items, steps, created_at, updated_at)
select 'c5a0f6d2-0002-4f00-8000-00000000000b'::uuid, o.user_id, 'Burger mit Ofenkartoffeln', 'meal', 'beef', 1, 40, false,
  'Mengen wie am 21. November 2026 gegessen: zwei Patties aus 250 g Hackfleisch.',
  '[{"id": "i1", "name": "Kartoffeln Primagusto", "food_item_id": null, "qty": 200, "unit": "g", "hint": null, "to_taste": false, "kcal": 154, "protein_g": 4, "source": "estimate"},
    {"id": "i2", "name": "Paprikapulver, Salz, Pfeffer", "food_item_id": null, "qty": null, "unit": null, "hint": null, "to_taste": true, "kcal": 0, "protein_g": 0, "source": "estimate"},
    {"id": "i3", "name": "Rindshack bio 10 % (Coop)", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000003", "qty": 250, "unit": "g", "hint": {"n": 2, "label": "Patties"}, "to_taste": false, "kcal": 425, "protein_g": 50.0, "source": "staple"},
    {"id": "i4", "name": "Hamburger Buns Sesam (Prix Garantie)", "food_item_id": "a3e2b00c-d943-4e4b-bc8f-7ec1e4acec70", "qty": 100, "unit": "g", "hint": {"n": 2, "label": "Buns"}, "to_taste": false, "kcal": 302, "protein_g": 9.0, "source": "staple"},
    {"id": "i5", "name": "Halbfettkäse (Prix Garantie)", "food_item_id": "2cce3e3f-8512-4061-a784-1dbaddba4955", "qty": 30, "unit": "g", "hint": null, "to_taste": false, "kcal": 72.3, "protein_g": 9.3, "source": "staple"},
    {"id": "i6", "name": "Skyr Nature lactosefrei (Coop)", "food_item_id": "e6f6fe41-b64a-44b6-adf4-ac146f2b5a5d", "qty": 10, "unit": "g", "hint": null, "to_taste": false, "kcal": 5.8, "protein_g": 1.1, "source": "staple"},
    {"id": "i7", "name": "Thomy Bio Senf mild", "food_item_id": null, "qty": 10, "unit": "g", "hint": null, "to_taste": false, "kcal": 10, "protein_g": 0.6, "source": "estimate"},
    {"id": "i8", "name": "Ketchup", "food_item_id": null, "qty": 30, "unit": "g", "hint": null, "to_taste": false, "kcal": 30, "protein_g": 0.3, "source": "estimate"},
    {"id": "i9", "name": "Baby Salat", "food_item_id": null, "qty": 30, "unit": "g", "hint": null, "to_taste": false, "kcal": 5, "protein_g": 0.5, "source": "estimate"},
    {"id": "i10", "name": "Tomate Peretti", "food_item_id": null, "qty": 140, "unit": "g", "hint": null, "to_taste": false, "kcal": 25, "protein_g": 1.2, "source": "estimate"},
    {"id": "i11", "name": "Zwiebel", "food_item_id": "c5a0f6d1-0001-4f00-8000-00000000000d", "qty": 30, "unit": "g", "hint": null, "to_taste": false, "kcal": 12, "protein_g": 0.4, "source": "staple"}]'::jsonb,
  '[{"text": "Backofen auf 220 Grad Umluft vorheizen, Blech mit Backpapier belegen.", "timer_s": null, "items": []},
    {"text": "Kartoffeln {i1} mit Schale in Scheiben schneiden, mit Paprikapulver und Salz mischen und flach aufs Blech legen.", "timer_s": null, "items": ["i1", "i2"]},
    {"text": "Kartoffeln backen.", "timer_s": 900, "items": ["i1"]},
    {"text": "Inzwischen Hackfleisch {i3} zu zwei Patties formen, etwa 2 cm dick, mit einer kleinen Mulde in der Mitte. Skyr {i6}, Senf {i7} und Ketchup {i8} zur Sauce rühren. Salat {i9} waschen, Tomate {i10} und Zwiebel {i11} schneiden, Käse {i5} bereitlegen.", "timer_s": null, "items": ["i3", "i5", "i6", "i7", "i8", "i9", "i10", "i11"]},
    {"text": "Kartoffeln wenden und fertig backen, bis sie goldbraun sind.", "timer_s": 1080, "items": ["i1"]},
    {"text": "Etwa 8 Minuten vor Ende eine beschichtete Pfanne ohne Öl stark erhitzen. Patties salzen, pfeffern und braten, nicht drücken.", "timer_s": 210, "items": ["i3", "i2"]},
    {"text": "Patties wenden und sofort Käse {i5} darauflegen. Buns {i4} aufgeschnitten für die letzten Minuten in den Ofen legen.", "timer_s": 210, "items": ["i4", "i5"]},
    {"text": "Untere Bun-Hälften mit der Sauce bestreichen, Salat, Patty mit Käse, Tomate und Zwiebel darauf, Deckel drauf. Mit den Kartoffeln servieren.", "timer_s": null, "items": ["i4"]}]'::jsonb,
  now(), now()
  from private.app_owner o
on conflict (id) do nothing;

commit;
