-- 0040_order_floor_fixes_2026_11_05.sql
-- Data only, 5 November 2026 (order from Fitness-Coaching):
-- 1. Lateral Raise (Machine) stands downstairs, not upstairs. Order by floor with exactly one change:
--    Main Day A: Lat Pulldown, Leg Press, Lateral Raise (down), Incline Chest Press, Chest-Supported Row, Pushdown, Preacher Curl (up)
--    Main Day B: Seated Row, Seated Leg Curl, Lateral Raise (down), Chest Press, Seated Dip, Preacher Curl (up)
--    Bonus Day: Butterfly, Straight-Arm Pulldown, Face Pull, Cable Curl, Pushdown (up), Lateral Raise, Lying Leg Curl (down);
--    the upstairs block stays first so Butterfly keeps the warm-up and Lying Leg Curl («darf entfallen») stays last.
--    Sets, rests and alternatives unchanged. Slots are found by workout name and exercise; any mismatch aborts.
-- 2. Main Day B of 29 October (started 12:08:32 UTC), Chest Press (Machine): set 4, working, 40 kg x 8 was done but not
--    ticked and was discarded on finishing. Restored with completed_at = end of the workout (+320 kg volume).
-- 3. Main Day A, Incline Chest Press (Dumbbell): rest 120 s like the other compound exercises if still empty.
-- A running workout is not touched. Idempotent.

begin;

create temporary table plan_order (template text, label text, position int) on commit drop;
insert into plan_order values
  ('Main Day A', 'Lat Pulldown (Cable) / Classic Grip', 1),
  ('Main Day A', 'Leg Press', 2),
  ('Main Day A', 'Lateral Raise (Machine)', 3),
  ('Main Day A', 'Incline Chest Press (Dumbbell)', 4),
  ('Main Day A', 'Chest-Supported Row (Machine)', 5),
  ('Main Day A', 'Triceps Pushdown (Cable) / Straight Bar', 6),
  ('Main Day A', 'Preacher Curl (Machine)', 7),
  ('Main Day B', 'Seated Row (Cable)', 1),
  ('Main Day B', 'Seated Leg Curl (Machine)', 2),
  ('Main Day B', 'Lateral Raise (Machine)', 3),
  ('Main Day B', 'Chest Press (Machine)', 4),
  ('Main Day B', 'Seated Dip (Machine)', 5),
  ('Main Day B', 'Preacher Curl (Machine)', 6),
  ('Bonus Day', 'Butterfly (Machine)', 1),
  ('Bonus Day', 'Straight-Arm Pulldown (Cable)', 2),
  ('Bonus Day', 'Face Pull (Cable)', 3),
  ('Bonus Day', 'Cable Curl', 4),
  ('Bonus Day', 'Triceps Pushdown (Cable) / Straight Bar', 5),
  ('Bonus Day', 'Lateral Raise (Machine)', 6),
  ('Bonus Day', 'Lying Leg Curl (Machine)', 7);

create temporary table slot_match on commit drop as
select te.id as slot_id, te.position as old_position, o.position as new_position, o.template, o.label
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
  join plan_order o on o.template = t.name and o.label = coalesce(p.name || ' / ', '') || e.name
 where t.deleted_at is null and t.archived_at is null;

do $$
declare
  n_plan int := (select count(*) from plan_order);
  n_match int := (select count(*) from slot_match);
  n_slots int := (select count(*) from public.template t join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
                   where t.deleted_at is null and t.archived_at is null and t.name in ('Main Day A', 'Main Day B', 'Bonus Day'));
begin
  if n_match <> n_plan or n_slots <> n_plan then
    raise exception 'Order does not match the workouts: % planned, % matched, % slots', n_plan, n_match, n_slots;
  end if;
end
$$;

update public.template_exercise te
   set position = m.new_position, updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from slot_match m
 where te.id = m.slot_id and te.position <> m.new_position;

-- 2. Restore the discarded Chest Press set of 29 October
do $$
declare
  n int;
begin
  select count(*) into n
    from public.workout_set s
    join public.workout_exercise we on we.id = s.workout_exercise_id
    join public.workout w on w.id = we.workout_id
   where w.started_at between timestamptz '2026-10-29 12:08:32+00' and timestamptz '2026-10-29 12:08:33+00'
     and w.deleted_at is null and w.finished_at is not null
     and we.exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380' and we.deleted_at is null
     and s.position = 4 and s.set_type = 'working' and s.weight = 40 and s.reps = 8;
  if n <> 1 then
    raise exception 'Expected exactly one Chest Press set 40 x 8 at position 4 on 29 October, found %', n;
  end if;
end
$$;

update public.workout_set s
   set deleted_at = null, completed_at = w.finished_at, updated_at = greatest(now(), s.updated_at + interval '1 ms')
  from public.workout_exercise we, public.workout w
 where we.id = s.workout_exercise_id and w.id = we.workout_id
   and w.started_at between timestamptz '2026-10-29 12:08:32+00' and timestamptz '2026-10-29 12:08:33+00'
   and we.exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380'
   and s.position = 4 and s.set_type = 'working' and s.weight = 40 and s.reps = 8
   and (s.deleted_at is not null or s.completed_at is null);

-- 3. Rest of the Incline Chest Press (Dumbbell) in Main Day A
update public.template_exercise te
   set rest_s = 120, updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from public.template t
 where t.id = te.template_id and t.name = 'Main Day A' and t.deleted_at is null and t.archived_at is null
   and te.deleted_at is null and te.exercise_id = '7ca1c0fa-f1c7-576b-a946-f1832f3dcb14' and te.rest_s is null;

commit;

-- Check
select 'ROW ' || t.name || ': ' || string_agg(te.position || ' ' || coalesce(p.name || ' / ', '') || e.name || ' ' || coalesce(te.rest_s::text, '-') || 's', ' | ' order by te.position)
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.deleted_at is null and t.archived_at is null and t.name in ('Main Day A', 'Main Day B', 'Bonus Day')
 group by t.name
union all
select 'ROW chest press 29 Oct: ' || string_agg(s.position || ' ' || s.set_type || ' ' || s.weight || 'x' || s.reps
         || case when s.deleted_at is null then '' else ' DELETED' end || case when s.completed_at is null then ' open' else '' end, ', ' order by s.position)
  from public.workout_set s
  join public.workout_exercise we on we.id = s.workout_exercise_id
  join public.workout w on w.id = we.workout_id
 where w.started_at between timestamptz '2026-10-29 12:08:32+00' and timestamptz '2026-10-29 12:08:33+00'
   and we.exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380';
