-- 0018_top_set_setting.sql
-- Schema and data, 18 October 2026:
-- - exercise.top_set: setting «Top set» per exercise (null on a variant = inherit, null on a main exercise = off)
-- - Top set on: Chest Press, Lat Pulldown, Seated Row, Leg Press, Triceps Pushdown, Preacher Curl, Lying Leg Curl;
--   off: Lateral Raise
-- - Triceps Pushdown: new main exercise «Triceps Pushdown (Cable)»; the existing exercise becomes its variant
--   «Straight Bar» (history stays on the variant, ranges and settings are inherited from the main exercise)
-- - Notes: lines «Oben», «Unten», «V-Griff (schwarz)» and «rechts beginnt» removed
-- After running: neon data-api refresh-schema --database neondb, then push the app.
-- Idempotent.

begin;

alter table public.exercise add column if not exists top_set boolean;

-- Triceps Pushdown (Cable) as main exercise with the existing exercise as variant «Straight Bar»
insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, default_rest_s, focus_muscles, focus_cue, target_reps, min_reps, warm_up, top_set, created_at, updated_at, deleted_at)
select '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0'::uuid, e.user_id, null, 'Triceps Pushdown (Cable)', e.equipment, e.muscles_primary,
  e.muscles_secondary, e.tracking_type, e.is_unilateral, e.default_rest_s, e.focus_muscles, e.focus_cue, 12, 8, false, true, now(), now(), null
from public.exercise e
where e.id = 'c6473665-753c-5771-ba78-c6e0d8c1c89b'
on conflict (id) do nothing;

update public.exercise
   set parent_id = '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', name = 'Straight Bar',
       target_reps = null, min_reps = null, warm_up = null, top_set = null, focus_muscles = null, focus_cue = null, updated_at = now()
 where id = 'c6473665-753c-5771-ba78-c6e0d8c1c89b' and parent_id is null;

-- Top set setting
update public.exercise set top_set = v.on_, updated_at = now()
  from (values
    ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', true),  -- Chest Press (Machine)
    ('8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', true),  -- Lat Pulldown
    ('09ab0a44-dcd2-5c33-989a-3986f73cdb06', true),  -- Seated Row
    ('6144fd76-baee-5c78-a409-4ce968051388', true),  -- Leg Press
    ('51217eb3-ec3e-52ea-8065-2e689d996e75', true),  -- Preacher Curl
    ('fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7', true),  -- Lying Leg Curl
    ('2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', true),  -- Triceps Pushdown (Cable)
    ('a3f09696-52df-5e8f-a9b3-26ab3c1684f7', false)  -- Lateral Raise
  ) v(id, on_)
 where exercise.id = v.id::uuid and exercise.top_set is distinct from v.on_;

-- Notes without floor and handle lines
with cleaned as (
  select e.id, nullif(array_to_string(array(
           select l from unnest(string_to_array(e.setup_note, E'\n')) with ordinality t(l, n)
            where btrim(l) not in ('Oben', 'Unten', 'V-Griff (schwarz)', 'rechts beginnt') order by n), E'\n'), '') as note
    from public.exercise e
   where e.setup_note is not null
)
update public.exercise e set setup_note = c.note, updated_at = now()
  from cleaned c
 where e.id = c.id and e.setup_note is distinct from c.note;

commit;

-- Check
select e.name, p.name as main, e.top_set, e.target_reps, e.min_reps, replace(e.setup_note, E'\n', ' / ') as note
from public.exercise e left join public.exercise p on p.id = e.parent_id
where e.deleted_at is null and (e.setup_note is not null or e.top_set is not null or e.parent_id is not null)
order by coalesce(p.name, e.name), e.parent_id nulls first;
