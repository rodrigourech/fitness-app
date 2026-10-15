-- 0015_crowd_scale_10.sql
-- Gym crowd rating on a scale of 1 to 10 instead of 1 to 5 (decision 15 October 2026).
-- Existing ratings keep their number (2 of 5 becomes 2 of 10); no data is changed.
-- Run in the Neon SQL Editor BEFORE pushing the app, then refresh the Data API schema cache:
--   neon data-api refresh-schema --database neondb
-- Otherwise a rating above 5 is rejected by the server and blocks the sync.
-- Idempotent.

begin;

do $$
declare c record;
begin
  -- Drop every check constraint on workout.crowd_level (the one from 0007 has a generated name)
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.conrelid = 'public.workout'::regclass and con.contype = 'c' and att.attname = 'crowd_level'
  loop
    execute format('alter table public.workout drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.workout
  add constraint workout_crowd_level_check check (crowd_level between 1 and 10);

commit;
