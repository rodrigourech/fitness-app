-- 0017_rep_categories_top_set.sql
-- Data only: training logic of 18 October 2026 (categories, top set, warm-up set), no schema change.
-- - Rep ranges and warm-up per exercise by category (stored in exercise.target_reps = Max Reps,
--   exercise.min_reps = Min Reps, exercise.warm_up):
--     Compound 6-9 with warm-up: Chest Press, Lat Pulldown, Seated Row
--     Isolation 8-12 without warm-up: Triceps Pushdown, Preacher Curl; Leg Press and Lying Leg Curl keep warm-up
--     Small muscle 10-15 without warm-up: Lateral Raise
-- - Chest Press: the variants «Griffe Mitte Brust» and «Sitz tiefer» are merged into «Chest Press (Machine)»
--   (history, links and workouts move to the main exercise, the variants are soft-deleted)
-- - Main Day A/B: Chest Press 3 instead of 4 work sets, Triceps Pushdown and Preacher Curl 3 instead of 2
-- - Template rep overrides (target_reps_min/max) are cleared; the exercise ranges apply
-- Idempotent. Aborts without changes if a precondition fails or the history count changes.

begin;

do $$
declare
  before_sets int;
  after_sets int;
begin
  if (select count(*) from private.app_owner) <> 1 then
    raise exception 'Expected exactly one owner';
  end if;
  if exists (select 1 from public.workout w where w.finished_at is null and w.deleted_at is null) then
    raise exception 'A workout is running; finish it first';
  end if;

  select count(*) into before_sets
    from public.workout_set s join public.workout_exercise we on we.id = s.workout_exercise_id
   where s.deleted_at is null and we.deleted_at is null
     and we.exercise_id in ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', '03d8bced-f440-542c-b6eb-0bfd3a4e08ba', 'ce51ba9f-ae6a-5876-b3ee-40df14397a37');

  -- Categories (Max Reps / Min Reps / warm-up)
  update public.exercise e set target_reps = v.mx, min_reps = v.mn, warm_up = v.wu, updated_at = now()
    from (values
      ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', 9, 6, true),   -- Chest Press (Machine)
      ('8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', 9, 6, true),   -- Lat Pulldown
      ('09ab0a44-dcd2-5c33-989a-3986f73cdb06', 9, 6, true),   -- Seated Row
      ('c6473665-753c-5771-ba78-c6e0d8c1c89b', 12, 8, false), -- Triceps Pushdown
      ('51217eb3-ec3e-52ea-8065-2e689d996e75', 12, 8, false), -- Preacher Curl
      ('6144fd76-baee-5c78-a409-4ce968051388', 12, 8, true),  -- Leg Press
      ('fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7', 12, 8, true),  -- Lying Leg Curl
      ('a3f09696-52df-5e8f-a9b3-26ab3c1684f7', 15, 10, false) -- Lateral Raise
    ) v(id, mx, mn, wu)
   where e.id = v.id::uuid
     and (e.target_reps is distinct from v.mx or e.min_reps is distinct from v.mn or e.warm_up is distinct from v.wu);

  -- Variants of these exercises inherit the range
  update public.exercise set target_reps = null, min_reps = null, warm_up = null, updated_at = now()
   where parent_id in ('8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', '09ab0a44-dcd2-5c33-989a-3986f73cdb06')
     and deleted_at is null and (target_reps is not null or min_reps is not null or warm_up is not null);

  -- Chest Press: one exercise with one history
  update public.workout_exercise set exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380', updated_at = now()
   where exercise_id in ('03d8bced-f440-542c-b6eb-0bfd3a4e08ba', 'ce51ba9f-ae6a-5876-b3ee-40df14397a37');
  update public.template_exercise set exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380', updated_at = now()
   where exercise_id in ('03d8bced-f440-542c-b6eb-0bfd3a4e08ba', 'ce51ba9f-ae6a-5876-b3ee-40df14397a37');
  update public.exercise_link set exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380', updated_at = now()
   where exercise_id in ('03d8bced-f440-542c-b6eb-0bfd3a4e08ba', 'ce51ba9f-ae6a-5876-b3ee-40df14397a37');
  update public.exercise set setup_note = 'Oben
Griffe auf Brustwarzenhöhe', updated_at = now()
   where id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380' and setup_note is distinct from 'Oben
Griffe auf Brustwarzenhöhe';
  update public.exercise set deleted_at = now(), updated_at = now()
   where id in ('03d8bced-f440-542c-b6eb-0bfd3a4e08ba', 'ce51ba9f-ae6a-5876-b3ee-40df14397a37') and deleted_at is null;

  select count(*) into after_sets
    from public.workout_set s join public.workout_exercise we on we.id = s.workout_exercise_id
   where s.deleted_at is null and we.deleted_at is null and we.exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380';
  if after_sets <> before_sets then
    raise exception 'Chest Press history changed: % sets before, % after', before_sets, after_sets;
  end if;

  -- Chest Press: 3 work sets (A and B)
  update public.template_set set deleted_at = now(), updated_at = now()
   where id in ('af7510df-4cda-50ac-863e-5adceaf5637b', '425613ed-da42-5128-8866-a8092f2c4c6b') and deleted_at is null;

  -- Rep overrides of all templates are cleared
  update public.template_set set target_reps_min = null, target_reps_max = null, updated_at = now()
   where deleted_at is null and (target_reps_min is not null or target_reps_max is not null);
end
$$;

-- Triceps Pushdown and Preacher Curl: third work set (A and B)
with o as (select user_id from private.app_owner limit 1)
insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select v.id::uuid, o.user_id, v.te::uuid, 3, 'working', null, null, v.kg::numeric, null, null, now(), now(), null
from o, (values
  ('8f1bd1f2-5962-5ba6-bb0b-44a2c503f18a', '61a8b4dc-10db-56c7-bc98-b43dec2ca39b', 36),
  ('ead2d3a9-85f5-5c12-b322-57dbf92a8bdb', '10426378-c008-53d3-b1c3-669a94a66314', 36),
  ('fcef5cd9-feee-56dd-9572-a2bc6e0e6692', '09b778a9-d8ba-50a5-b10e-34757594a701', 15),
  ('463f553d-c663-5030-8565-ddb4cda52aed', 'b81f122e-a096-54f4-8e0b-370517c1cea8', 15)
) v(id, te, kg)
on conflict (id) do nothing;

commit;

-- Check
select t.name, te.position, e.name as exercise, e.target_reps as max_reps, e.min_reps, e.warm_up,
  (select count(*) from public.template_set ts where ts.template_exercise_id = te.id and ts.deleted_at is null) as sets
from public.template t
join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
join public.exercise e on e.id = te.exercise_id
where t.name in ('Main Day A', 'Main Day B') and t.deleted_at is null and t.archived_at is null
order by t.name, te.position;
