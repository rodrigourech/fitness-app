-- 0060_chest_supported_row_step_5.sql
-- Data only, 23 November 2026 (Rodrigo): the Chest-Supported Row (Machine) is loaded at one point, so 5 kg steps are
-- possible. Weight step 10 → 5 kg; the next step from 25 kg is 30 kg instead of 35 kg (+40 %). Idempotent.

begin;

update public.exercise
   set weight_step = 5, updated_at = greatest(now(), updated_at + interval '1 ms')
 where name = 'Chest-Supported Row (Machine)' and parent_id is null and deleted_at is null
   and weight_step is distinct from 5;

do $$
begin
  if (select count(*) from public.exercise where name = 'Chest-Supported Row (Machine)' and parent_id is null
        and deleted_at is null and weight_step = 5) <> 1 then
    raise exception 'Chest-Supported Row (Machine) not found once with step 5';
  end if;
end
$$;

commit;

select name || ' step ' || weight_step from public.exercise
 where name = 'Chest-Supported Row (Machine)' and parent_id is null and deleted_at is null;
