-- 0035_food_entry_auto.sql
-- Nutrition (decision 2 November 2026): automatic daily entries (ESN shake every day, 3 espressos with milk Monday to
-- Friday) are stored with source 'auto'. A day with only such entries counts as not filled in. The app creates them;
-- the Food connector keeps writing 'claude'. Run before the app is pushed. No new column, no schema refresh. Idempotent.

alter table public.food_entry drop constraint if exists food_entry_source_check;
alter table public.food_entry add constraint food_entry_source_check check (source in ('app', 'claude', 'auto'));

select 'ROW ' || pg_get_constraintdef(oid) from pg_constraint where conname = 'food_entry_source_check';
