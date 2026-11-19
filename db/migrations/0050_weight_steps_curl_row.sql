-- 0050_weight_steps_curl_row.sql
-- Data only, 20 November 2026 (Rodrigo): Cable Curl on the same Matrix tower as Triceps Pushdown (4.5 kg = 10 lb),
-- Chest-Supported Row (Machine) with the same plates as Chest Press (Machine) (10 kg). Butterfly stays without a step.
-- Idempotent.

begin;

update public.exercise set weight_step = v.step, updated_at = greatest(now(), exercise.updated_at + interval '1 ms')
  from (values
    ('9ae34067-6ea2-544b-87c2-c17ec0a2f7f3', 4.5),  -- Cable Curl
    ('767f29a4-918b-5180-92a0-2f2ba5633811', 10)    -- Chest-Supported Row (Machine)
  ) v(id, step)
 where exercise.id = v.id::uuid and exercise.weight_step is distinct from v.step;

commit;

-- Check
select 'ROW ' || string_agg(name || ' = ' || coalesce(weight_step::text, '-'), ' | ' order by name)
  from public.exercise
 where id in ('9ae34067-6ea2-544b-87c2-c17ec0a2f7f3', '767f29a4-918b-5180-92a0-2f2ba5633811');
