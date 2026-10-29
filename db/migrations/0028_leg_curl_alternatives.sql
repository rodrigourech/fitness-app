-- 0028_leg_curl_alternatives.sql
-- Data only, 29 October 2026: alternative pair for the leg curl, used when the machine is taken
--   Seated Leg Curl (Machine) <-> Lying Leg Curl (Machine), in both directions, only where no alternative is set yet.
-- Lying Leg Curl keeps its own history and progression. Leg Press gets no alternative (decision Rodrigo).
-- Requires 0026 (column exercise.alternative_id). Idempotent.

begin;

update public.exercise set alternative_id = v.alt::uuid, updated_at = greatest(now(), updated_at + interval '1 ms')
  from (values
    ('4716d4ac-9fda-59f4-883a-c570aa7bd339', 'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7'),
    ('fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7', '4716d4ac-9fda-59f4-883a-c570aa7bd339')
  ) v(id, alt)
 where exercise.id = v.id::uuid
   and exercise.alternative_id is null
   and exists (select 1 from public.exercise a where a.id = v.alt::uuid and a.deleted_at is null);

commit;

select 'ROW ' || string_agg(e.name || ' -> ' || coalesce(a.name, '-'), ' | ' order by e.name)
  from public.exercise e
  join public.exercise a on a.id = e.alternative_id
 where e.deleted_at is null;
