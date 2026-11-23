-- 0057_push_up_last.sql
-- Data only, 23 November 2026 (Rodrigo): Push-Up moves to the end of Full Body A until the plan review on 10 December,
-- so the Triceps Pushdown keeps a fresh triceps as before (Butterfly did not tire it) and its progression stays
-- comparable. Order: down Lat Pulldown, Leg Press, Lateral Raise; up Incline Chest Press, Chest-Supported Row,
-- Triceps Pushdown, Preacher Curl, Push-Up. Idempotent; aborts if the positions are not 1 to 8 afterwards.

begin;

update public.template_exercise te
   set position = v.position, updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from public.template t, (values
    ('5fc983b7-01cb-4914-a87c-574be071953d'::uuid, 6),   -- Triceps Pushdown (Cable) / V-Grip
    ('51217eb3-ec3e-52ea-8065-2e689d996e75'::uuid, 7)    -- Preacher Curl (Machine)
  ) v(exercise_id, position)
 where te.template_id = t.id and t.name = 'Full Body A' and t.deleted_at is null and t.archived_at is null
   and te.deleted_at is null and te.exercise_id = v.exercise_id and te.position <> v.position;

update public.template_exercise te
   set position = 8, updated_at = greatest(now(), te.updated_at + interval '1 ms')
 where te.id = md5('push-ups-2026-11-23-te:a')::uuid and te.deleted_at is null and te.position <> 8;

do $$
begin
  if (select string_agg(te.position::text, ',' order by te.position) from public.template_exercise te
        join public.template t on t.id = te.template_id
       where t.name = 'Full Body A' and t.deleted_at is null and t.archived_at is null and te.deleted_at is null) <> '1,2,3,4,5,6,7,8'
     or (select position from public.template_exercise where id = md5('push-ups-2026-11-23-te:a')::uuid) <> 8 then
    raise exception 'Full Body A order is not as planned';
  end if;
end
$$;

commit;

-- Check
select string_agg(te.position || ' ' || coalesce(p.name || ' / ', '') || e.name, ', ' order by te.position) as full_body_a
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.name = 'Full Body A' and t.deleted_at is null and t.archived_at is null;
