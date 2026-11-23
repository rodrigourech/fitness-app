-- 0055_calisthenics_bonus.sql
-- Data only, 23 November 2026 (Änderungsauftrag «Calisthenics Bonus», Fitness-Coaching 22./23. November, confirmed by
-- Rodrigo):
--   1. Main Day A and Main Day B are renamed «Full Body A» and «Full Body B» (both are full-body days; with the third
--      workout all three names fit in one row of the picker on Home at 390 px). Content unchanged, the plan stays frozen
--      until 10 December. Past workouts keep their name snapshot «Main Day A/B»; the archived copies stay as they are.
--   2. New workout «Calisthenics Bonus», optional third day, bodyweight only, about 45 minutes:
--        Pull-Up 4 × 3–6 (120 s), Dip (Parallel Bars) 3 × 5–10 (120 s), Inverted Row 3 × 8–12 (90 s),
--        Deficit Push-Up 3 × 8–15 (90 s, alternative Push-Up), Close-Grip Push-Up 2 × 8–15 (60 s),
--        Hanging Knee Raise 3 × 8–15 (60 s), Plank 2 × 30–60 s (60 s)
--      Work sets only (no warm-up set, no top set). Rep exercises get equipment «bodyweight»: the app shows no kg and
--      «Next stage» instead of «Increase weight». Plank is timed; goal 60 s in the template (next stage when every set
--      held 60 s). Existing exercises are reused when an active main exercise with the same name exists (never the
--      machine «Seated Dip»). Deficit Push-Up and Push-Up are alternatives of each other, progression separate.
--      Videos as links (titles fill themselves in the app, decision 19 November 2026).
-- The archived «Bonus Day» is not touched. Fixed ids (md5), idempotent; a running workout is not touched.

begin;

create temporary table o on commit drop as select user_id from private.app_owner;

do $$
begin
  if (select count(*) from o) <> 1 then
    raise exception 'Expected exactly one app owner';
  end if;
  if (select count(*) from public.template where deleted_at is null and archived_at is null
        and name in ('Main Day A', 'Main Day B', 'Full Body A', 'Full Body B')) <> 2 then
    raise exception 'Expected exactly one active Main Day A and Main Day B (or Full Body A and B)';
  end if;
end
$$;

-- 1. Rename
update public.template t
   set name = v.new_name, updated_at = greatest(now(), t.updated_at + interval '1 ms')
  from (values ('Main Day A', 'Full Body A'), ('Main Day B', 'Full Body B')) v(old_name, new_name)
 where t.name = v.old_name and t.deleted_at is null and t.archived_at is null;

-- 2. Exercises: key, name, synonyms for reuse, muscles, tracking, rest, rep range, note (German, one line per hint)
create temporary table cali on commit drop as
select v.*, md5('calisthenics-2026-11-23-ex:' || v.key)::uuid as new_id, null::uuid as id
  from (values
  ('pull_up', 'Pull-Up', array['pull-up', 'pull up', 'pullup', 'pull-ups', 'pull ups', 'klimmzug', 'klimmzüge'],
   '{lats}'::text[], '{biceps,upper_back}'::text[], 'weight_reps', 120, 6, 3,
   E'Obergriff schulterbreit\nStufen: 0 Wdh Negative (hochspringen, 5 s ablassen), mit Band, Cluster 2–3 Wdh, frei 3 × 5–8'),
  ('dip', 'Dip (Parallel Bars)', array['dip (parallel bars)', 'dip', 'dips', 'parallel bar dip', 'parallel bar dips', 'barrenstütz'],
   '{chest,triceps}'::text[], '{front_delts}'::text[], 'weight_reps', 120, 10, 5,
   E'Oberarm bis parallel, leicht nach vorne lehnen\nUnter 4 Wdh: Negative in 4 s'),
  ('inverted_row', 'Inverted Row', array['inverted row', 'inverted rows', 'australian pull-up', 'australian pull-ups'],
   '{upper_back,lats}'::text[], '{biceps,rear_delts}'::text[], 'weight_reps', 90, 12, 8,
   E'Stange auf Hüfthöhe (Smith oder Rack)\nSteiler leichter, Füsse auf Bank schwerer\nOhne Stange: 2 Sätze Negative im Pull-Up'),
  ('deficit_push_up', 'Deficit Push-Up', array['deficit push-up', 'deficit push up', 'deficit push-ups', 'deficit pushup'],
   '{chest}'::text[], '{triceps,front_delts}'::text[], 'weight_reps', 90, 15, 8,
   E'Auf Push-up-Griffen, Scheiben oder Steps, Brust tiefer als die Hände\nAb 3 × 15: Band über dem Rücken'),
  ('push_up', 'Push-Up', array['push-up', 'push up', 'pushup', 'push-ups', 'push ups', 'pushups', 'liegestütz', 'liegestütze'],
   '{chest}'::text[], '{triceps,front_delts}'::text[], 'weight_reps', 90, 15, 8,
   E'Normale Liegestütze am Boden, solange die Griffe fehlen\nHände etwas breiter als die Schultern, Ellbogen etwa 45 Grad'),
  ('close_grip_push_up', 'Close-Grip Push-Up', array['close-grip push-up', 'close grip push-up', 'close-grip push up', 'close grip push up', 'close-grip push-ups'],
   '{triceps}'::text[], '{chest,front_delts}'::text[], 'weight_reps', 60, 15, 8,
   E'Hände schulterbreit, Ellbogen eng am Körper'),
  ('knee_raise', 'Hanging Knee Raise', array['hanging knee raise', 'hanging knee raises', 'knee raise (hanging)'],
   '{abs}'::text[], '{}'::text[], 'weight_reps', 60, 15, 8,
   E'Am Turm, ohne Schwung, Becken einrollen\nAb 3 × 15: Beine gestreckt'),
  ('plank', 'Plank', array['plank', 'planks', 'unterarmstütz'],
   '{abs}'::text[], '{}'::text[], 'duration', 60, null, null,
   E'2 × 30–60 s\nGesäss anspannen, Rücken gerade\nAb 60 s: Hollow Hold')
  ) v(key, name, synonyms, muscles_primary, muscles_secondary, tracking_type, rest_s, target_reps, min_reps, setup_note);

