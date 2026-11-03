-- 0039_bonus_day_2026_11_03.sql
-- Data only, 3 November 2026 (proposal Claude, accepted by Rodrigo; to be reviewed by him later):
-- The Bonus Day repeated most of Main Day A (Lat Pulldown, Leg Press, Pushdown, Curl). New: a gap filler with little
-- overall fatigue, because the day is irregular and may lie 24 to 48 h before Main Day A or B. Priorities chest, arms,
-- shoulders, back; Leg Press and Bicycle out (leg volume stays low on purpose, warm-up set instead of Bicycle).
--   1 Butterfly (Machine)            3 x 10-15   90 s  chest           (new, warm-up set as first exercise)
--   2 Straight-Arm Pulldown (Cable)  3 x 10-15   90 s  lats            (new)
--   3 Face Pull (Cable)              3 x 12-15   60 s  rear delts      (new)
--   4 Lateral Raise (Machine)        3            60 s  side delts      (existing settings)
--   5 Cable Curl                     3 x 10-15   60 s  biceps          (new, alternating with 6)
--   6 Triceps Pushdown, Straight Bar 3            60 s  triceps         (existing settings, alternating with 5)
--   7 Lying Leg Curl (Machine)       3            90 s  hamstrings      (existing, may be skipped)
-- Weekly work sets with the Bonus Day: chest 9, back about 12 plus rear delts 3, side delts 9, biceps 9, triceps 9,
-- hamstrings 6, quads 3 (Schoenfeld 2017, Pelland 2024: largest gain below about 10 sets per muscle and week).
-- The previous Bonus Day is archived as «Bonus Day (until 3 Nov)» (restorable); the active Bonus Day keeps its id.
-- New exercises without weight step and without target weights: the start weight is entered once in the app.
-- Idempotent. Aborts without changes if the Bonus Day is missing. A running workout is not touched.

begin;

create temporary table bonus on commit drop as
select t.id, t.user_id from public.template t
 where t.name = 'Bonus Day' and t.deleted_at is null and t.archived_at is null;

do $$
begin
  if (select count(*) from bonus) <> 1 then
    raise exception 'Expected exactly one active Bonus Day';
  end if;
  if (select count(*) from public.exercise where deleted_at is null and id in (
        '377d7bce-a5f5-5da6-856e-3a695f79dfe5',   -- Lateral Raise (Machine)
        'c6473665-753c-5771-ba78-c6e0d8c1c89b',   -- Triceps Pushdown (Cable) / Straight Bar
        'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7')) <> 3 then  -- Lying Leg Curl (Machine)
    raise exception 'An existing exercise of the new Bonus Day is missing';
  end if;
end
$$;

-- Archive copy of the current Bonus Day, once (a repeated run finds it and copies nothing)
create temporary table bonus_archive on commit drop as
select b.id as template_id, md5('archive-2026-11-03-template:' || b.id)::uuid as archive_id, b.user_id
  from bonus b
 where not exists (select 1 from public.template x where x.id = md5('archive-2026-11-03-template:' || b.id)::uuid);

insert into public.template (id, user_id, name, note, archived_at, created_at, updated_at, deleted_at)
select a.archive_id, a.user_id, 'Bonus Day (until 3 Nov)', null, now(), now(), now(), null from bonus_archive a
on conflict (id) do nothing;

insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select md5('archive-2026-11-03-te:' || te.id)::uuid, te.user_id, a.archive_id, te.exercise_id, te.position, te.rest_s,
       te.comment, now(), now(), null
  from bonus_archive a
  join public.template_exercise te on te.template_id = a.template_id and te.deleted_at is null
on conflict (id) do nothing;

insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select md5('archive-2026-11-03-ts:' || ts.id)::uuid, ts.user_id, md5('archive-2026-11-03-te:' || te.id)::uuid, ts.position,
       ts.set_type, ts.target_reps_min, ts.target_reps_max, ts.target_weight, ts.target_duration_s, ts.target_distance_km,
       now(), now(), null
  from bonus_archive a
  join public.template_exercise te on te.template_id = a.template_id and te.deleted_at is null
  join public.template_set ts on ts.template_exercise_id = te.id and ts.deleted_at is null
on conflict (id) do nothing;

-- New exercises
with o as (select user_id from private.app_owner limit 1)
insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, default_rest_s, setup_note, focus_muscles, focus_cue, target_reps, min_reps, warm_up, top_set,
  weight_step, created_at, updated_at, deleted_at)
