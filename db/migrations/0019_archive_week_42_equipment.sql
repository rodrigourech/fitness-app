-- 0019_archive_week_42_equipment.sql
-- Data only, 19 October 2026:
-- - Archived copies of the workouts as trained on Monday 12 October (Main Day A) and Thursday 15 October
--   (Main Day B): «Main Day A (12 Oct)» and «Main Day B (15 Oct)», with the exercises, set counts and weights of
--   those workouts (rep ranges come from the exercises). Restorable from the archive; history unchanged.
-- - Equipment as plate_loaded / pin_loaded / dumbbell (description only, no effect on recommendations)
-- Idempotent (ids derived from the source rows).

begin;

with src as (
  select w.id as workout_id, w.user_id, t.name || ' (' || to_char(w.started_at at time zone 'Europe/Zurich', 'FMDD Mon') || ')' as name
    from public.workout w join public.template t on t.id = w.template_id
   where w.deleted_at is null and w.finished_at is not null
     and ((t.name = 'Main Day A' and (w.started_at at time zone 'Europe/Zurich')::date = date '2026-10-12')
       or (t.name = 'Main Day B' and (w.started_at at time zone 'Europe/Zurich')::date = date '2026-10-15'))
)
insert into public.template (id, user_id, name, note, archived_at, created_at, updated_at, deleted_at)
select md5('archive-template:' || workout_id)::uuid, user_id, name, null, now(), now(), now(), null from src
on conflict (id) do nothing;

insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select md5('archive-te:' || we.id)::uuid, we.user_id, md5('archive-template:' || we.workout_id)::uuid, we.exercise_id,
       row_number() over (partition by we.workout_id order by we.position), we.rest_s, null, now(), now(), null
  from public.workout_exercise we
 where we.deleted_at is null and we.skipped_at is null
   and exists (select 1 from public.template t where t.id = md5('archive-template:' || we.workout_id)::uuid)
on conflict (id) do nothing;

insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select md5('archive-ts:' || s.id)::uuid, s.user_id, md5('archive-te:' || s.workout_exercise_id)::uuid,
       row_number() over (partition by s.workout_exercise_id order by s.position), 'working', null, null,
       s.weight, s.duration_s, s.distance_km, now(), now(), null
  from public.workout_set s
 where s.deleted_at is null and s.set_type = 'working'
   and exists (select 1 from public.template_exercise te where te.id = md5('archive-te:' || s.workout_exercise_id)::uuid)
on conflict (id) do nothing;

-- Equipment (main exercises; variants inherit in the app)
update public.exercise set equipment = v.eq, updated_at = now()
  from (values
    ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', 'plate_loaded'), -- Chest Press (Machine)
    ('51217eb3-ec3e-52ea-8065-2e689d996e75', 'plate_loaded'), -- Preacher Curl
    ('6144fd76-baee-5c78-a409-4ce968051388', 'pin_loaded'),   -- Leg Press
    ('fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7', 'pin_loaded'),   -- Lying Leg Curl
    ('8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', 'pin_loaded'),   -- Lat Pulldown
    ('09ab0a44-dcd2-5c33-989a-3986f73cdb06', 'pin_loaded'),   -- Seated Row
    ('2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', 'pin_loaded'),   -- Triceps Pushdown
    ('a3f09696-52df-5e8f-a9b3-26ab3c1684f7', 'pin_loaded'),   -- Lateral Raise
    ('7ca1c0fa-f1c7-576b-a946-f1832f3dcb14', 'dumbbell')      -- Incline Chest Press (Dumbbell)
  ) v(id, eq)
 where exercise.id = v.id::uuid and exercise.equipment is distinct from v.eq;

commit;

-- Check
select t.name, t.archived_at is not null as archived, count(distinct te.id) as exercises, count(ts.id) as sets
  from public.template t
  left join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  left join public.template_set ts on ts.template_exercise_id = te.id and ts.deleted_at is null
 where t.name like 'Main Day _ (%'
 group by t.name, t.archived_at;
