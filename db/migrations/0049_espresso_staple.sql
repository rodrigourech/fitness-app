-- 0049_espresso_staple.sql
-- Data only, 19 November 2026 (decision Rodrigo): espresso with milk becomes a staple, so its count can be changed in an
-- entry and kcal and protein follow (18.5 kcal and 1 g protein each: espresso 2 kcal plus 2 tbsp milk). The automatic
-- daily entries are named «Espresso with milk» without the count; the count stays in the item amount («2 ×», «3 ×»)
-- and is shown next to the name. Earlier automatic espresso entries are renamed the same way and point to the staple.
-- kcal and protein of the entries stay as they are. Idempotent.

begin;

insert into public.food_item (id, user_id, name, store, basis, kcal, protein_g, piece_g, package_g, note, created_at, updated_at)
select 'c5a0f6d1-0001-4f00-8000-000000000013'::uuid, o.user_id, 'Espresso with milk', null, 'piece', 18.5, 1, null, null,
       '2 tbsp milk', now(), now()
  from private.app_owner o
on conflict (id) do nothing;

update public.food_entry f
   set title = 'Espresso with milk',
       items = case when jsonb_typeof(f.items) = 'array' and jsonb_array_length(f.items) = 1
                    then jsonb_build_array((f.items -> 0) || jsonb_build_object('name', 'Espresso with milk',
                           'food_item_id', 'c5a0f6d1-0001-4f00-8000-000000000013'))
                    else f.items end,
       updated_at = greatest(now(), f.updated_at + interval '1 ms')
 where f.source = 'auto' and f.deleted_at is null and f.title ~ '^\d+ espressos with milk$';

commit;

-- Check
select 'ROW staple: ' || coalesce((select name || ' ' || kcal || ' kcal ' || protein_g || ' g' from public.food_item
         where id = 'c5a0f6d1-0001-4f00-8000-000000000013'), 'missing')
union all
select 'ROW auto espresso entries: ' || count(*) || ', old titles left: '
       || count(*) filter (where title <> 'Espresso with milk')
  from public.food_entry where source = 'auto' and deleted_at is null and title ilike '%espresso%';
