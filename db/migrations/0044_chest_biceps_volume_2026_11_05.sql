-- 0044_chest_biceps_volume_2026_11_05.sql
-- Data only, 5 November 2026 (Fitness-Coaching, confirmed by Rodrigo): more volume for chest and biceps, about 10 to 15
-- minutes per workout. Chest and biceps go from 6 to 9 work sets per week (Schoenfeld 2017, Pelland 2024: in the lower
-- volume range every set still adds a lot). Replaces item 1 (order Lateral Raise) of the bundle 0040; order by floor
-- with exactly one change stays:
--   Main Day A: Lat Pulldown, Leg Press, Lateral Raise, Butterfly (down), Incline Chest Press, Chest-Supported Row,
--               Triceps Pushdown Straight Bar, Preacher Curl (up)
--   Main Day B: Seated Row, Seated Leg Curl, Lateral Raise (down), Chest Press, Seated Dip, Preacher Curl, Cable Curl (up)
-- New slots use the existing exercises of 0039: 3 work sets each, 8-12, 90 s rest, no top set, no warm-up; start weight
-- as target weight in the template (used only without history): Butterfly 30 kg, Cable Curl 18 kg. Rodrigo skips them
-- in the workout when time is short. Warm-up and rep range belong to the exercise, so Butterfly and Cable Curl become
-- 8-12 and Butterfly loses its warm-up. Butterfly stands downstairs (Rodrigo). Notes in the form of 0043.
-- The Bonus Day is archived for now (Rodrigo: «Bonus Day streichen vorerst»); it stays restorable under Archive.
-- Main Day A and B before this change are kept as archived copies «Main Day A (until 5 Nov)», «Main Day B (until 5 Nov)».
-- Slots are found by workout name and exercise; any mismatch aborts. A running workout is not touched. Idempotent.

begin;

create temporary table plan_template on commit drop as
select t.id, t.user_id, t.name from public.template t
 where t.name in ('Main Day A', 'Main Day B') and t.deleted_at is null and t.archived_at is null;

do $$
begin
  if (select count(*) from plan_template) <> 2 then
    raise exception 'Expected exactly one active Main Day A and Main Day B';
  end if;
  if (select count(*) from public.exercise where deleted_at is null and id in (
        '0c25dc20-cf47-5ee1-8f49-7245ded33260',   -- Butterfly (Machine)
        '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3')) <> 2 then  -- Cable Curl
    raise exception 'Butterfly (Machine) or Cable Curl is missing';
  end if;
end
$$;

-- Archive copies of Main Day A and B, once (a repeated run finds them and copies nothing)
create temporary table plan_archive on commit drop as
select t.id as template_id, md5('archive-2026-11-05-template:' || t.id)::uuid as archive_id, t.user_id,
       t.name || ' (until 5 Nov)' as name
  from plan_template t
 where not exists (select 1 from public.template x where x.id = md5('archive-2026-11-05-template:' || t.id)::uuid);

insert into public.template (id, user_id, name, note, archived_at, created_at, updated_at, deleted_at)
select a.archive_id, a.user_id, a.name, null, now(), now(), now(), null from plan_archive a
on conflict (id) do nothing;

insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select md5('archive-2026-11-05-te:' || te.id)::uuid, te.user_id, a.archive_id, te.exercise_id, te.position, te.rest_s,
       te.comment, now(), now(), null
  from plan_archive a
  join public.template_exercise te on te.template_id = a.template_id and te.deleted_at is null
on conflict (id) do nothing;

insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select md5('archive-2026-11-05-ts:' || ts.id)::uuid, ts.user_id, md5('archive-2026-11-05-te:' || te.id)::uuid, ts.position,
       ts.set_type, ts.target_reps_min, ts.target_reps_max, ts.target_weight, ts.target_duration_s, ts.target_distance_km,
       now(), now(), null
  from plan_archive a
  join public.template_exercise te on te.template_id = a.template_id and te.deleted_at is null
  join public.template_set ts on ts.template_exercise_id = te.id and ts.deleted_at is null
on conflict (id) do nothing;

