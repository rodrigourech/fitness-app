-- 0021_plan_2026_10_19.sql
-- Data only, 19 October 2026 (plan review against the literature):
-- - Compound range 6-10 instead of 6-9: Chest Press, Incline Chest Press (Machine, Dumbbell), Lat Pulldown, Seated Row
-- - Rest 120 s instead of 90 s for Lat Pulldown and Leg Press (Main Day A, Bonus Day) and Seated Row (Main Day B)
-- - New exercise «Seated Leg Curl (Machine)», replaces Lying Leg Curl in Main Day B (Lying Leg Curl and its history stay)
-- - New exercise «Overhead Triceps Extension (Cable)» with note and video, replaces Triceps Pushdown in Main Day B
--   (Main Day A keeps Triceps Pushdown)
-- - Target weights of the swapped template sets are cleared (no history on the new exercises)
-- Idempotent. Aborts without changes if a precondition fails. A running workout is not touched (it keeps its own
-- copy of exercises, ranges and rest), so no check for it.

begin;

do $$
begin
  if (select count(*) from private.app_owner) <> 1 then
    raise exception 'Expected exactly one owner';
  end if;
  if (select count(*) from public.exercise where deleted_at is null and id in (
        '1f3d184e-fccb-514f-a554-b6a6cbbc7380', 'bcd40dee-75cb-544b-af11-36e6d8d15a53', '7ca1c0fa-f1c7-576b-a946-f1832f3dcb14',
        '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', '09ab0a44-dcd2-5c33-989a-3986f73cdb06',
        'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7', '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0')) <> 7 then
    raise exception 'An expected exercise is missing';
  end if;
  if (select count(*) from public.template_exercise where deleted_at is null and id in (
        '9faab5a4-f732-5b53-a32a-8924ebc3d45f', '10426378-c008-53d3-b1c3-669a94a66314')) <> 2 then
    raise exception 'Main Day B leg curl or triceps slot is missing';
  end if;
end
$$;

-- Compound 6-10
update public.exercise set target_reps = 10, min_reps = 6, updated_at = now()
 where id in ('1f3d184e-fccb-514f-a554-b6a6cbbc7380',  -- Chest Press (Machine)
              'bcd40dee-75cb-544b-af11-36e6d8d15a53',  -- Incline Chest Press (Machine)
              '7ca1c0fa-f1c7-576b-a946-f1832f3dcb14',  -- Incline Chest Press (Dumbbell)
              '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50',  -- Lat Pulldown
              '09ab0a44-dcd2-5c33-989a-3986f73cdb06')  -- Seated Row
   and (target_reps is distinct from 10 or min_reps is distinct from 6);

-- Rest 120 s for the compound pulls and Leg Press
update public.template_exercise set rest_s = 120, updated_at = now()
 where id in ('dca196d5-729e-5c11-b927-e78ba3fbd0bc',  -- Main Day A: Lat Pulldown
              'ad032aa2-c7f6-5674-bc42-028c1e14a632',  -- Main Day A: Leg Press
              '385c2d08-de90-5d2b-94d3-c9163ab5b592',  -- Main Day B: Seated Row
              '10b22862-9d54-5d80-8f6f-2bb34a76c506',  -- Bonus Day: Lat Pulldown
              'f6954553-b2d7-5068-8e5f-ae2027db2c6a')  -- Bonus Day: Leg Press
   and deleted_at is null and rest_s is distinct from 120;

-- New exercises
with o as (select user_id from private.app_owner limit 1)
insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, default_rest_s, setup_note, focus_muscles, target_reps, min_reps, warm_up, top_set, created_at, updated_at, deleted_at)
select v.id::uuid, o.user_id, null, v.name, 'pin_loaded', v.prim::text[], '{}'::text[], 'weight_reps',
  false, 90, v.note, v.focus::text[], 12, 8, v.wu, true, now(), now(), null
from o, (values
  ('4716d4ac-9fda-59f4-883a-c570aa7bd339', 'Seated Leg Curl (Machine)', '{hamstrings}', null,
   '{hamstrings-medial,hamstrings-lateral}', true),
  ('5db24cf0-d28b-520b-86bb-d88a8dc490ee', 'Overhead Triceps Extension (Cable)', '{triceps}',
   E'Kabel knapp über Hüfthöhe (unterer Rücken)\nSeil\nRücken zum Kabel, Ellbogen nah am Kopf',
   '{triceps-long}', false)
) v(id, name, prim, note, focus, wu)
on conflict (id) do nothing;

with o as (select user_id from private.app_owner limit 1)
insert into public.exercise_link (id, user_id, exercise_id, url, title, created_at, updated_at, deleted_at)
select '59078793-5850-50d5-a097-f2d4b1ec570c'::uuid, o.user_id, '5db24cf0-d28b-520b-86bb-d88a8dc490ee'::uuid,
  'https://youtube.com/shorts/9Ark9S11uXw', null, now(), now(), null
from o
on conflict (id) do nothing;

-- Main Day B: swap the slots, clear the old target weights
update public.template_exercise set exercise_id = '4716d4ac-9fda-59f4-883a-c570aa7bd339', updated_at = now()
 where id = '9faab5a4-f732-5b53-a32a-8924ebc3d45f' and exercise_id = 'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7';
update public.template_exercise set exercise_id = '5db24cf0-d28b-520b-86bb-d88a8dc490ee', updated_at = now()
 where id = '10426378-c008-53d3-b1c3-669a94a66314'
   and exercise_id in ('c6473665-753c-5771-ba78-c6e0d8c1c89b', '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0');
update public.template_set set target_weight = null, updated_at = now()
 where template_exercise_id in ('9faab5a4-f732-5b53-a32a-8924ebc3d45f', '10426378-c008-53d3-b1c3-669a94a66314')
   and deleted_at is null and target_weight is not null;

commit;

-- Check
select 'ROW ' || t.name || ' | ' || te.position || ' ' || coalesce(p.name || ' / ', '') || e.name
       || ' | ' || coalesce(coalesce(e.min_reps, p.min_reps)::text, '-') || '-' || coalesce(coalesce(e.target_reps, p.target_reps)::text, '-')
       || ' | rest ' || coalesce(te.rest_s::text, '-')
       || ' | sets ' || (select count(*) from public.template_set ts where ts.template_exercise_id = te.id and ts.deleted_at is null)
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.name in ('Main Day A', 'Main Day B', 'Bonus Day') and t.deleted_at is null and t.archived_at is null
 order by t.name, te.position;
