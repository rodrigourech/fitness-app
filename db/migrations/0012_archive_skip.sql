-- 0012_archive_skip.sql
-- Decisions 9 October 2026 (docs/entscheidungen.md):
-- - template.archived_at: "Delete" on a workout template archives it (section Archive, restorable);
--   template.purged_at: removed from the trash for good (like 0011)
-- - workout_exercise.skipped_at: an exercise skipped as a whole in a running workout; kept in the
--   history as "Skipped", its sets are discarded at finish
-- - template_exercise.rest_s is used again as a per-template rest override; old values were unused
--   since 5 October and are cleared, so they do not suddenly apply
-- Idempotent; after running: neon data-api refresh-schema --database neondb

begin;

alter table public.template         add column if not exists archived_at timestamptz;
alter table public.template         add column if not exists purged_at   timestamptz;
alter table public.workout_exercise add column if not exists skipped_at  timestamptz;

-- Only rows from before the decision, so a rerun never clears new overrides
update public.template_exercise
   set rest_s = null, updated_at = now()
 where rest_s is not null
   and created_at < '2026-10-09T00:00:00+02:00';

commit;
