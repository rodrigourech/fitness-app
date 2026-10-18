-- 0016_incline_chest_press.sql
-- Data only: two new exercises for later use (not part of any workout yet), 18 October 2026
-- - Incline Chest Press (Machine)
-- - Incline Chest Press (Dumbbell)
-- Rep range 6-9 (decision 18 October 2026), warm-up hint on. Idempotent (fixed ids).

with o as (select user_id from private.app_owner limit 1)
insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, default_rest_s, target_reps, min_reps, warm_up, created_at, updated_at, deleted_at)
select v.id::uuid, o.user_id, null, v.name, v.equipment, array['chest'], array['triceps', 'front_delts'], 'weight_reps',
  false, 150, 9, 6, true, now(), now(), null
from o, (values
  ('bcd40dee-75cb-544b-af11-36e6d8d15a53', 'Incline Chest Press (Machine)', 'machine'),
  ('7ca1c0fa-f1c7-576b-a946-f1832f3dcb14', 'Incline Chest Press (Dumbbell)', 'dumbbell')
) v(id, name, equipment)
on conflict (id) do nothing;
