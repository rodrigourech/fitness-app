-- 0056_push_ups_pull_down.sql
-- Data only, 23 November 2026 (Änderungsauftrag «Full Body A und B, Calisthenics statt Butterfly, Pull Down als
-- Alternative», Fitness-Coaching 23. November, confirmed by Rodrigo). Main exercises unchanged (plan frozen until
-- 10 December); one accessory is swapped, one is added. Past workouts are not touched.
--   1. Full Body A: Butterfly leaves the workout (the exercise stays); Push-Up 3 × 8–15, 90 s, without kg (exercise of
--      0055, Deficit Push-Up stays its alternative). Order: down Lat Pulldown, Leg Press, Lateral Raise; up Incline
--      Chest Press, Chest-Supported Row, Push-Up, Triceps Pushdown, Preacher Curl
--   2. Full Body B: Close-Grip Push-Up 2 × 8–15, 60 s, without kg, at the end (exercise of 0055)
--   3. New exercise «Pull Down (Machine)» (Technogym Pure Strength Pull Down, plates, two separate lever arms, weight
--      as the sum of both sides): lats; biceps, rear delts; 8–12, 120 s, top set and warm-up (at the back-off weight
--      like the other plate machines), weight step 10 kg (same plates as Chest Press; check after the first workout),
--      floor open. Alternative of Lat Pulldown (Cable) in both directions; the main exercise carries it, so both grips
--      (Classic Grip, Neutralgriff breit) offer it. Videos: the links of the Lat Pulldown until one for the machine is
--      found. Progression separate per exercise.
-- Chest stays at 9 work sets per week (Butterfly 3 → Push-Up 3), direct triceps 6 → 8 (Close-Grip Push-Up).
-- Fixed ids (md5); any mismatch aborts. Idempotent.

begin;

create temporary table plan on commit drop as
select
  (select id from public.template where name = 'Full Body A' and deleted_at is null and archived_at is null) as a_id,
  (select id from public.template where name = 'Full Body B' and deleted_at is null and archived_at is null) as b_id,
  (select id from public.exercise where name = 'Push-Up' and parent_id is null and deleted_at is null and equipment = 'bodyweight') as push_up,
  (select id from public.exercise where name = 'Close-Grip Push-Up' and parent_id is null and deleted_at is null and equipment = 'bodyweight') as close_grip,
  '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50'::uuid as lat_pulldown,          -- Lat Pulldown (Cable), main
  md5('pull-down-machine-2026-11-23')::uuid as pull_down,
  (select user_id from private.app_owner) as user_id;

do $$
declare p record;
begin
  select * into p from plan;
  if p.a_id is null or p.b_id is null then raise exception 'Full Body A or B not found (run 0055 first)'; end if;
  if p.push_up is null or p.close_grip is null then raise exception 'Push-Up or Close-Grip Push-Up (bodyweight) not found'; end if;
  if not exists (select 1 from public.exercise where id = p.lat_pulldown and deleted_at is null) then raise exception 'Lat Pulldown (Cable) not found'; end if;
  if (select count(*) from public.template_exercise te where te.template_id = p.a_id and te.deleted_at is null and te.exercise_id in (
        '377d7bce-a5f5-5da6-856e-3a695f79dfe5',   -- Lateral Raise (Machine)
        '6144fd76-baee-5c78-a409-4ce968051388',   -- Leg Press
        '51217eb3-ec3e-52ea-8065-2e689d996e75',   -- Preacher Curl (Machine)
        '5fc983b7-01cb-4914-a87c-574be071953d',   -- Triceps Pushdown (Cable) / V-Grip
        'd3e01b25-c5c1-5bb1-a543-830fb226fc75'))  -- Lat Pulldown (Cable) / Classic Grip
      <> 5 then
    raise exception 'Full Body A does not have the expected exercises';
  end if;
end
$$;

-- 3. Pull Down (Machine)
insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, weight_step, default_rest_s, setup_note, target_reps, min_reps, warm_up, top_set, created_at, updated_at, deleted_at)
select p.pull_down, p.user_id, null, 'Pull Down (Machine)', 'plate_loaded', '{lats}'::text[], '{biceps,rear_delts}'::text[],
       'weight_reps', false, 10, 120,
       E'Technogym Pure Strength Pull Down, zwei getrennte Hebelarme, Gewicht als Summe beider Seiten\nSitz so einstellen, dass die Knie fest unter den Rollen sind und die Drehachse auf Schulterhöhe liegt\nGriffe oben fassen, Brust raus, Ellbogen nach unten hinten zur Hüfte ziehen, oben kontrolliert strecken',
       12, 8, true, true, now(), now(), null
  from plan p
on conflict (id) do nothing;

update public.exercise e
   set alternative_id = v.alt, updated_at = greatest(now(), e.updated_at + interval '1 ms')
  from (select lat_pulldown as id, pull_down as alt from plan union all select pull_down, lat_pulldown from plan) v
 where e.id = v.id and e.alternative_id is distinct from v.alt;

-- Videos of the Lat Pulldown (main and grips) for the machine, until a Pure Strength video is found
insert into public.exercise_link (id, user_id, exercise_id, url, title, created_at, updated_at, deleted_at)
select md5('pull-down-machine-2026-11-23-link:' || l.url)::uuid, p.user_id, p.pull_down, l.url, l.title, now(), now(), null
  from plan p
  join public.exercise e on (e.id = p.lat_pulldown or e.parent_id = p.lat_pulldown) and e.deleted_at is null
  join public.exercise_link l on l.exercise_id = e.id and l.deleted_at is null
 where not exists (select 1 from public.exercise_link x where x.exercise_id = p.pull_down and x.url = l.url and x.deleted_at is null)
