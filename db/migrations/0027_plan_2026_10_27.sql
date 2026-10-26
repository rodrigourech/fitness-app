-- 0027_plan_2026_10_27.sql
-- Data only, plan review of 26 October 2026 (no change to app logic):
-- - Previous plan archived as «Main Day A (until 26 Oct)» and «Main Day B (until 26 Oct)» (restorable from the archive)
-- - Bicycle removed from Main Day A and Main Day B (Bonus Day unchanged)
-- - New order with one floor change: first the machines downstairs (back, legs), then upstairs (chest, shoulders, arms)
--     Main Day A: Lat Pulldown, Leg Press, Incline Chest Press, Chest-Supported Row, Lateral Raise, Triceps Pushdown, Preacher Curl
--     Main Day B: Seated Row, Seated Leg Curl, Chest Press, Lateral Raise, Overhead Triceps Extension, Preacher Curl
-- - New exercise «Chest-Supported Row (Machine)», plate loaded, 8-12, no top set, no warm-up, weight step open;
--   in Main Day A after Incline Chest Press with 3 sets and 120 s
-- - Lat Pulldown and Seated Row 8-12 instead of 6-10 (lighter weight for technique; variants inherit)
-- - Weight step Seated Row 6.8 kg (15 lb stack like Lat Pulldown)
-- - Preacher Curl rest 120 s in Main Day A and B (Bonus Day keeps 60 s)
-- - Note «Kein Zwischensatz vor dem Top Set» for Chest Press and Triceps Pushdown (V-Grip inherits unless it has its own note)
-- Template slots are found by workout name and main exercise, not by fixed slot ids, because Main Day A was edited
-- in the app (Incline Chest Press, V-Grip). Idempotent. Aborts without changes if a precondition fails.
-- A running workout is not touched (it keeps its own copy); the new plan applies from the next start.

begin;

-- Slots of the two active workouts with their main exercise
create temporary table plan_slot on commit drop as
select t.name as workout, te.id as slot_id, te.exercise_id, coalesce(e.parent_id, e.id) as root_id, te.position, te.rest_s,
       te.updated_at
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
 where t.name in ('Main Day A', 'Main Day B') and t.deleted_at is null and t.archived_at is null;

