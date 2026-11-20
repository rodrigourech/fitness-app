-- 0052_recipes_kitchen.sql
-- Recipes, cooking mode and kitchen (decision Rodrigo 19 November 2026, spec «Feature Rezepte, Kochmodus und Kitchen»).
--   recipe: own recipes in German (lang de); items and steps as JSON like food_entry.items, so a recipe syncs as one row
--     items: [{id, name, food_item_id, qty, unit (g|ml|piece|serving), hint {n, label}, to_taste, kcal, protein_g, source}]
--       values for the whole recipe at «portions»; hint is the grey count shown before the weight («1 Becher · 170 g»)
--     steps: [{text with {item id} placeholders, timer_s, items [item ids]}]
--   fridge_item: cooked portions without a day yet; kcal, protein_g and items per portion, frozen when cooked;
--     portions counts down when one is eaten; eat_by = cooked day + keeps_days of the recipe
--   inventory_item: stock (fridge, freezer, shelf); tracked = false means present yes/no only (oil, spices, sauces)
--   inventory_move: every change of a stock item (purchase, meal, recipe, used_up, discard, correction)
-- Deviation from the spec: items and steps live in the recipe row (JSON) instead of separate tables recipe_items and
-- recipe_steps, so a recipe is always saved and synced as a whole (same pattern as food_entry.items).
-- Same rules as all other tables (RLS with owner check, soft delete, sync guard); the Food connector may read and write
-- all four. Seed: the ten recipes from the Food chat for the app owner (fixed ids).
-- Run before the app with recipes is pushed; afterwards refresh the Data API schema cache. Idempotent.

begin;

create table if not exists public.recipe (
  id           uuid primary key,
  user_id      text not null default (auth.user_id()),
  name         text not null,
  lang         text not null default 'de',
  category     text not null check (category in ('meal', 'dessert', 'snack')),
  protein_type text check (protein_type in ('beef', 'chicken', 'pork', 'fish', 'veggie', 'mixed')),
  portions     numeric(4,1) not null check (portions > 0),
  prep_min     integer check (prep_min > 0),
  meal_prep    boolean not null default false,
  keeps_days   integer not null default 3 check (keeps_days between 1 and 30),
  notes        text,
  items        jsonb not null default '[]'::jsonb,
  steps        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  deleted_at   timestamptz,
  synced_at    timestamptz not null default now()
);

