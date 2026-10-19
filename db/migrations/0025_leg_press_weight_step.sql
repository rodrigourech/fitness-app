-- 0025_leg_press_weight_step.sql
-- Data only, 19 October 2026: Leg Press (Technogym) stack 5, 10, 20, 30 … 190 kg, so 10 kg per step. Idempotent.

update public.exercise set weight_step = 10, updated_at = now()
 where id = '6144fd76-baee-5c78-a409-4ce968051388' and weight_step is distinct from 10;

select 'ROW ' || name || ' = ' || coalesce(weight_step::text, '-') from public.exercise where id = '6144fd76-baee-5c78-a409-4ce968051388';
