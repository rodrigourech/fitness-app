-- 0022_lat_pulldown_classic_grip.sql
-- Data only, 19 October 2026: new variant «Classic Grip» of Lat Pulldown (Cable); it replaces «Neutralgriff breit
-- (schwarz)» in every active workout from the next workout on. History stays with the old variant (also today's
-- workout, decision Rodrigo). Archived workouts keep the old variant. Idempotent.

begin;

insert into public.exercise (id, user_id, parent_id, name, created_at, updated_at, deleted_at)
select 'd3e01b25-c5c1-5bb1-a543-830fb226fc75'::uuid, p.user_id, p.id, 'Classic Grip', now(), now(), null
  from public.exercise p where p.id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50'
on conflict (id) do nothing;

update public.template_exercise te set exercise_id = 'd3e01b25-c5c1-5bb1-a543-830fb226fc75', updated_at = now()
  from public.template t
 where t.id = te.template_id and t.deleted_at is null and t.archived_at is null and te.deleted_at is null
   and te.exercise_id = 'b587ecd4-4ddc-54f8-86bf-325f26dda158';

commit;

select 'ROW ' || string_agg(t.name || ' #' || te.position || ' ' || e.name, ' || ')
  from public.template t join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
 where e.parent_id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50' and t.deleted_at is null;
