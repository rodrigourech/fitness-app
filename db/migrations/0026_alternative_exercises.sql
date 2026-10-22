-- 0026_alternative_exercises.sql
-- Schema and data, 22 October 2026: alternative exercises
-- - exercise.alternative_id: exercise to switch to in a running workout when this one is taken
--   (null on a variant = inherit from the main exercise)
-- - workout_exercise.original_exercise_id: planned exercise while its alternative is trained (null = as planned)
-- - Pairs in both directions, only where no alternative is set yet:
--   Chest Press (Machine) <-> Incline Chest Press (Dumbbell)
--   Triceps Pushdown (Cable) <-> Overhead Triceps Extension (Cable)
-- After running: neon data-api refresh-schema --database neondb (or «Refresh schema cache»), then push the app.
-- Idempotent.

begin;

alter table public.exercise
  add column if not exists alternative_id uuid references public.exercise (id) deferrable initially deferred;
alter table public.workout_exercise
  add column if not exists original_exercise_id uuid references public.exercise (id) deferrable initially deferred;

update public.exercise set alternative_id = v.alt::uuid, updated_at = now()
  from (values
    ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', '7ca1c0fa-f1c7-576b-a946-f1832f3dcb14'),  -- Chest Press (Machine) -> Incline Chest Press (Dumbbell)
    ('7ca1c0fa-f1c7-576b-a946-f1832f3dcb14', '1f3d184e-fccb-514f-a554-b6a6cbbc7380'),  -- Incline Chest Press (Dumbbell) -> Chest Press (Machine)
    ('2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', '5db24cf0-d28b-520b-86bb-d88a8dc490ee'),  -- Triceps Pushdown (Cable) -> Overhead Triceps Extension (Cable)
    ('5db24cf0-d28b-520b-86bb-d88a8dc490ee', '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0')   -- Overhead Triceps Extension (Cable) -> Triceps Pushdown (Cable)
  ) v(id, alt)
 where exercise.id = v.id::uuid
   and exercise.alternative_id is null
   and exists (select 1 from public.exercise a where a.id = v.alt::uuid and a.deleted_at is null);

commit;

-- Check
select 'ROW ' || string_agg(e.name || ' -> ' || coalesce(a.name, '-'), ' | ' order by e.name)
  from public.exercise e
  join public.exercise a on a.id = e.alternative_id
 where e.deleted_at is null;