create table if not exists public.fridge_item (
  id          uuid primary key,
  user_id     text not null default (auth.user_id()),
  recipe_id   uuid,
  title       text not null,
  portions    numeric(4,1) not null check (portions >= 0),
  kcal        numeric(7,1) not null check (kcal >= 0),
  protein_g   numeric(6,1) not null check (protein_g >= 0),
  items       jsonb not null default '[]'::jsonb,
  cooked_at   timestamptz not null,
  eat_by      date not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

create table if not exists public.inventory_item (
  id            uuid primary key,
  user_id       text not null default (auth.user_id()),
  food_item_id  uuid,
  name          text not null,
  location      text not null default 'fridge' check (location in ('fridge', 'freezer', 'shelf')),
  unit          text check (unit in ('g', 'ml', 'piece')),
  qty_initial   numeric(8,1) check (qty_initial >= 0),
  qty_left      numeric(8,1) check (qty_left >= 0),
  tracked       boolean not null default true,
  best_before   date,
  opened_at     timestamptz,
  last_used_at  timestamptz,
  note          text,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  deleted_at    timestamptz,
  synced_at     timestamptz not null default now()
);

create table if not exists public.inventory_move (
  id             uuid primary key,
  user_id        text not null default (auth.user_id()),
  item_id        uuid not null,
  delta          numeric(8,1) not null,
  reason         text not null check (reason in ('purchase', 'meal', 'recipe', 'used_up', 'discard', 'correction')),
  food_entry_id  uuid,
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  deleted_at     timestamptz,
  synced_at      timestamptz not null default now()
);

grant select, insert, update on public.recipe, public.fridge_item, public.inventory_item, public.inventory_move to food_connector;
revoke delete, truncate on public.recipe, public.fridge_item, public.inventory_item, public.inventory_move from food_connector;

do $$
declare
  t text;
begin
  foreach t in array array['recipe', 'fridge_item', 'inventory_item', 'inventory_move'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.user_id()) and (select private.is_app_owner()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.user_id()) and (select private.is_app_owner()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.user_id()) and (select private.is_app_owner())) with check (user_id = (select auth.user_id()) and (select private.is_app_owner()))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_connector', t);
    execute format('create policy %I on public.%I for all to food_connector using (user_id in (select user_id from private.app_owner)) with check (user_id in (select user_id from private.app_owner))', t || '_connector', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sync_guard', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tg_sync_guard()', t || '_sync_guard', t);
    execute format('create index if not exists %I on public.%I (user_id, synced_at)', t || '_sync_idx', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

-- Seed: the ten recipes (values for the whole recipe; per portion = total / portions)
insert into public.recipe (id, user_id, name, category, protein_type, portions, prep_min, meal_prep, notes, items, steps, created_at, updated_at)
select v.id::uuid, o.user_id, v.name, v.category, v.protein_type, v.portions, v.prep_min, v.meal_prep, v.notes, v.items, v.steps, now(), now()
  from private.app_owner o
 cross join (values
  ('c5a0f6d2-0002-4f00-8000-000000000001', 'Türkische Pasta mit Skyr', 'meal', 'beef', 1, 25, false, null, '[{"id": "i1", "name": "Rindshack (Denner)", "food_item_id": "6dd50bc6-0741-43f3-8a4e-85518128a28c", "qty": 250, "unit": "g", "hint": null, "to_taste": false, "kcal": 515, "protein_g": 50.0, "source": "staple"}, {"id": "i2", "name": "Pasta, roh", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000007", "qty": 70, "unit": "g", "hint": null, "to_taste": false, "kcal": 249, "protein_g": 8.8, "source": "staple"}, {"id": "i3", "name": "Skyr Nature (Denner)", "food_item_id": "24f2e19e-3e0a-4e8b-a5bd-c9822b7f3fb9", "qty": 170, "unit": "g", "hint": {"n": 1, "label": "Becher"}, "to_taste": false, "kcal": 100, "protein_g": 18.7, "source": "staple"}, {"id": "i4", "name": "Zwiebel", "food_item_id": "c5a0f6d1-0001-4f00-8000-00000000000d", "qty": 60, "unit": "g", "hint": {"n": 1, "label": "kleine"}, "to_taste": false, "kcal": 24, "protein_g": 0.7, "source": "staple"}, {"id": "i5", "name": "Cherrytomaten", "food_item_id": null, "qty": 250, "unit": "g", "hint": null, "to_taste": false, "kcal": 45, "protein_g": 2, "source": "estimate"}, {"id": "i6", "name": "Knoblauch", "food_item_id": null, "qty": 8, "unit": "g", "hint": {"n": 1.5, "label": "Zehen"}, "to_taste": false, "kcal": 10, "protein_g": 0.5, "source": "estimate"}, {"id": "i7", "name": "Limette", "food_item_id": null, "qty": null, "unit": null, "hint": null, "to_taste": true, "kcal": 0, "protein_g": 0, "source": "estimate"}, {"id": "i8", "name": "Zwiebelpulver, Salz, Pfeffer", "food_item_id": null, "qty": null, "unit": null, "hint": null, "to_taste": true, "kcal": 0, "protein_g": 0, "source": "estimate"}]'::jsonb, '[{"text": "Pasta {i2} in gesalzenem Wasser kochen, etwas Pastawasser beiseitestellen.", "timer_s": 600, "items": ["i2"]}, {"text": "Hackfleisch {i1} mit Knoblauch, Zwiebelpulver, Salz und Pfeffer würzen.", "timer_s": null, "items": ["i1", "i6", "i8"]}, {"text": "Ohne Öl in heisser Pfanne scharf anbraten, dann herausnehmen.", "timer_s": 360, "items": ["i1"]}, {"text": "Zwiebel {i4} im Restfett anbraten.", "timer_s": null, "items": ["i4"]}, {"text": "In einer Bowl Skyr {i3} mit ½ Knoblauchzehe, Limette, Salz und Pfeffer mischen.", "timer_s": null, "items": ["i3", "i7"]}, {"text": "Gekochte Pasta in die Bowl geben, bei Bedarf mit Pastawasser die Konsistenz anpassen.", "timer_s": null, "items": ["i2"]}, {"text": "Hackfleisch zurück zu den Zwiebeln, kurz aufwärmen, in die Bowl geben.", "timer_s": null, "items": ["i1"]}, {"text": "Cherrytomaten {i5} vierteln und darübergeben, nochmals salzen, nach Wunsch Limette.", "timer_s": null, "items": ["i5", "i7"]}]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-000000000002', 'Ofen-Pouletschenkel mit Kartoffeln und Bohnen', 'meal', 'chicken', 3, 45, true, 'Reis ist die Variante für eine Portion, Kartoffeln für zwei.', '[{"id": "i1", "name": "Pouletoberschenkel gewürzt (Denner), essbar", "food_item_id": "89b6bc92-ddc8-4df6-9131-1289f715ed20", "qty": 825, "unit": "g", "hint": {"n": 1030, "label": "g mit Knochen"}, "to_taste": false, "kcal": 1361, "protein_g": 148.5, "source": "staple"}, {"id": "i2", "name": "Kartoffeln", "food_item_id": null, "qty": 450, "unit": "g", "hint": null, "to_taste": false, "kcal": 347, "protein_g": 9, "source": "estimate"}, {"id": "i3", "name": "Reis, roh", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000005", "qty": 50, "unit": "g", "hint": null, "to_taste": false, "kcal": 175, "protein_g": 3.5, "source": "staple"}, {"id": "i4", "name": "Grüne Bohnen, gefroren", "food_item_id": null, "qty": 600, "unit": "g", "hint": null, "to_taste": false, "kcal": 180, "protein_g": 12, "source": "estimate"}, {"id": "i5", "name": "Bouillon zum Dämpfen", "food_item_id": null, "qty": 400, "unit": "ml", "hint": null, "to_taste": false, "kcal": 0, "protein_g": 0, "source": "estimate"}]'::jsonb, '[{"text": "Kartoffeln {i2} würfeln, 10 min bei 200 Grad Umluft vorbacken.", "timer_s": 600, "items": ["i2"]}, {"text": "Schenkel {i1} ohne Öl dazu, zusammen 35 bis 40 min; Kartoffeln nach 20 min wenden. Fertig, wenn am Knochen klarer Saft austritt.", "timer_s": 2100, "items": ["i1"]}, {"text": "Reis {i3} mit der doppelten Menge Wasser kochen.", "timer_s": null, "items": ["i3"]}, {"text": "Bohnen {i4} mit Bouillon {i5} auf Steam rund 15 min garen, nach der Hälfte umrühren.", "timer_s": 900, "items": ["i4", "i5"]}, {"text": "Ausgetretenes Fett abschöpfen, Saft darunter nach Wunsch verwenden.", "timer_s": null, "items": []}, {"text": "Fleisch vom Knochen lösen und auf die Boxen verteilen.", "timer_s": null, "items": []}]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-000000000003', 'Schweinsgeschnetzeltes mit Reis und Broccoli', 'meal', 'pork', 3, null, true, 'Mengen für Sauce und Öl sind in der Summe enthalten.', '[{"id": "i1", "name": "Schweinsgeschnetzeltes (Coop)", "food_item_id": null, "qty": 594, "unit": "g", "hint": null, "to_taste": false, "kcal": 743, "protein_g": 133.7, "source": "estimate"}, {"id": "i2", "name": "Reis, roh", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000005", "qty": 210, "unit": "g", "hint": null, "to_taste": false, "kcal": 735, "protein_g": 14.7, "source": "staple"}, {"id": "i3", "name": "Broccoli", "food_item_id": null, "qty": 430, "unit": "g", "hint": null, "to_taste": false, "kcal": 146, "protein_g": 12, "source": "estimate"}, {"id": "i4", "name": "Zwiebel", "food_item_id": "c5a0f6d1-0001-4f00-8000-00000000000d", "qty": 100, "unit": "g", "hint": null, "to_taste": false, "kcal": 40, "protein_g": 1.2, "source": "staple"}, {"id": "i5", "name": "Sojasauce, Butter, Knoblauch, Sesamöl, Sonnenblumenöl", "food_item_id": null, "qty": null, "unit": null, "hint": null, "to_taste": false, "kcal": 88, "protein_g": 3.4, "source": "estimate"}]'::jsonb, '[]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-000000000004', 'Rindshack mit Reis und Bohnen', 'meal', 'beef', 1, 15, false, null, '[{"id": "i1", "name": "Rindshack (Migros)", "food_item_id": "b85e03d9-e0ea-4e75-a618-38283969e2e4", "qty": 200, "unit": "g", "hint": null, "to_taste": false, "kcal": 412, "protein_g": 40.0, "source": "staple"}, {"id": "i2", "name": "Reis, roh", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000005", "qty": 70, "unit": "g", "hint": null, "to_taste": false, "kcal": 245, "protein_g": 4.9, "source": "staple"}, {"id": "i3", "name": "Grüne Bohnen, gefroren", "food_item_id": null, "qty": 200, "unit": "g", "hint": null, "to_taste": false, "kcal": 60, "protein_g": 4, "source": "estimate"}]'::jsonb, '[{"text": "Reis {i2} kochen.", "timer_s": null, "items": ["i2"]}, {"text": "Hackfleisch {i1} ohne Öl anbraten.", "timer_s": null, "items": ["i1"]}, {"text": "Bohnen {i3} gefroren dazugeben oder separat 6 bis 8 min kochen.", "timer_s": 420, "items": ["i3"]}]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-000000000005', 'Rindshack mit Tomaten, Reis und Quark', 'meal', 'beef', 1, null, false, 'Menge Hackfleisch geschätzt.', '[{"id": "i1", "name": "Rindshack bio (Coop)", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000003", "qty": 200, "unit": "g", "hint": null, "to_taste": false, "kcal": 340, "protein_g": 40.0, "source": "staple"}, {"id": "i2", "name": "Tomaten", "food_item_id": null, "qty": 350, "unit": "g", "hint": null, "to_taste": false, "kcal": 69, "protein_g": 3.8, "source": "estimate"}, {"id": "i3", "name": "Reis, roh", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000005", "qty": 50, "unit": "g", "hint": null, "to_taste": false, "kcal": 175, "protein_g": 3.5, "source": "staple"}, {"id": "i4", "name": "Magerquark", "food_item_id": "894ae620-132b-48cf-bb0a-72340fbd2cae", "qty": 70, "unit": "g", "hint": null, "to_taste": false, "kcal": 43, "protein_g": 7.7, "source": "staple"}]'::jsonb, '[]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-000000000006', 'Chicken Tacos', 'meal', 'chicken', 3, null, false, null, '[{"id": "i1", "name": "Pouletgehacktes", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000004", "qty": 612, "unit": "g", "hint": null, "to_taste": false, "kcal": 704, "protein_g": 122.4, "source": "staple"}, {"id": "i2", "name": "Mini Tortillas", "food_item_id": "092ce3ee-b4d9-4f85-970c-cb5ab3847f36", "qty": 16, "unit": "piece", "hint": null, "to_taste": false, "kcal": 1312, "protein_g": 40.0, "source": "staple"}, {"id": "i3", "name": "Skyr", "food_item_id": "e6f6fe41-b64a-44b6-adf4-ac146f2b5a5d", "qty": 175, "unit": "g", "hint": null, "to_taste": false, "kcal": 102, "protein_g": 19.3, "source": "staple"}, {"id": "i4", "name": "Guacamole aus Avocado und 3 grossen Tomaten", "food_item_id": null, "qty": 330, "unit": "g", "hint": null, "to_taste": false, "kcal": 330, "protein_g": 6.6, "source": "estimate"}, {"id": "i5", "name": "Eingelegte rote Zwiebeln (Weissweinessig)", "food_item_id": null, "qty": 225, "unit": "g", "hint": null, "to_taste": false, "kcal": 10, "protein_g": 0.5, "source": "estimate"}, {"id": "i6", "name": "Sonnenblumenöl", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000009", "qty": 1.5, "unit": "piece", "hint": {"n": 1.5, "label": "TL"}, "to_taste": false, "kcal": 68, "protein_g": 0, "source": "staple"}]'::jsonb, '[{"text": "Hackfleisch {i1} mit Gewürzen in Öl {i6} anbraten.", "timer_s": null, "items": ["i1", "i6"]}, {"text": "Skyr {i3} mit Knoblauch, Limette und Salz zum Dip rühren.", "timer_s": null, "items": ["i3"]}, {"text": "Tortillas {i2} mit Guacamole {i4}, Hackfleisch, Zwiebeln {i5} und Skyr füllen.", "timer_s": null, "items": ["i2", "i4", "i5"]}]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-000000000007', 'Beef Tacos', 'meal', 'beef', 1, null, false, null, '[{"id": "i1", "name": "Mini Tortillas", "food_item_id": "092ce3ee-b4d9-4f85-970c-cb5ab3847f36", "qty": 3, "unit": "piece", "hint": null, "to_taste": false, "kcal": 246, "protein_g": 7.5, "source": "staple"}, {"id": "i2", "name": "Rindshack (Migros)", "food_item_id": "b85e03d9-e0ea-4e75-a618-38283969e2e4", "qty": 200, "unit": "g", "hint": null, "to_taste": false, "kcal": 412, "protein_g": 40.0, "source": "staple"}, {"id": "i3", "name": "Guacamole", "food_item_id": null, "qty": 100, "unit": "g", "hint": null, "to_taste": false, "kcal": 117, "protein_g": 1.8, "source": "estimate"}, {"id": "i4", "name": "Eingelegte Zwiebeln", "food_item_id": null, "qty": 50, "unit": "g", "hint": null, "to_taste": false, "kcal": 3, "protein_g": 0.1, "source": "estimate"}, {"id": "i5", "name": "Skyr", "food_item_id": "e6f6fe41-b64a-44b6-adf4-ac146f2b5a5d", "qty": 30, "unit": "g", "hint": null, "to_taste": false, "kcal": 17, "protein_g": 3.3, "source": "staple"}]'::jsonb, '[{"text": "Hackfleisch {i2} zuerst allein scharf anbraten, dann die Zwiebeln im Fett glasig braten.", "timer_s": null, "items": ["i2", "i4"]}, {"text": "Tortillas {i1} mit Guacamole {i3}, Hackfleisch, Zwiebeln und Skyr {i5} füllen.", "timer_s": null, "items": ["i1", "i3", "i5"]}]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-000000000008', 'Flammkuchen mit Speck', 'meal', 'pork', 1, null, false, null, '[{"id": "i1", "name": "Flammkuchenteig (Anna''s Best)", "food_item_id": null, "qty": 200, "unit": "g", "hint": null, "to_taste": false, "kcal": 567, "protein_g": 14, "source": "estimate"}, {"id": "i2", "name": "Speck (Migros)", "food_item_id": null, "qty": 60, "unit": "g", "hint": null, "to_taste": false, "kcal": 180, "protein_g": 9, "source": "estimate"}, {"id": "i3", "name": "Crème fraîche (Valflora)", "food_item_id": null, "qty": 55, "unit": "g", "hint": null, "to_taste": false, "kcal": 182, "protein_g": 1.4, "source": "estimate"}, {"id": "i4", "name": "Zwiebel", "food_item_id": "c5a0f6d1-0001-4f00-8000-00000000000d", "qty": 100, "unit": "g", "hint": null, "to_taste": false, "kcal": 40, "protein_g": 1.2, "source": "staple"}]'::jsonb, '[]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-000000000009', 'Skyr-Protein-Bowl', 'snack', null, 1, 5, false, null, '[{"id": "i1", "name": "Skyr", "food_item_id": "e6f6fe41-b64a-44b6-adf4-ac146f2b5a5d", "qty": 200, "unit": "g", "hint": null, "to_taste": false, "kcal": 116, "protein_g": 22.0, "source": "staple"}, {"id": "i2", "name": "ESN Whey", "food_item_id": "c5a0f6d1-0001-4f00-8000-00000000000a", "qty": 1, "unit": "serving", "hint": {"n": 1.5, "label": "Scoops"}, "to_taste": false, "kcal": 167, "protein_g": 34.5, "source": "staple"}, {"id": "i3", "name": "Wasser", "food_item_id": null, "qty": null, "unit": null, "hint": null, "to_taste": true, "kcal": 0, "protein_g": 0, "source": "estimate"}]'::jsonb, '[{"text": "Skyr {i1} und Whey {i2} mit etwas Wasser glatt rühren.", "timer_s": null, "items": ["i1", "i2", "i3"]}]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-00000000000a', 'Toast mit Tomate', 'snack', null, 1, 5, false, null, '[{"id": "i1", "name": "Toast hell (Denner)", "food_item_id": null, "qty": 31, "unit": "g", "hint": {"n": 1, "label": "Scheibe"}, "to_taste": false, "kcal": 89, "protein_g": 2.7, "source": "label"}, {"id": "i2", "name": "Roma-Tomate", "food_item_id": null, "qty": 100, "unit": "g", "hint": null, "to_taste": false, "kcal": 20, "protein_g": 1, "source": "estimate"}]'::jsonb, '[]'::jsonb)
 ) v(id, name, category, protein_type, portions, prep_min, meal_prep, notes, items, steps)
on conflict (id) do nothing;

commit;

-- Check
select 'ROW ' || (select count(*) from public.recipe where deleted_at is null) || ' recipes, '
  || (select string_agg(table_name || ': ' || privilege_type, ', ' order by table_name, privilege_type)
        from information_schema.role_table_grants
       where grantee = 'food_connector' and table_name in ('recipe', 'fridge_item', 'inventory_item', 'inventory_move'));
