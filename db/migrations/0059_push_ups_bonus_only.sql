-- 0059_push_ups_bonus_only.sql
-- Data only, 23 November 2026 (Rodrigo): bodyweight exercises only on the Calisthenics Bonus day. Push-Up leaves
-- Full Body A, Close-Grip Push-Up leaves Full Body B (slots of 0056 and 0057 and their sets to the trash; the exercises,
-- their history and the Calisthenics Bonus stay). Butterfly does not come back: Full Body A has 7 exercises, chest
-- 6 work sets per week on A and B, more on the bonus day (dips, push-ups). Idempotent.

begin;

update public.template_set ts
   set deleted_at = now(), updated_at = greatest(now(), ts.updated_at + interval '1 ms')
 where ts.template_exercise_id in (md5('push-ups-2026-11-23-te:a')::uuid, md5('push-ups-2026-11-23-te:b')::uuid)
   and ts.deleted_at is null;

update public.template_exercise te
   set deleted_at = now(), updated_at = greatest(now(), te.updated_at + interval '1 ms')
 where te.id in (md5('push-ups-2026-11-23-te:a')::uuid, md5('push-ups-2026-11-23-te:b')::uuid)
   and te.deleted_at is null;

do $$
begin
  if (select string_agg(te.position::text, ',' order by te.position) from public.template_exercise te
        join public.template t on t.id = te.template_id
       where t.name = 'Full Body A' and t.deleted_at is null and t.archived_at is null and te.deleted_at is null) <> '1,2,3,4,5,6,7'
     or (select string_agg(te.position::text, ',' order by te.position) from public.template_exercise te
        join public.template t on t.id = te.template_id
       where t.name = 'Full Body B' and t.deleted_at is null and t.archived_at is null and te.deleted_at is null) <> '1,2,3,4,5,6,7' then
    raise exception 'Full Body A or B order is not as planned';
  end if;
end
$$;

commit;

-- Check
select t.name || ': ' || string_agg(te.position || ' ' || coalesce(p.name || ' / ', '') || e.name, ', ' order by te.position) as plan
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.name in ('Full Body A', 'Full Body B') and t.deleted_at is null and t.archived_at is null
 group by t.name;
