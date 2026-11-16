-- 0048_pushdown_alternative_seated_dip.sql
-- Data only, 16 November 2026 (decision Rodrigo): Triceps Pushdown V-Grip (Main Day A) and Straight Bar offer Seated Dip
-- (Machine) as the alternative («⇄») again instead of each other. The alternative is used when the cable station is
-- taken, and both grips need the same cable. Seated Dip keeps the main exercise Triceps Pushdown as its alternative.
-- Reverses 0037. Progression, records and weights stay separate per exercise. V-Grip is looked up by name under
-- Triceps Pushdown; aborts without changes if it is not found exactly once. Idempotent.

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
  update public.exercise e
     set alternative_id = '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8', updated_at = greatest(now(), e.updated_at + interval '1 ms')
   where e.id in (v_grip, 'c6473665-753c-5771-ba78-c6e0d8c1c89b')   -- V-Grip, Straight Bar
     and e.alternative_id is distinct from '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8';
end $$;

commit;

-- Check
select 'ROW ' || string_agg(coalesce(p.name || ' / ', '') || e.name || ' -> ' || coalesce(a.name, 'inherits'), ' | ' order by e.name)
  from public.exercise e
  left join public.exercise p on p.id = e.parent_id
  left join public.exercise a on a.id = e.alternative_id
 where e.deleted_at is null and (e.id in ('2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8') or e.parent_id = '2b7e9064-ce84-52ec-92ff-d4a73ac45fb0');
