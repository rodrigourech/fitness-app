-- 0034_seated_dip_weight_step.sql
-- Data only, 1 November 2026: Seated Dip (Machine) uses the same plates as Chest Press (Machine), so the same weight
-- step of 10 kg (Rodrigo). Idempotent.

update public.exercise set weight_step = 10, updated_at = greatest(now(), updated_at + interval '1 ms')
 where id = '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8' and weight_step is distinct from 10;

select 'ROW ' || string_agg(name || ' = ' || coalesce(weight_step::text, '-'), ' | ' order by name)
  from public.exercise where id in ('07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8', '1f3d184e-fccb-514f-a554-b6a6cbbc7380');
