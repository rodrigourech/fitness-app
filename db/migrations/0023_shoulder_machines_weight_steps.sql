-- 0023_shoulder_machines_weight_steps.sql
-- Data only, 19 October 2026:
-- - New exercises without a workout: Shoulder Press (Machine) and Lateral Raise (Machine) (Technogym «Delts Machine»),
--   both pin_loaded with stacks in 5 kg steps (yellow 2.5 kg add-on not used as a step)
-- - Weight steps from photos of the machines: Matrix tower 4.5 kg (10 lb) for Lateral Raise and Triceps Pushdown (Cable),
--   Lat Pulldown 6.8 kg (15 lb), Seated Leg Curl 5 kg, dumbbells 2 kg (Incline Chest Press (Dumbbell))
-- Variants inherit the step of their main exercise. Idempotent.

begin;

with o as (select user_id from private.app_owner limit 1)
insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, default_rest_s, setup_note, focus_muscles, target_reps, min_reps, warm_up, top_set, weight_step,
  created_at, updated_at, deleted_at)
select v.id::uuid, o.user_id, null, v.name, 'pin_loaded', v.prim::text[], v.sec::text[], 'weight_reps',
  false, v.rest, v.note, v.focus::text[], v.max_reps, v.min_reps, v.wu, v.top, 5, now(), now(), null
from o, (values
  ('90ef317d-9d34-559f-8783-40057f99e6f6', 'Shoulder Press (Machine)', '{front_delts}', '{side_delts,triceps}', 120, 'Technogym',
   '{shoulder-front,shoulder-side}', 10, 6, true, true),
  ('377d7bce-a5f5-5da6-856e-3a695f79dfe5', 'Lateral Raise (Machine)', '{side_delts}', '{}', 60, 'Technogym Delts Machine',
   '{shoulder-side}', 15, 10, false, false)
) v(id, name, prim, sec, rest, note, focus, max_reps, min_reps, wu, top)
on conflict (id) do nothing;

update public.exercise set weight_step = v.step, updated_at = now()
  from (values
    ('a3f09696-52df-5e8f-a9b3-26ab3c1684f7', 4.5),  -- Lateral Raise (Matrix tower, 10 lb)
    ('2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', 4.5),  -- Triceps Pushdown (Cable) (Matrix tower, 10 lb)
    ('8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', 6.8),  -- Lat Pulldown (15 lb)
    ('4716d4ac-9fda-59f4-883a-c570aa7bd339', 5),    -- Seated Leg Curl (Machine)
    ('7ca1c0fa-f1c7-576b-a946-f1832f3dcb14', 2)     -- Incline Chest Press (Dumbbell)
  ) v(id, step)
 where exercise.id = v.id::uuid and exercise.weight_step is distinct from v.step;

commit;

-- Check
select 'ROW ' || string_agg(e.name || ' = ' || coalesce(e.weight_step::text, '-') || ' ' || coalesce(e.equipment, '-')
       || ' ' || coalesce(e.min_reps::text, '-') || '-' || coalesce(e.target_reps::text, '-'), ' || ' order by e.name)
  from public.exercise e
 where e.deleted_at is null and (e.weight_step is not null or e.id in ('90ef317d-9d34-559f-8783-40057f99e6f6', '377d7bce-a5f5-5da6-856e-3a695f79dfe5'));
