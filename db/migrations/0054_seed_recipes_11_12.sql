-- 0054_seed_recipes_11_12.sql
-- Data only (Auftrag Rodrigo 22 November 2026, «Rezept-Werkzeuge im Food-Connector»): the two staples that stood in
-- for recipes become recipes, the staples are removed afterwards.
--   11 Crispy Chicken Bowl (Airfryer): from the Food Tracking chat (seed block 11), 1 portion, about 690 kcal and 77 g
--      protein; Skyr is the lactose-free Coop staple Rodrigo buys
--   12 Rührei mit Cottage Cheese und Knäckebrot (corrected seed 12): 3 eggs, cottage cheese 200 g, crispbread 33 g,
--      tomatoes 115 g; 552 kcal and 45 g protein per portion; without the drink
-- The staples «Crispy Chicken Bowl (Airfryer)» and «Rührei mit Cottage Cheese und Knäckebrot (ohne Drink)» are moved to
-- the trash (logged meals keep their values). Fixed ids, idempotent. Run with the owner role; then refresh nothing
-- (no schema change).

begin;

insert into public.recipe (id, user_id, name, category, protein_type, portions, prep_min, meal_prep, notes, items, steps, created_at, updated_at)
select v.id::uuid, o.user_id, v.name, 'meal', v.protein_type, 1, v.prep_min, false, v.notes, v.items, v.steps, now(), now()
from private.app_owner o
cross join (values
  ('c5a0f6d2-0002-4f00-8000-00000000000c', 'Crispy Chicken Bowl (Airfryer)', 'chicken', 30, 'Statt Airfryer geht auch der Ofen bei 200 Grad Umluft, das Poulet braucht dann 20 bis 25 Minuten.',
    '[{"id": "i1", "name": "Pouletbrust roh", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000001", "qty": 220, "unit": "g", "hint": null, "to_taste": false, "kcal": 233, "protein_g": 51.7, "source": "staple"}, {"id": "i2", "name": "Paniermehl", "food_item_id": null, "qty": 15, "unit": "g", "hint": {"n": 2, "label": "EL"}, "to_taste": false, "kcal": 55, "protein_g": 2, "source": "estimate"}, {"id": "i3", "name": "Parmesan gerieben", "food_item_id": null, "qty": 15, "unit": "g", "hint": null, "to_taste": false, "kcal": 60, "protein_g": 5, "source": "estimate"}, {"id": "i4", "name": "Olivenöl (Poulet)", "food_item_id": null, "qty": 5, "unit": "g", "hint": {"n": 1, "label": "TL"}, "to_taste": false, "kcal": 45, "protein_g": 0, "source": "estimate"}, {"id": "i5", "name": "Olivenöl (Kichererbsen)", "food_item_id": null, "qty": 2.5, "unit": "g", "hint": {"n": 0.5, "label": "TL"}, "to_taste": false, "kcal": 22, "protein_g": 0, "source": "estimate"}, {"id": "i6", "name": "Kichererbsen aus der Dose, abgetropft", "food_item_id": null, "qty": 60, "unit": "g", "hint": null, "to_taste": false, "kcal": 80, "protein_g": 4, "source": "estimate"}, {"id": "i7", "name": "Avocado", "food_item_id": null, "qty": 70, "unit": "g", "hint": {"n": 0.5, "label": "Stück"}, "to_taste": false, "kcal": 112, "protein_g": 1.5, "source": "estimate"}, {"id": "i8", "name": "Skyr Nature lactosefrei (Coop)", "food_item_id": "e6f6fe41-b64a-44b6-adf4-ac146f2b5a5d", "qty": 100, "unit": "g", "hint": null, "to_taste": false, "kcal": 58, "protein_g": 11, "source": "staple"}, {"id": "i9", "name": "Cherrytomaten", "food_item_id": null, "qty": 150, "unit": "g", "hint": null, "to_taste": false, "kcal": 27, "protein_g": 1.5, "source": "estimate"}, {"id": "i10", "name": "Zitrone, Salz, Knoblauch, geräuchertes Paprikapulver", "food_item_id": null, "qty": null, "unit": null, "hint": null, "to_taste": true, "kcal": 0, "protein_g": 0, "source": "estimate"}]'::jsonb, '[{"text": "Kichererbsen {i6} abspülen, trocken tupfen, mit Olivenöl {i5} und Paprika mischen.", "timer_s": null, "items": ["i6", "i5"]}, {"text": "Kichererbsen im Airfryer bei 200 Grad 12 bis 15 Minuten garen, nach der Hälfte schütteln, herausnehmen.", "timer_s": 780, "items": ["i6"]}, {"text": "Pouletbrust {i1} auf etwa 2 cm klopfen oder längs halbieren, mit Olivenöl {i4} einreiben, salzen.", "timer_s": null, "items": ["i1", "i4"]}, {"text": "Paniermehl {i2} mit Parmesan {i3} und Paprika mischen, Poulet darin wenden, mit Spray besprühen.", "timer_s": null, "items": ["i2", "i3"]}, {"text": "Poulet bei 200 Grad 10 bis 12 Minuten garen, nach 6 Minuten wenden. Gar bei 74 Grad Kerntemperatur.", "timer_s": 660, "items": ["i1"]}, {"text": "Kichererbsen die letzten 2 Minuten wieder dazugeben.", "timer_s": 120, "items": ["i6"]}, {"text": "Skyr {i8} mit Zitrone, Salz und wenig Knoblauch verrühren.", "timer_s": null, "items": ["i8", "i10"]}, {"text": "Cherrytomaten {i9} halbieren, Avocado {i7} in Scheiben schneiden, alles anrichten, Poulet in Streifen darauf.", "timer_s": null, "items": ["i9", "i7"]}]'::jsonb),
  ('c5a0f6d2-0002-4f00-8000-00000000000d', 'Rührei mit Cottage Cheese und Knäckebrot', 'veggie', 10, 'Ohne Drink.',
    '[{"id": "i1", "name": "Eier", "food_item_id": "c5a0f6d1-0001-4f00-8000-000000000008", "qty": 3, "unit": "piece", "hint": null, "to_taste": false, "kcal": 252, "protein_g": 22.5, "source": "staple"}, {"id": "i2", "name": "Cottage Cheese Nature High Protein (Denner)", "food_item_id": "6dfe97fd-1a40-4ef8-90c8-64e0bcb407fe", "qty": 200, "unit": "g", "hint": {"n": 1, "label": "Becher"}, "to_taste": false, "kcal": 168, "protein_g": 18.2, "source": "staple"}, {"id": "i3", "name": "Knäckebrot Roggen Bio (Coop)", "food_item_id": "600c00ca-b6dd-4537-98f0-6bf4bf2e6618", "qty": 33, "unit": "g", "hint": {"n": 3, "label": "Scheiben"}, "to_taste": false, "kcal": 110.6, "protein_g": 3.0, "source": "staple"}, {"id": "i4", "name": "Tomaten", "food_item_id": null, "qty": 115, "unit": "g", "hint": null, "to_taste": false, "kcal": 21, "protein_g": 1.0, "source": "estimate"}, {"id": "i5", "name": "Salz, Pfeffer", "food_item_id": null, "qty": null, "unit": null, "hint": null, "to_taste": true, "kcal": 0, "protein_g": 0, "source": "estimate"}]'::jsonb, '[{"text": "Eier {i1} verquirlen, salzen und pfeffern.", "timer_s": null, "items": ["i1", "i5"]}, {"text": "In einer beschichteten Pfanne ohne Öl bei mittlerer Hitze langsam stocken lassen, dabei mit dem Spatel schieben.", "timer_s": 180, "items": ["i1"]}, {"text": "Tomaten {i4} schneiden. Rührei mit Cottage Cheese {i2}, Knäckebrot {i3} und den Tomaten anrichten.", "timer_s": null, "items": ["i2", "i3", "i4"]}]'::jsonb)
) as v(id, name, protein_type, prep_min, notes, items, steps)
on conflict (id) do nothing;

update public.food_item set deleted_at = now(), updated_at = now()
where id in ('3f225351-95c8-4ef3-bec4-b2f58b3b789d', '8ec5b385-cdca-4022-8b92-389b432b2f15') and deleted_at is null;

commit;

-- Check
select name, (select sum((x->>'kcal')::numeric) from jsonb_array_elements(items) x) as kcal,
  (select sum((x->>'protein_g')::numeric) from jsonb_array_elements(items) x) as protein, jsonb_array_length(steps) as steps
from public.recipe where id in ('c5a0f6d2-0002-4f00-8000-00000000000c', 'c5a0f6d2-0002-4f00-8000-00000000000d')
union all
select name || ' (staple, deleted ' || (deleted_at is not null) || ')', null, null, null from public.food_item
where id in ('3f225351-95c8-4ef3-bec4-b2f58b3b789d', '8ec5b385-cdca-4022-8b92-389b432b2f15');