select v.id::uuid, o.user_id, null, v.name, v.equipment, v.prim::text[], v.sec::text[], 'weight_reps', false, v.rest,
       null, v.focus::text[], v.cue, v.max_reps, v.min_reps, v.warm, false, null, now(), now(), null
  from o, (values
  ('0c25dc20-cf47-5ee1-8f49-7245ded33260', 'Butterfly (Machine)', 'pin_loaded', '{chest}', '{front_delts}', 90,
   '{chest-upper,chest-lower}', 'Ellbogen leicht gebeugt, Griffe vor der Brust zusammenführen, langsam öffnen', 15, 10, true),
  ('a4c3f5d4-2d79-5c23-96aa-85dd6ed80253', 'Straight-Arm Pulldown (Cable)', 'cable', '{lats}', '{triceps}', 90,
   '{lats-upper,lats-mid,lats-lower}', 'Arme fast gestreckt, Stange im Bogen bis zu den Oberschenkeln', 15, 10, false),
  ('ae9d70ce-9d2f-5bc1-88c0-8f555329eab9', 'Face Pull (Cable)', 'cable', '{rear_delts}', '{upper_back,traps}', 60,
   '{deltoid-rear,traps-mid}', 'Seil auf Augenhöhe, zum Gesicht ziehen, Ellbogen hoch und nach aussen', 15, 12, false),
  ('9ae34067-6ea2-544b-87c2-c17ec0a2f7f3', 'Cable Curl', 'cable', '{biceps}', '{forearms}', 60,
   null, 'Ellbogen am Körper, ohne Schwung', 15, 10, false)
  ) v(id, name, equipment, prim, sec, rest, focus, cue, max_reps, min_reps, warm)
on conflict (id) do nothing;

-- Old slots and their sets out of the active Bonus Day (exercises and history stay)
create temporary table bonus_plan (position int, exercise_id uuid, rest_s int, reps_min int, reps_max int, comment text) on commit drop;
insert into bonus_plan values
  (1, '0c25dc20-cf47-5ee1-8f49-7245ded33260', 90, 10, 15, null),                          -- Butterfly (Machine)
  (2, 'a4c3f5d4-2d79-5c23-96aa-85dd6ed80253', 90, 10, 15, null),                          -- Straight-Arm Pulldown (Cable)
  (3, 'ae9d70ce-9d2f-5bc1-88c0-8f555329eab9', 60, 12, 15, null),                          -- Face Pull (Cable)
  (4, '377d7bce-a5f5-5da6-856e-3a695f79dfe5', 60, null, null, null),                      -- Lateral Raise (Machine)
  (5, '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3', 60, 10, 15, 'Im Wechsel mit Pushdown'),     -- Cable Curl
  (6, 'c6473665-753c-5771-ba78-c6e0d8c1c89b', 60, null, null, 'Im Wechsel mit Cable Curl'), -- Triceps Pushdown / Straight Bar
  (7, 'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7', 90, null, null, 'Darf entfallen');          -- Lying Leg Curl (Machine)

update public.template_set ts set deleted_at = now(), updated_at = greatest(now(), ts.updated_at + interval '1 ms')
  from public.template_exercise te, bonus b
 where te.id = ts.template_exercise_id and te.template_id = b.id and ts.deleted_at is null and te.deleted_at is null
   and te.id <> md5('bonus-2026-11-03-te:' || te.position)::uuid;
update public.template_exercise te set deleted_at = now(), updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from bonus b
 where te.template_id = b.id and te.deleted_at is null and te.id <> md5('bonus-2026-11-03-te:' || te.position)::uuid;

-- New slots with 3 work sets each; the rep range of existing exercises stays their own (null in the set)
insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select md5('bonus-2026-11-03-te:' || p.position)::uuid, b.user_id, b.id, p.exercise_id, p.position, p.rest_s, p.comment,
       now(), now(), null
  from bonus b, bonus_plan p
on conflict (id) do nothing;

insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select md5('bonus-2026-11-03-ts:' || p.position || '/' || n)::uuid, b.user_id, md5('bonus-2026-11-03-te:' || p.position)::uuid,
       n, 'working', p.reps_min, p.reps_max, null, null, null, now(), now(), null
  from bonus b, bonus_plan p, generate_series(1, 3) n
on conflict (id) do nothing;

commit;

-- Check
select 'ROW ' || t.name || ': ' || string_agg(te.position || ' ' || coalesce(p.name || ' / ', '') || e.name || ' '
         || (select count(*) from public.template_set s where s.template_exercise_id = te.id and s.deleted_at is null and s.set_type = 'working')
         || 'x ' || coalesce(te.rest_s::text, '-') || 's', ' | ' order by te.position)
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.name in ('Bonus Day', 'Bonus Day (until 3 Nov)') and t.deleted_at is null
 group by t.name;
