-- 0011_trash.sql
-- Trash (decision 8 October 2026): deleted body weight entries, photos and workouts stay restorable
-- for 30 days. Deleting still only sets deleted_at; purged_at marks a row that was removed from the
-- trash for good ("Delete permanently", "Empty trash" or after 30 days). The row itself stays as a
-- tombstone for the sync (no DELETE grant). For photos the encrypted object in the bucket is only
-- removed when the photo is purged, no longer when it is deleted.
-- Idempotent; after running: neon data-api refresh-schema --database neondb

begin;

alter table public.body_weight add column if not exists purged_at timestamptz;
alter table public.body_photo  add column if not exists purged_at timestamptz;
alter table public.workout     add column if not exists purged_at timestamptz;

commit;
