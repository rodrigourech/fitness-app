-- 0061_cable_curl_plan.sql
-- Data only, 23 November 2026 (Rodrigo, brought forward from the plan review on 10 December): Cable Curl feels more
-- natural than Preacher Curl and was skipped twice at the end of Full Body B.
--   Full Body A: Cable Curl instead of Preacher Curl at position 7 (sets, reps and rest copied from the Cable Curl slot
--                of Full Body B); the Preacher Curl slot goes to the trash
--   Full Body B: Cable Curl first (6), then Preacher Curl (7)
-- No new exercise; biceps 9 work sets per week. Cable Curl comes before any other curl on both days, so its history stays
-- comparable. Preacher Curl keeps Cable Curl as its alternative. Idempotent.

begin;

create temporary table cc on commit drop as
select te.id as b_slot, te.rest_s, te.user_id,
  (select id from public.template where name = 'Full Body A' and deleted_at is null and archived_at is null) as a_id,
  (select id from public.template where name = 'Full Body B' and deleted_at is null and archived_at is null) as b_id
  from public.template_exercise te
  join public.template t on t.id = te.template_id and t.name = 'Full Body B' and t.deleted_at is null and t.archived_at is null
 where te.exercise_id = '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3' and te.deleted_at is null;   -- Cable Curl

do $$
begin
  if (select count(*) from cc) <> 1 then raise exception 'Expected exactly one Cable Curl slot in Full Body B'; end if;
end
$$;

-- Full Body A: Preacher Curl out, Cable Curl in at position 7
update public.template_set ts
   set deleted_at = now(), updated_at = greatest(now(), ts.updated_at + interval '1 ms')
  from public.template_exercise te, cc
 where ts.template_exercise_id = te.id and te.template_id = cc.a_id and te.deleted_at is null and ts.deleted_at is null
   and te.exercise_id = '51217eb3-ec3e-52ea-8065-2e689d996e75';   -- Preacher Curl (Machine)
update public.template_exercise te
   set deleted_at = now(), updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from cc
 where te.template_id = cc.a_id and te.deleted_at is null and te.exercise_id = '51217eb3-ec3e-52ea-8065-2e689d996e75';

insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select md5('cable-curl-2026-11-23-te:a')::uuid, cc.user_id, cc.a_id, '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3', 7, cc.rest_s, null,
       now(), now(), null
  from cc
on conflict (id) do nothing;

insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max,
  target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select md5('cable-curl-2026-11-23-ts:a:' || ts.position)::uuid, ts.user_id, md5('cable-curl-2026-11-23-te:a')::uuid,
       ts.position, ts.set_type, ts.target_reps_min, ts.target_reps_max, null, null, null, now(), now(), null
  from cc join public.template_set ts on ts.template_exercise_id = cc.b_slot and ts.deleted_at is null
on conflict (id) do nothing;

-- Full Body B: Cable Curl 6, Preacher Curl 7
update public.template_exercise te
   set position = v.position, updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from cc, (values ('9ae34067-6ea2-544b-87c2-c17ec0a2f7f3'::uuid, 6), ('51217eb3-ec3e-52ea-8065-2e689d996e75'::uuid, 7)) v(exercise_id, position)
 where te.template_id = cc.b_id and te.deleted_at is null and te.exercise_id = v.exercise_id and te.position <> v.position;

do $$
begin
  if (select string_agg(te.position || ':' || e.name, ',' order by te.position) from public.template_exercise te
        join public.exercise e on e.id = te.exercise_id, cc
       where te.template_id = cc.a_id and te.deleted_at is null and te.position = 7) <> '7:Cable Curl'
     or (select string_agg(te.position || ':' || e.name, ',' order by te.position) from public.template_exercise te
        join public.exercise e on e.id = te.exercise_id, cc
       where te.template_id = cc.b_id and te.deleted_at is null and te.position >= 6) <> '6:Cable Curl,7:Preacher Curl (Machine)'
     or (select count(*) from public.template_set where template_exercise_id = md5('cable-curl-2026-11-23-te:a')::uuid and deleted_at is null) < 1 then
    raise exception 'Curl plan not as planned';
  end if;
end
$$;

commit;

-- Check
select t.name || ': ' || string_agg(te.position || ' ' || coalesce(p.name || ' / ', '') || e.name || ' ' ||
         (select count(*) || 'x' || coalesce(min(s.target_reps_min) || '-' || max(s.target_reps_max), '') from public.template_set s
           where s.template_exercise_id = te.id and s.deleted_at is null), ', ' order by te.position) as plan
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.name in ('Full Body A', 'Full Body B') and t.deleted_at is null and t.archived_at is null
 group by t.name;