-- Reuse an active main exercise with one of the names (oldest first); the machine Seated Dip never matches
update cali c
   set id = coalesce((
     select e.id from public.exercise e
      where e.deleted_at is null and e.parent_id is null and lower(e.name) = any (c.synonyms)
        and e.id <> '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8'
      order by (e.id = c.new_id) desc, e.created_at
      limit 1), c.new_id);

insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, default_rest_s, setup_note, target_reps, min_reps, warm_up, top_set, created_at, updated_at, deleted_at)
select c.id, o.user_id, null, c.name, case when c.tracking_type = 'weight_reps' then 'bodyweight' end, c.muscles_primary,
       c.muscles_secondary, c.tracking_type, false, c.rest_s, c.setup_note, c.target_reps, c.min_reps, false, false,
       now(), now(), null
  from cali c cross join o
 where c.id = c.new_id
on conflict (id) do nothing;

-- Reused exercises: bodyweight, rest and rep range of the plan, note only where none exists yet; no warm-up, no top set
update public.exercise e
   set equipment = case when c.tracking_type = 'weight_reps' then 'bodyweight' else e.equipment end,
       default_rest_s = c.rest_s, target_reps = c.target_reps, min_reps = c.min_reps, warm_up = false, top_set = false,
       weight_step = case when c.tracking_type = 'weight_reps' then null else e.weight_step end,
       setup_note = coalesce(e.setup_note, c.setup_note),
       updated_at = greatest(now(), e.updated_at + interval '1 ms')
  from cali c
 where e.id = c.id and c.id <> c.new_id
   and (e.equipment is distinct from case when c.tracking_type = 'weight_reps' then 'bodyweight' else e.equipment end
        or e.default_rest_s is distinct from c.rest_s or e.target_reps is distinct from c.target_reps
        or e.min_reps is distinct from c.min_reps or e.warm_up is distinct from false or e.top_set is distinct from false
        or e.setup_note is null);

do $$
begin
  if (select count(*) from cali c join public.exercise e on e.id = c.id and e.deleted_at is null
       where e.tracking_type = c.tracking_type) <> 8 then
    raise exception 'A reused exercise has another tracking type than planned';
  end if;
end
$$;

-- Deficit Push-Up and Push-Up are alternatives of each other
update public.exercise e
   set alternative_id = v.alt, updated_at = greatest(now(), e.updated_at + interval '1 ms')
  from (select a.id, b.id as alt from cali a, cali b
         where (a.key, b.key) in (('deficit_push_up', 'push_up'), ('push_up', 'deficit_push_up'))) v
 where e.id = v.id and e.alternative_id is distinct from v.alt;

