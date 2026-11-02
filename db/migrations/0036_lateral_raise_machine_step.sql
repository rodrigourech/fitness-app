-- 0036_lateral_raise_machine_step.sql
-- Data only, 2 November 2026: Lateral Raise (Machine), Technogym Delts Machine. Photo of the stack: 2.5, 5, 10 … 65 kg
-- in 5 kg steps plus a yellow 2.5 kg add-on. With the add-on every 2.5 kg is reachable, so the step is 2.5 kg: at
-- 15 to 25 kg a 5 kg jump would be 20 to 33 %, too much for 10 to 15 reps and a stable progression. Idempotent.

update public.exercise
   set weight_step = 2.5,
       setup_note = E'Technogym Delts Machine\nStapel 2.5, 5, 10 … 65 kg; Zwischenstufen mit dem gelben 2.5-kg-Zusatzgewicht',
       updated_at = greatest(now(), updated_at + interval '1 ms')
 where id = '377d7bce-a5f5-5da6-856e-3a695f79dfe5' and weight_step is distinct from 2.5;

select 'ROW ' || name || ' = ' || weight_step || ' | ' || coalesce(setup_note, '-') from public.exercise where id = '377d7bce-a5f5-5da6-856e-3a695f79dfe5';