-- Target order: workout, main exercise, position (Bicycle has no position and is removed)
create temporary table plan_order (workout text, root_id uuid, position int) on commit drop;
insert into plan_order values
  ('Main Day A', '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', 1),  -- Lat Pulldown (Cable)
  ('Main Day A', '6144fd76-baee-5c78-a409-4ce968051388', 2),  -- Leg Press
  ('Main Day A', '7ca1c0fa-f1c7-576b-a946-f1832f3dcb14', 3),  -- Incline Chest Press (Dumbbell)
  ('Main Day A', '767f29a4-918b-5180-92a0-2f2ba5633811', 4),  -- Chest-Supported Row (Machine), new
  ('Main Day A', 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7', 5),  -- Lateral Raise (Cable)
  ('Main Day A', '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', 6),  -- Triceps Pushdown (Cable)
  ('Main Day A', '51217eb3-ec3e-52ea-8065-2e689d996e75', 7),  -- Preacher Curl (Machine)
  ('Main Day B', '09ab0a44-dcd2-5c33-989a-3986f73cdb06', 1),  -- Seated Row (Cable)
  ('Main Day B', '4716d4ac-9fda-59f4-883a-c570aa7bd339', 2),  -- Seated Leg Curl (Machine)
  ('Main Day B', '1f3d184e-fccb-514f-a554-b6a6cbbc7380', 3),  -- Chest Press (Machine)
  ('Main Day B', 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7', 4),  -- Lateral Raise (Cable)
  ('Main Day B', '5db24cf0-d28b-520b-86bb-d88a8dc490ee', 5),  -- Overhead Triceps Extension (Cable)
  ('Main Day B', '51217eb3-ec3e-52ea-8065-2e689d996e75', 6);  -- Preacher Curl (Machine)

do $$
declare
  problem text;
begin
  if (select count(*) from private.app_owner) <> 1 then
    raise exception 'Expected exactly one owner';
  end if;
  if (select count(distinct workout) from plan_slot) <> 2 then
    raise exception 'Main Day A or Main Day B is missing or not unique';
  end if;
  -- Every planned exercise (except the new row) exactly once per workout
  select string_agg(o.workout || ': ' || o.root_id, ', ') into problem
    from plan_order o
   where o.root_id <> '767f29a4-918b-5180-92a0-2f2ba5633811'
     and (select count(*) from plan_slot s where s.workout = o.workout and s.root_id = o.root_id) <> 1;
  if problem is not null then
    raise exception 'Expected exactly one slot for: %', problem;
  end if;
  -- No other exercise than the planned ones and Bicycle
  select string_agg(s.workout || ': ' || s.root_id, ', ') into problem
    from plan_slot s
   where s.root_id <> '584aae25-67a2-54c9-b314-2c9c0f6c78d9'
     and not exists (select 1 from plan_order o where o.workout = s.workout and o.root_id = s.root_id);
  if problem is not null then
    raise exception 'Unexpected exercise in workout: %', problem;
  end if;
  -- Main Day A uses the Classic Grip variant of Lat Pulldown
  if not exists (select 1 from plan_slot where workout = 'Main Day A'
                   and exercise_id = 'd3e01b25-c5c1-5bb1-a543-830fb226fc75') then
    raise exception 'Main Day A does not use Lat Pulldown Classic Grip';
  end if;
end
$$;

-- Archive: copies of Main Day A and B as they are before this change, «Main Day A (until 26 Oct)» and
-- «Main Day B (until 26 Oct)», with exercises, rest, set types and target weights. The active workouts keep their
-- ids (Home A/B rotation, report and «Compared with last» use the template id) and are changed below.
-- Copied only once: on a repeated run the archive exists and nothing is copied again.
create temporary table plan_archive on commit drop as
select t.id as template_id, md5('archive-2026-10-26-template:' || t.id)::uuid as archive_id, t.user_id,
       t.name || ' (until 26 Oct)' as name
  from public.template t
 where t.name in ('Main Day A', 'Main Day B') and t.deleted_at is null and t.archived_at is null
   and not exists (select 1 from public.template x where x.id = md5('archive-2026-10-26-template:' || t.id)::uuid);

insert into public.template (id, user_id, name, note, archived_at, created_at, updated_at, deleted_at)
select a.archive_id, a.user_id, a.name, null, now(), now(), now(), null from plan_archive a
on conflict (id) do nothing;

insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select md5('archive-2026-10-26-te:' || te.id)::uuid, te.user_id, a.archive_id, te.exercise_id, te.position, te.rest_s,
       te.comment, now(), now(), null
  from plan_archive a
  join public.template_exercise te on te.template_id = a.template_id and te.deleted_at is null
on conflict (id) do nothing;

insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select md5('archive-2026-10-26-ts:' || ts.id)::uuid, ts.user_id, md5('archive-2026-10-26-te:' || te.id)::uuid, ts.position,
       ts.set_type, ts.target_reps_min, ts.target_reps_max, ts.target_weight, ts.target_duration_s, ts.target_distance_km,
       now(), now(), null
  from plan_archive a
  join public.template_exercise te on te.template_id = a.template_id and te.deleted_at is null
  join public.template_set ts on ts.template_exercise_id = te.id and ts.deleted_at is null
on conflict (id) do nothing;

-- New exercise
with o as (select user_id from private.app_owner limit 1)
insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, default_rest_s, setup_note, focus_muscles, focus_cue, target_reps, min_reps, warm_up, top_set,
  weight_step, created_at, updated_at, deleted_at)
select '767f29a4-918b-5180-92a0-2f2ba5633811'::uuid, o.user_id, null, 'Chest-Supported Row (Machine)', 'plate_loaded',
  array['upper_back'], array['lats', 'biceps'], 'weight_reps', false, 120, null,
  array['lats-mid', 'traps-mid', 'deltoid-rear'], 'Brust am Polster, Ellbogen nach hinten, Schulterblätter am Ende zusammen',
  12, 8, false, false, null, now(), now(), null
from o
on conflict (id) do nothing;

-- Rep range 8-12 for the two pulls, weight step Seated Row
update public.exercise set target_reps = 12, min_reps = 8, updated_at = greatest(now(), updated_at + interval '1 ms')
 where id in ('8ca6bcc2-1cc1-5f1f-b6a5-609954173d50',  -- Lat Pulldown (Cable)
              '09ab0a44-dcd2-5c33-989a-3986f73cdb06')  -- Seated Row (Cable)
   and (target_reps is distinct from 12 or min_reps is distinct from 8);
update public.exercise set weight_step = 6.8, updated_at = greatest(now(), updated_at + interval '1 ms')
 where id = '09ab0a44-dcd2-5c33-989a-3986f73cdb06' and weight_step is distinct from 6.8;

-- Bicycle out of Main Day A and B (exercise and history stay)
update public.template_set set deleted_at = now(), updated_at = greatest(now(), updated_at + interval '1 ms')
 where deleted_at is null
   and template_exercise_id in (select slot_id from plan_slot where root_id = '584aae25-67a2-54c9-b314-2c9c0f6c78d9');
update public.template_exercise set deleted_at = now(), updated_at = greatest(now(), updated_at + interval '1 ms')
 where deleted_at is null
   and id in (select slot_id from plan_slot where root_id = '584aae25-67a2-54c9-b314-2c9c0f6c78d9');

-- Chest-Supported Row into Main Day A with 3 work sets
with o as (select user_id from private.app_owner limit 1)
insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select '455672d4-337b-5208-80b3-a03a6c68a4d6'::uuid, o.user_id, t.id, '767f29a4-918b-5180-92a0-2f2ba5633811'::uuid, 4, 120, null,
  now(), now(), null
from o, public.template t
where t.name = 'Main Day A' and t.deleted_at is null and t.archived_at is null
on conflict (id) do nothing;

with o as (select user_id from private.app_owner limit 1)
insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select v.id::uuid, o.user_id, '455672d4-337b-5208-80b3-a03a6c68a4d6'::uuid, v.pos, 'working', null, null, null, null, null,
  now(), now(), null
from o, (values
  ('06ceca8d-2f6f-5778-be9c-13b136237e53', 1),
  ('c4dea90a-1c07-5f39-8df6-0a0d8590e4ce', 2),
  ('de7b4ad6-40fb-5e79-87f0-a99ca602f825', 3)
) v(id, pos)
on conflict (id) do nothing;

-- New order
update public.template_exercise te set position = o.position, updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from plan_slot s
  join plan_order o on o.workout = s.workout and o.root_id = s.root_id
 where te.id = s.slot_id and te.position is distinct from o.position;

-- Preacher Curl 120 s (Main Day A and B)
update public.template_exercise te set rest_s = 120, updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from plan_slot s
 where te.id = s.slot_id and s.root_id = '51217eb3-ec3e-52ea-8065-2e689d996e75' and te.rest_s is distinct from 120;

-- Note «Kein Zwischensatz vor dem Top Set»: Chest Press; Triceps Pushdown on the main exercise,
-- or on the variant used in Main Day A if that variant has its own note (it would hide the inherited one)
update public.exercise e
   set setup_note = case when coalesce(e.setup_note, '') = '' then 'Kein Zwischensatz vor dem Top Set'
                         else e.setup_note || E'\nKein Zwischensatz vor dem Top Set' end,
       updated_at = greatest(now(), e.updated_at + interval '1 ms')
 where coalesce(e.setup_note, '') not like '%Kein Zwischensatz%'
   and (e.id in ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0')
        or e.id in (select s.exercise_id from plan_slot s
                     where s.workout = 'Main Day A' and s.root_id = '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0'
                       and s.exercise_id <> s.root_id and coalesce(e.setup_note, '') <> ''));

commit;

-- Check
select 'ROW ' || string_agg(t.name || ' ' || te.position || ' ' || coalesce(p.name || ' / ', '') || e.name
       || ' ' || coalesce(coalesce(e.min_reps, p.min_reps)::text, '-') || '-' || coalesce(coalesce(e.target_reps, p.target_reps)::text, '-')
       || ' rest ' || coalesce(te.rest_s::text, '-')
       || ' sets ' || (select count(*) from public.template_set ts where ts.template_exercise_id = te.id and ts.deleted_at is null),
       ' || ' order by t.name, te.position)
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.name in ('Main Day A', 'Main Day B') and t.deleted_at is null and t.archived_at is null;

select 'ARCHIVE ' || string_agg(t.name || ': ' || (select count(*) from public.template_exercise te where te.template_id = t.id and te.deleted_at is null)
       || ' exercises, ' || (select count(*) from public.template_set ts join public.template_exercise te on te.id = ts.template_exercise_id
                              where te.template_id = t.id and te.deleted_at is null and ts.deleted_at is null) || ' sets', ' || ' order by t.name)
  from public.template t
 where t.name like 'Main Day _ (until 26 Oct)' and t.deleted_at is null and t.archived_at is not null;
