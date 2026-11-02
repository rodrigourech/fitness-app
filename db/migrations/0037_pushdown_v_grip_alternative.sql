-- 0037_pushdown_v_grip_alternative.sql
-- Data only, 2 November 2026 (decision Rodrigo, Fitness-Coaching): Triceps Pushdown, Straight Bar (Main Day A) and the
-- variant V-Grip are alternatives of each other. A variant's own alternative overrides the one inherited from the main
-- exercise, so Straight Bar no longer offers Seated Dip. Triceps Pushdown (main) and Seated Dip stay alternatives of each
-- other. Progression, records and weights stay separate per grip (unchanged). V-Grip was created in the app: looked up by
-- name under Triceps Pushdown. Aborts without changes if it is not found exactly once. Idempotent.

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
  update public.exercise set alternative_id = v.alt, updated_at = greatest(now(), updated_at + interval '1 ms')
    from (values ('c6473665-753c-5771-ba78-c6e0d8c1c89b'::uuid, v_grip), (v_grip, 'c6473665-753c-5771-ba78-c6e0d8c1c89b'::uuid)) v(id, alt)
   where exercise.id = v.id and exercise.alternative_id is distinct from v.alt;
end $$;

commit;

select 'ROW ' || string_agg(coalesce(p.name || ' / ', '') || e.name || ' -> ' || coalesce(a.name, 'inherits'), ' | ' order by e.name)
  from public.exercise e
  left join public.exercise p on p.id = e.parent_id
  left join public.exercise a on a.id = e.alternative_id
 where e.deleted_at is null and (e.id in ('2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8') or e.parent_id = '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0');
