-- 0038_lat_pulldown_archive.sql
-- Data only, 2 November 2026 (decision Rodrigo with coaching):
-- Lat Pulldown up to 1 November was done with a shortened range of motion (39 and 45 kg). From 2 November the bar goes
-- down to collarbone height with full extension at the top, starting with a top set of 32 kg.
-- - New root exercise «Lat Pulldown (verkürzt, bis 1. Nov)» keeps the old history. It is a root and not a variant,
--   so Stats (plan progress groups variants), previous values, progression and records of Lat Pulldown start clean.
-- - Every Lat Pulldown row (main or any variant) of a workout started before 2 November (Zurich) moves to the archive.
-- - Finished workouts from 2 November: work sets above 33 kg (32 kg is 70 lb = 31.75 on the stack, next step 34) move into
--   their own exercise row with the archive
--   exercise (same workout, appended at the end); the lighter sets stay.
-- - Active templates: Lat Pulldown slots get target 32 kg for the first work set (top set) and 25 kg for the others.
--   Volume unchanged (confirmed 2 November 2026).
-- - Execution cue appended to the note of the main exercise, «Unten» stays.
-- Run 0038_preview first and confirm the affected workouts. Idempotent.

begin;

create temporary table lp_family on commit drop as
select e.id from public.exercise e
 where (e.id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50' or e.parent_id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50');

-- Archive exercise (copy of the main exercise)
insert into public.exercise (id, user_id, parent_id, name, equipment, muscles_primary, muscles_secondary, tracking_type,
  is_unilateral, weight_step, default_rest_s, floor, seat, foot_position, setup_note, source_id, focus_muscles,
  target_reps, min_reps, warm_up, top_set, alternative_id, created_at, updated_at, deleted_at)
select '6929a14f-1d2f-5775-8a49-48000237d192'::uuid, m.user_id, null, 'Lat Pulldown (verkürzt, bis 1. Nov)', m.equipment,
  m.muscles_primary, m.muscles_secondary, m.tracking_type, m.is_unilateral, m.weight_step, m.default_rest_s, m.floor,
  m.seat, m.foot_position, E'Archiv: verkürzte Bewegung bis 1. Nov 2026; nicht mehr verwenden', null, m.focus_muscles,
  m.target_reps, m.min_reps, m.warm_up, m.top_set, null, now(), now(), null
  from public.exercise m
 where m.id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50'
on conflict (id) do nothing;

-- History before 2 November → archive
update public.workout_exercise we
   set exercise_id = '6929a14f-1d2f-5775-8a49-48000237d192', updated_at = greatest(now(), we.updated_at + interval '1 ms')
  from public.workout w
 where w.id = we.workout_id and we.exercise_id in (select id from lp_family)
   and w.started_at < timestamptz '2026-11-02 00:00 Europe/Zurich';

-- Finished workouts from 2 November: work sets above 32 kg into their own archive row
create temporary table lp_split on commit drop as
select we.id as source_id, we.workout_id, we.user_id, we.rest_s, we.target_reps, we.min_reps,
       (select max(x.position) from public.workout_exercise x where x.workout_id = we.workout_id) + 1 as position,
       (select count(*) from public.workout_set s where s.workout_exercise_id = we.id and s.deleted_at is null) as all_sets,
       (select count(*) from public.workout_set s where s.workout_exercise_id = we.id and s.deleted_at is null
          and s.set_type = 'working' and s.weight > 33) as heavy_sets
  from public.workout_exercise we
  join public.workout w on w.id = we.workout_id
 where we.exercise_id in (select id from lp_family) and we.deleted_at is null
   and w.deleted_at is null and w.finished_at is not null
   and w.started_at >= timestamptz '2026-11-02 00:00 Europe/Zurich'
   and exists (select 1 from public.workout_set s where s.workout_exercise_id = we.id and s.deleted_at is null
                 and s.set_type = 'working' and s.weight > 33);

-- Only heavy sets: the whole row moves
update public.workout_exercise we
   set exercise_id = '6929a14f-1d2f-5775-8a49-48000237d192', updated_at = greatest(now(), we.updated_at + interval '1 ms')
  from lp_split p
 where we.id = p.source_id and p.heavy_sets = p.all_sets;

