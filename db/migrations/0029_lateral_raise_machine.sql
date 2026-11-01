-- 0029_lateral_raise_machine.sql
-- Data only, 1 November 2026: Lateral Raise (Machine) replaces Lateral Raise (Cable) in Main Day A, Main Day B and
-- Bonus Day (decision Rodrigo). The cable becomes the alternative of the machine and the other way round, so it can
-- be switched in the workout with «⇄ Alternative» when the machine is taken. Both keep their own history.
-- Slots are found by workout name and exercise, position, sets and rest stay. A running workout is not touched.
-- Idempotent: a second run changes nothing.

begin;

update public.template_exercise te
   set exercise_id = '377d7bce-a5f5-5da6-856e-3a695f79dfe5',  -- Lateral Raise (Machine)
       updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from public.template t
 where t.id = te.template_id
   and t.name in ('Main Day A', 'Main Day B', 'Bonus Day')
   and t.deleted_at is null and t.archived_at is null
   and te.deleted_at is null
   and te.exercise_id = 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7'  -- Lateral Raise (Cable)
   and exists (select 1 from public.exercise m where m.id = '377d7bce-a5f5-5da6-856e-3a695f79dfe5' and m.deleted_at is null);

update public.exercise set alternative_id = v.alt::uuid, updated_at = greatest(now(), updated_at + interval '1 ms')
  from (values
    ('377d7bce-a5f5-5da6-856e-3a695f79dfe5', 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7'),
    ('a3f09696-52df-5e8f-a9b3-26ab3c1684f7', '377d7bce-a5f5-5da6-856e-3a695f79dfe5')
  ) v(id, alt)
 where exercise.id = v.id::uuid
   and exercise.alternative_id is null
   and exists (select 1 from public.exercise a where a.id = v.alt::uuid and a.deleted_at is null);

commit;

select 'ROW ' || string_agg(t.name || ': ' || e.name, ' | ' order by t.name)
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
 where t.deleted_at is null and t.archived_at is null and e.name like 'Lateral Raise%'
union all
select 'ROW ' || string_agg(e.name || ' -> ' || a.name, ' | ' order by e.name)
  from public.exercise e
  join public.exercise a on a.id = e.alternative_id
 where e.deleted_at is null and e.name like 'Lateral Raise%';