on conflict (id) do nothing;

-- Push-Up and Close-Grip Push-Up: notes of the order (no warm-up, no top set, no weight step, as in 0055)
update public.exercise e
   set setup_note = v.note, updated_at = greatest(now(), e.updated_at + interval '1 ms')
  from (select push_up as id, E'Normale Liegestütze am Boden, solange die Griffe fehlen\nHände etwas breiter als die Schultern, Ellbogen etwa 45 Grad' as note from plan
        union all select close_grip, 'Hände schulterbreit, Ellbogen eng am Körper' from plan) v
 where e.id = v.id and e.setup_note is distinct from v.note;

-- 1. Full Body A: Butterfly out (slot and its sets), Push-Up in at position 6
update public.template_set ts
   set deleted_at = now(), updated_at = greatest(now(), ts.updated_at + interval '1 ms')
  from public.template_exercise te, plan p
 where ts.template_exercise_id = te.id and te.template_id = p.a_id and te.deleted_at is null and ts.deleted_at is null
   and te.exercise_id = '0c25dc20-cf47-5ee1-8f49-7245ded33260';   -- Butterfly (Machine)
update public.template_exercise te
   set deleted_at = now(), updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from plan p
 where te.template_id = p.a_id and te.deleted_at is null and te.exercise_id = '0c25dc20-cf47-5ee1-8f49-7245ded33260';

insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select md5('push-ups-2026-11-23-te:a')::uuid, p.user_id, p.a_id, p.push_up, 6, 90, null::text, now(), now(), null::timestamptz from plan p
union all
select md5('push-ups-2026-11-23-te:b')::uuid, p.user_id, p.b_id, p.close_grip, 8, 60, null, now(), now(), null from plan p
on conflict (id) do nothing;

insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select md5('push-ups-2026-11-23-ts:' || v.slot || ':' || n)::uuid, p.user_id, md5('push-ups-2026-11-23-te:' || v.slot)::uuid,
       n, 'working', 8, 15, null, null, null, now(), now(), null
  from plan p cross join (values ('a', 3), ('b', 2)) v(slot, sets) cross join lateral generate_series(1, v.sets) n
on conflict (id) do nothing;

-- Order of Full Body A (Push-Up between Chest-Supported Row and Triceps Pushdown) and B (Close-Grip Push-Up last)
update public.template_exercise te
   set position = v.position, updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from plan p, (values
    ('d3e01b25-c5c1-5bb1-a543-830fb226fc75'::uuid, 1),   -- Lat Pulldown (Cable) / Classic Grip
    ('6144fd76-baee-5c78-a409-4ce968051388'::uuid, 2),   -- Leg Press
    ('377d7bce-a5f5-5da6-856e-3a695f79dfe5'::uuid, 3),   -- Lateral Raise (Machine)
    (null::uuid, 4),                                     -- Incline Chest Press (found below)
    (null::uuid, 5),                                     -- Chest-Supported Row (found below)
    ('5fc983b7-01cb-4914-a87c-574be071953d'::uuid, 7),   -- Triceps Pushdown (Cable) / V-Grip
    ('51217eb3-ec3e-52ea-8065-2e689d996e75'::uuid, 8)    -- Preacher Curl (Machine)
  ) v(exercise_id, position)
 where te.template_id = p.a_id and te.deleted_at is null and te.exercise_id = v.exercise_id and te.position <> v.position;

update public.template_exercise te
   set position = v.position, updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from plan p, public.exercise e, (values ('Incline Chest Press', 4), ('Chest-Supported Row', 5)) v(prefix, position)
 where te.template_id = p.a_id and te.deleted_at is null and e.id = te.exercise_id and e.name like v.prefix || '%'
   and te.position <> v.position;

do $$
begin
  if (select string_agg(te.position::text, ',' order by te.position) from public.template_exercise te, plan p
       where te.template_id = p.a_id and te.deleted_at is null) <> '1,2,3,4,5,6,7,8' then
    raise exception 'Full Body A positions are not 1 to 8';
  end if;
  if (select string_agg(te.position::text, ',' order by te.position) from public.template_exercise te, plan p
       where te.template_id = p.b_id and te.deleted_at is null) <> '1,2,3,4,5,6,7,8' then
    raise exception 'Full Body B positions are not 1 to 8';
  end if;
end
$$;

commit;

-- Check
select t.name || ' ' || string_agg(te.position || ' ' || coalesce(p.name || ' / ', '') || e.name || ' ' ||
         (select count(*) from public.template_set s where s.template_exercise_id = te.id and s.deleted_at is null) || 'x',
         ' | ' order by te.position) as plan
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.name in ('Full Body A', 'Full Body B') and t.deleted_at is null and t.archived_at is null
 group by t.name
union all
select 'PULL DOWN alt ' || a.name || ' · videos ' || (select count(*) from public.exercise_link l where l.exercise_id = e.id and l.deleted_at is null)
       || ' · back ' || (select b.name from public.exercise b where b.id = a.alternative_id)
  from public.exercise e join public.exercise a on a.id = e.alternative_id
 where e.id = md5('pull-down-machine-2026-11-23')::uuid;
