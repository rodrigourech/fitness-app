-- 0033_triceps_seated_dip.sql
-- Data only, 1 November 2026 (decision Rodrigo, open since 29 October):
-- - New exercise «Seated Dip (Machine)» (Technogym Pure Strength Seated Dip, plates), 8–12, warm-up and top set;
--   weight step unknown until the smallest plate is known (estimated with ≈ meanwhile)
-- - Main Day B: Seated Dip replaces Overhead Triceps Extension (Cable), which Rodrigo does not like
-- - Main Day A: Triceps Pushdown with Straight Bar instead of V-Grip (felt better; grips make no proven difference
--   for growth, so comfort and steady progression decide)
-- - Alternatives: Seated Dip and Triceps Pushdown in both directions (Overhead keeps Pushdown as its alternative)
-- Target weights of the changed slots are cleared, so the app starts from the history of the new exercise or variant.
-- A running workout is not touched. Idempotent.

begin;

with o as (select user_id from private.app_owner limit 1)
insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, default_rest_s, setup_note, focus_muscles, target_reps, min_reps, warm_up, top_set, created_at, updated_at, deleted_at)
select '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8'::uuid, o.user_id, null, 'Seated Dip (Machine)', 'plate_loaded', '{triceps}'::text[],
  '{chest,front_delts}'::text[], 'weight_reps', false, 90, E'Technogym Pure Strength Seated Dip\nOberkörper aufrecht, Ellbogen nah am Körper',
  '{triceps-lateral}'::text[], 12, 8, true, true, now(), now(), null
from o
on conflict (id) do nothing;

-- Main Day B: Overhead Triceps Extension → Seated Dip
create temporary table changed_slot (id uuid) on commit drop;
with s as (
  update public.template_exercise te
     set exercise_id = '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8', updated_at = greatest(now(), te.updated_at + interval '1 ms')
    from public.template t
   where t.id = te.template_id and t.name = 'Main Day B' and t.deleted_at is null and t.archived_at is null
     and te.deleted_at is null and te.exercise_id = '5db24cf0-d28b-520b-86bb-d88a8dc490ee'
  returning te.id
)
insert into changed_slot select id from s;

-- Main Day A: Triceps Pushdown (main or another variant) → variant Straight Bar
with s as (
  update public.template_exercise te
     set exercise_id = 'c6473665-753c-5771-ba78-c6e0d8c1c89b', updated_at = greatest(now(), te.updated_at + interval '1 ms')
    from public.template t, public.exercise e
   where t.id = te.template_id and t.name = 'Main Day A' and t.deleted_at is null and t.archived_at is null
     and te.deleted_at is null and e.id = te.exercise_id
     and (e.id = '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0' or e.parent_id = '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0')
     and e.id <> 'c6473665-753c-5771-ba78-c6e0d8c1c89b'
     and exists (select 1 from public.exercise b where b.id = 'c6473665-753c-5771-ba78-c6e0d8c1c89b' and b.deleted_at is null)
  returning te.id
)
insert into changed_slot select id from s;

update public.template_set set target_weight = null, updated_at = greatest(now(), updated_at + interval '1 ms')
 where template_exercise_id in (select id from changed_slot) and deleted_at is null and target_weight is not null;

-- Alternatives in both directions
update public.exercise set alternative_id = v.alt::uuid, updated_at = greatest(now(), updated_at + interval '1 ms')
  from (values
    ('07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8', '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0'),
    ('2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8')
  ) v(id, alt)
 where exercise.id = v.id::uuid and exercise.alternative_id is distinct from v.alt::uuid;

commit;

-- Check
select 'ROW ' || string_agg(t.name || ' ' || te.position || ' ' || coalesce(p.name || ' / ', '') || e.name, ' | ' order by t.name, te.position)
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.name in ('Main Day A', 'Main Day B') and t.deleted_at is null and t.archived_at is null
   and coalesce(p.name, e.name) in ('Triceps Pushdown (Cable)', 'Overhead Triceps Extension (Cable)', 'Seated Dip (Machine)');