-- Exercise settings: 8-12, no top set; Butterfly downstairs and without warm-up; notes in the form of 0043
update public.exercise e
   set target_reps = 12, min_reps = 8, top_set = false, warm_up = false, floor = v.floor,
       setup_note = v.setup_note, focus_cue = v.focus_cue,
       updated_at = greatest(now(), e.updated_at + interval '1 ms')
  from (values
  ('0c25dc20-cf47-5ee1-8f49-7245ded33260'::uuid, 'unten', null,
   'Nach vorne zusammendrücken, nicht Reverse Fly · Ellbogen leicht gebeugt, langsam öffnen'),
  ('9ae34067-6ea2-544b-87c2-c17ec0a2f7f3'::uuid, 'oben', 'Gerade Stange · unterer Kabelzug',
   'Ellbogen am Körper, ohne Schwung')
  ) v(id, floor, setup_note, focus_cue)
 where e.id = v.id
   and (e.target_reps is distinct from 12 or e.min_reps is distinct from 8 or e.top_set is distinct from false
        or e.warm_up is distinct from false or e.floor is distinct from v.floor
        or e.setup_note is distinct from v.setup_note or e.focus_cue is distinct from v.focus_cue);

-- New slots with 3 work sets each; the rep range comes from the exercise (null in the set)
create temporary table new_slot (template text, exercise_id uuid, start_weight numeric) on commit drop;
insert into new_slot values
  ('Main Day A', '0c25dc20-cf47-5ee1-8f49-7245ded33260', 30),   -- Butterfly (Machine)
  ('Main Day B', '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3', 18);   -- Cable Curl

insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select md5('plan-2026-11-05-te:' || t.id || '/' || n.exercise_id)::uuid, t.user_id, t.id, n.exercise_id, 99, 90, null,
       now(), now(), null
  from plan_template t join new_slot n on n.template = t.name
on conflict (id) do nothing;

insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select md5('plan-2026-11-05-ts:' || t.id || '/' || n.exercise_id || '/' || s)::uuid, t.user_id,
       md5('plan-2026-11-05-te:' || t.id || '/' || n.exercise_id)::uuid, s, 'working', null, null, n.start_weight,
       null, null, now(), now(), null
  from plan_template t join new_slot n on n.template = t.name, generate_series(1, 3) s
on conflict (id) do nothing;

-- Order by floor with exactly one change
create temporary table plan_order (template text, label text, position int) on commit drop;
insert into plan_order values
  ('Main Day A', 'Lat Pulldown (Cable) / Classic Grip', 1),
  ('Main Day A', 'Leg Press', 2),
  ('Main Day A', 'Lateral Raise (Machine)', 3),
  ('Main Day A', 'Butterfly (Machine)', 4),
  ('Main Day A', 'Incline Chest Press (Dumbbell)', 5),
  ('Main Day A', 'Chest-Supported Row (Machine)', 6),
  ('Main Day A', 'Triceps Pushdown (Cable) / Straight Bar', 7),
  ('Main Day A', 'Preacher Curl (Machine)', 8),
  ('Main Day B', 'Seated Row (Cable)', 1),
  ('Main Day B', 'Seated Leg Curl (Machine)', 2),
  ('Main Day B', 'Lateral Raise (Machine)', 3),
  ('Main Day B', 'Chest Press (Machine)', 4),
  ('Main Day B', 'Seated Dip (Machine)', 5),
  ('Main Day B', 'Preacher Curl (Machine)', 6),
  ('Main Day B', 'Cable Curl', 7);

create temporary table slot_match on commit drop as
select te.id as slot_id, te.position as old_position, o.position as new_position
  from plan_template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
  join plan_order o on o.template = t.name and o.label = coalesce(p.name || ' / ', '') || e.name;

do $$
declare
  n_plan int := (select count(*) from plan_order);
  n_match int := (select count(*) from slot_match);
  n_slots int := (select count(*) from plan_template t
                   join public.template_exercise te on te.template_id = t.id and te.deleted_at is null);
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

-- Bonus Day archived for now (restorable under Archive)
update public.template t set archived_at = now(), updated_at = greatest(now(), t.updated_at + interval '1 ms')
 where t.name = 'Bonus Day' and t.deleted_at is null and t.archived_at is null;

commit;

-- Check
select 'ROW ' || t.name || ': ' || string_agg(te.position || ' ' || coalesce(p.name || ' / ', '') || e.name || ' '
         || (select count(*) from public.template_set s where s.template_exercise_id = te.id and s.deleted_at is null and s.set_type = 'working')
         || 'x ' || coalesce(te.rest_s::text, '-') || 's', ' | ' order by te.position)
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.deleted_at is null and t.archived_at is null
 group by t.name
union all
select 'ROW archived: ' || string_agg(name, ', ' order by name) from public.template
 where deleted_at is null and archived_at is not null and name in ('Bonus Day', 'Main Day A (until 5 Nov)', 'Main Day B (until 5 Nov)');
