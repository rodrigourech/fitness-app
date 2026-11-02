-- 0036_lateral_raise_machine_step.sql
-- Data only, 2 November 2026: Lateral Raise (Machine) (Technogym Delts Machine) has a stack labelled 2.5, 5, 10, 15 … 65
-- and a yellow 2.5 kg add-on on top. With the add-on every 2.5 kg is reachable (for example 10 + 2.5 = 12.5), so the
-- weight step is 2.5 kg. For a small muscle a 5 kg jump (10 → 15 = +50 %) is too large. Replaces the step 5 of migration 0023,
-- where the add-on was not used as a step. Idempotent.

update public.exercise set weight_step = 2.5, updated_at = greatest(now(), updated_at + interval '1 ms')
 where id = '377d7bce-a5f5-5da6-856e-3a695f79dfe5' and weight_step is distinct from 2.5;

select 'ROW ' || name || ' = ' || coalesce(weight_step::text, '-') from public.exercise where id = '377d7bce-a5f5-5da6-856e-3a695f79dfe5';
