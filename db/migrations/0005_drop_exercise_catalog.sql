-- 0005_drop_exercise_catalog.sql
-- The exercise catalog (Free Exercise DB) ships as a file with the app (decision 4 October 2026).
-- exercise.source_id keeps the catalog id as plain text, without foreign key.
-- After running: neon data-api refresh-schema --database neondb

begin;

alter table public.exercise drop constraint if exists exercise_source_id_fkey;
drop table if exists public.exercise_catalog;

commit;
