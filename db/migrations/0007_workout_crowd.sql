-- 0007_workout_crowd.sql
-- How crowded the gym was when leaving (1 = empty, 5 = packed), rated at the end of a workout.
-- Analysed by weekday and time of finishing (Stats tab).
-- After running: neon data-api refresh-schema --database neondb

alter table public.workout
  add column if not exists crowd_level smallint check (crowd_level between 1 and 5);
