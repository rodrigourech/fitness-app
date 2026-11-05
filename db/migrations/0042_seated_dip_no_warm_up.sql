-- 0042_seated_dip_no_warm_up.sql
-- Data only, 5 November 2026 (decision Rodrigo): Seated Dip (Machine) follows the Chest Press in Main Day B, chest and
-- triceps are already warm, so no warm-up set. The app change of the same day sets the warm-up of plate-loaded
-- machines to the back-off weight (Chest Press 40 × 4–5). Idempotent.
update public.exercise set warm_up = false, updated_at = greatest(now(), updated_at + interval '1 ms')
 where id = '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8' and warm_up is distinct from false;

select 'ROW ' || name || ' warm=' || coalesce(warm_up::text, '-') from public.exercise where id = '07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8';
