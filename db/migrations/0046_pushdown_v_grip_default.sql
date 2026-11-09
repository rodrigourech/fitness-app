-- 0046_pushdown_v_grip_default.sql
-- Data only, 9 November 2026 (Rodrigo): Triceps Pushdown in Main Day A uses the variant V-Grip by default again instead
-- of Straight Bar (reverses the grip choice of 0033). Straight Bar stays the alternative («⇄», 0037). Progression,
-- records and weights stay separate per grip. V-Grip is looked up by name under Triceps Pushdown; aborts without changes
-- if it is not found exactly once. A running workout is not touched. Idempotent.

begin;

do $$
declare
  v_grip uuid;
  n int;
begin
  select count(*), min(id::text)::uuid into n, v_grip
    from public.exercise
   where parent_id = '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0' and deleted_at is null and name ilike '%v-grip%';
  if n <> 1 then
    raise exception 'Expected exactly one V-Grip variant of Triceps Pushdown, found %', n;
  end if;
  update public.template_exercise te
     set exercise_id = v_grip, updated_at = greatest(now(), te.updated_at + interval '1 ms')
    from public.template t
   where t.id = te.template_id and t.name = 'Main Day A' and t.deleted_at is null and t.archived_at is null
     and te.deleted_at is null and te.exercise_id = 'c6473665-753c-5771-ba78-c6e0d8c1c89b';  -- Straight Bar
end $$;

commit;

-- Check
select 'ROW ' || string_agg(t.name || ' #' || te.position || ' ' || coalesce(p.name || ' / ', '') || e.name, ' | ')
  from public.template t
  join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where t.deleted_at is null and t.archived_at is null and (e.parent_id = '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0' or e.id = '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0');