-- Mixed: new archive row, heavy sets move there and are renumbered
create temporary table lp_new on commit drop as
select p.source_id, (md5(p.source_id::text || '/lat-pulldown-archive'))::uuid as new_id, p.workout_id, p.user_id,
       p.position, p.rest_s, p.target_reps, p.min_reps
  from lp_split p
 where p.heavy_sets < p.all_sets;

insert into public.workout_exercise (id, user_id, workout_id, exercise_id, position, rest_s, comment, target_reps,
  min_reps, warm_up, original_exercise_id, created_at, updated_at, deleted_at)
select n.new_id, n.user_id, n.workout_id, '6929a14f-1d2f-5775-8a49-48000237d192', n.position, n.rest_s,
  'Abgetrennt: Sätze über 32 kg mit verkürzter Bewegung', n.target_reps, n.min_reps, false, null, now(), now(), null
  from lp_new n
on conflict (id) do nothing;

update public.workout_set s
   set workout_exercise_id = n.new_id, updated_at = greatest(now(), s.updated_at + interval '1 ms')
  from lp_new n
 where s.workout_exercise_id = n.source_id and s.deleted_at is null and s.set_type = 'working' and s.weight > 33;

-- Renumber the sets of all touched rows (1..n in the old order)
update public.workout_set s
   set position = r.rn, updated_at = greatest(now(), s.updated_at + interval '1 ms')
  from (select s2.id, row_number() over (partition by s2.workout_exercise_id order by s2.position, s2.created_at) as rn
          from public.workout_set s2
         where s2.deleted_at is null
           and s2.workout_exercise_id in (select source_id from lp_new union select new_id from lp_new)) r
 where s.id = r.id and s.position <> r.rn;

-- Active templates: top set 32, back-off 25
update public.template_set ts
   set target_weight = case when ts.position = f.first_pos then 32 else 25 end,
       updated_at = greatest(now(), ts.updated_at + interval '1 ms')
  from (select te.id as te_id, min(s.position) as first_pos
          from public.template_exercise te
          join public.template t on t.id = te.template_id
          join public.template_set s on s.template_exercise_id = te.id and s.deleted_at is null and s.set_type = 'working'
         where te.deleted_at is null and t.deleted_at is null and t.archived_at is null
           and te.exercise_id in (select id from lp_family)
         group by te.id) f
 where ts.template_exercise_id = f.te_id and ts.deleted_at is null and ts.set_type = 'working'
   and ts.target_weight is distinct from (case when ts.position = f.first_pos then 32 else 25 end);

-- Execution cue
update public.exercise
   set setup_note = coalesce(nullif(setup_note, '') || E'\n', '')
                    || 'Stange bis Schlüsselbeinhöhe, Ellbogen zum Boden und leicht nach hinten, oben voll strecken',
       updated_at = greatest(now(), updated_at + interval '1 ms')
 where id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50'
   and coalesce(setup_note, '') not like '%Schlüsselbeinhöhe%';

commit;

-- Check
select 'ROW archive rows ' || count(*) || ', sets ' || coalesce(sum((select count(*) from public.workout_set s
         where s.workout_exercise_id = we.id and s.deleted_at is null)), 0)
  from public.workout_exercise we
 where we.exercise_id = '6929a14f-1d2f-5775-8a49-48000237d192' and we.deleted_at is null
union all
select 'ROW new ' || w.started_at::date || ' ' || e.name || ' ' || string_agg(coalesce(s.weight::text, '-') || 'x' || coalesce(s.reps::text, '-'), ', ' order by s.position)
  from public.workout_exercise we
  join public.workout w on w.id = we.workout_id
  join public.exercise e on e.id = we.exercise_id
  join public.workout_set s on s.workout_exercise_id = we.id and s.deleted_at is null
 where we.deleted_at is null and w.started_at >= timestamptz '2026-11-02 00:00 Europe/Zurich'
   and (e.id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50' or e.parent_id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50'
        or e.id = '6929a14f-1d2f-5775-8a49-48000237d192')
 group by w.started_at, e.name, we.id
union all
select 'ROW template ' || t.name || ' ' || e.name || ' ' || string_agg(coalesce(s.target_weight::text, '-'), '/' order by s.position)
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  join public.template_set s on s.template_exercise_id = te.id and s.deleted_at is null and s.set_type = 'working'
 where t.deleted_at is null and t.archived_at is null
   and (e.id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50' or e.parent_id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50')
 group by t.name, e.name;