-- Videos (YouTube); an existing link with the same URL is kept
insert into public.exercise_link (id, user_id, exercise_id, url, title, created_at, updated_at, deleted_at)
select md5('calisthenics-2026-11-23-link:' || v.key || ':' || v.url)::uuid, o.user_id, c.id, v.url, null, now(), now(), null
  from (values
  ('pull_up', 'https://www.youtube.com/watch?v=GSYYXRjtkUQ'),            -- Jeremy Ethier
  ('pull_up', 'https://www.youtube.com/watch?v=-ZIpSoTRsuE'),            -- Zack Henderson, scapula pull-ups (warm-up)
  ('dip', 'https://www.youtube.com/watch?v=yN6Q1UI_xkE'),                -- Jeff Nippard
  ('inverted_row', 'https://www.youtube.com/watch?v=Fl0UMfdEzsE'),       -- Zack Henderson
  ('deficit_push_up', 'https://www.youtube.com/watch?v=gLsarcKlS6c'),    -- Jeremy Ethier
  ('push_up', 'https://www.youtube.com/watch?v=MO10KOoQx5E'),            -- Jeremy Ethier
  ('push_up', 'https://www.youtube.com/watch?v=qoZ6NGEq8_4'),            -- Major Calisthenics
  ('close_grip_push_up', 'https://www.youtube.com/watch?v=aWixj7ey758'), -- J2FIT Strength & Conditioning
  ('knee_raise', 'https://www.youtube.com/watch?v=EYe6dc_i4L0'),         -- Zack Henderson
  ('plank', 'https://www.youtube.com/watch?v=lismOShjHnA')               -- FitnessFAQs
  ) v(key, url)
  join cali c on c.key = v.key
  cross join o
 where not exists (select 1 from public.exercise_link l where l.exercise_id = c.id and l.url = v.url and l.deleted_at is null)
on conflict (id) do nothing;

-- 3. Workout «Calisthenics Bonus»
insert into public.template (id, user_id, name, note, archived_at, created_at, updated_at, deleted_at)
select md5('calisthenics-2026-11-23-template')::uuid, o.user_id, 'Calisthenics Bonus',
       E'Warm-up 1 Runde: 10 Scapula-Pull-ups und 10 lockere Liegestütze.\n2 Wiederholungen in Reserve lassen (eine mehr als an A und B).\nErster Termin ist Testtag: bei Klimmzug und Dips im ersten Satz maximal mit 1 in Reserve, Zahl notieren.',
       null, now(), now(), null
  from o
on conflict (id) do nothing;

create temporary table slot on commit drop as
select md5('calisthenics-2026-11-23-te:' || v.key)::uuid as te_id, c.id as exercise_id, v.*
  from (values
  ('pull_up', 1, 4, 3, 6, null::int, 120),
  ('dip', 2, 3, 5, 10, null, 120),
  ('inverted_row', 3, 3, 8, 12, null, 90),
  ('deficit_push_up', 4, 3, 8, 15, null, 90),
  ('close_grip_push_up', 5, 2, 8, 15, null, 60),
  ('knee_raise', 6, 3, 8, 15, null, 60),
  ('plank', 7, 2, null, null, 60, 60)
  ) v(key, position, sets, reps_min, reps_max, duration_s, rest_s)
  join cali c on c.key = v.key;

insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select s.te_id, o.user_id, md5('calisthenics-2026-11-23-template')::uuid, s.exercise_id, s.position, s.rest_s, null,
       now(), now(), null
  from slot s cross join o
on conflict (id) do nothing;

insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select md5('calisthenics-2026-11-23-ts:' || s.key || ':' || n)::uuid, o.user_id, s.te_id, n, 'working', s.reps_min, s.reps_max,
       null, s.duration_s, null, now(), now(), null
  from slot s cross join o cross join lateral generate_series(1, s.sets) n
on conflict (id) do nothing;

commit;

-- Check
select 'TEMPLATE ' || string_agg(name, ' | ' order by name) from public.template
 where deleted_at is null and archived_at is null;
select 'SLOT ' || te.position || ' ' || e.name || coalesce(' [' || e.equipment || ']', '') || ' ' || count(ts.id) || ' × '
       || coalesce(min(ts.target_reps_min) || '–' || max(ts.target_reps_max), max(ts.target_duration_s) || ' s') || ' · ' || te.rest_s || ' s'
       || coalesce(' · alt ' || a.name, '') || ' · videos ' || (select count(*) from public.exercise_link l where l.exercise_id = e.id and l.deleted_at is null)
  from public.template_exercise te
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise a on a.id = e.alternative_id
  join public.template_set ts on ts.template_exercise_id = te.id and ts.deleted_at is null
 where te.template_id = md5('calisthenics-2026-11-23-template')::uuid and te.deleted_at is null
 group by te.position, e.id, e.name, e.equipment, te.rest_s, a.name
 order by te.position;
