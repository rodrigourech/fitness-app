-- 0041_exercise_floor.sql
-- Data only, 5 November 2026: location in the gym as an attribute of the exercise (exercise.floor, existing column,
-- now shown under Exercise › Setup › Location). Rule from Rodrigo: leg machines, Lat Pulldown, Seated Row and the
-- Technogym Delts Machine (Lateral Raise, Shoulder Press) downstairs, everything else upstairs (cable tower for
-- Pushdown and the other cable exercises upstairs, confirmed 5 Nov). Laufen has no floor. Main exercises only;
-- variants inherit. Idempotent.

update public.exercise e
   set floor = v.floor, updated_at = greatest(now(), e.updated_at + interval '1 ms')
  from (values
  ('Lat Pulldown (Cable)', 'unten'), ('Lat Pulldown (verkürzt, bis 1. Nov)', 'unten'), ('Lateral Raise (Machine)', 'unten'),
  ('Shoulder Press (Machine)', 'unten'), ('Leg Press', 'unten'), ('Lying Leg Curl (Machine)', 'unten'),
  ('Seated Leg Curl (Machine)', 'unten'), ('Seated Row (Cable)', 'unten'),
  ('Bicycle', 'oben'), ('Butterfly (Machine)', 'oben'), ('Cable Curl', 'oben'), ('Chest Press (Machine)', 'oben'),
  ('Chest-Supported Row (Machine)', 'oben'), ('Decline Crunch', 'oben'), ('Face Pull (Cable)', 'oben'),
  ('Incline Chest Press (Dumbbell)', 'oben'), ('Incline Chest Press (Machine)', 'oben'), ('Lateral Raise (Cable)', 'oben'),
  ('Overhead Triceps Extension (Cable)', 'oben'), ('Preacher Curl (Machine)', 'oben'), ('Seated Dip (Machine)', 'oben'),
  ('Straight-Arm Pulldown (Cable)', 'oben'), ('Triceps Pushdown (Cable)', 'oben')
  ) v(name, floor)
 where e.name = v.name and e.parent_id is null and e.deleted_at is null and e.floor is distinct from v.floor;

-- Check
select 'ROW ' || string_agg(name || ' = ' || coalesce(floor, '-'), ' | ' order by floor nulls last, name)
  from public.exercise where parent_id is null and deleted_at is null;
