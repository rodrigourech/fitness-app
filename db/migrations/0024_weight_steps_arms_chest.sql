-- 0024_weight_steps_arms_chest.sql
-- Data only, 19 October 2026: weight steps confirmed by Rodrigo.
-- Overhead Triceps Extension (Cable) on the same Matrix tower as Triceps Pushdown (4.5 kg = 10 lb),
-- Chest Press (Machine) plates 10 kg, Preacher Curl (Machine) plates 5 kg. Idempotent.

update public.exercise set weight_step = v.step, updated_at = now()
  from (values
    ('5db24cf0-d28b-520b-86bb-d88a8dc490ee', 4.5),  -- Overhead Triceps Extension (Cable)
    ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', 10),   -- Chest Press (Machine)
    ('51217eb3-ec3e-52ea-8065-2e689d996e75', 5)     -- Preacher Curl (Machine)
  ) v(id, step)
 where exercise.id = v.id::uuid and exercise.weight_step is distinct from v.step;

select 'ROW ' || string_agg(name || ' = ' || coalesce(weight_step::text, '-'), ' || ' order by name)
  from public.exercise where deleted_at is null and parent_id is null and tracking_type = 'weight_reps';
