-- 0045_extra_slots_2026_11_05.sql
-- Data only, 5 November 2026 (Rodrigo): the slots added by 0044 are extra sets that may be skipped when time is short.
-- They are marked with the slot comment «Extra» (same way as «Darf entfallen» in the Bonus Day); the workout copies the
-- comment when it starts and shows such an exercise lightly tinted with the tag «Extra». No schema change. Idempotent.
update public.template_exercise te
   set comment = 'Extra', updated_at = greatest(now(), te.updated_at + interval '1 ms')
  from public.template t
 where t.id = te.template_id and t.deleted_at is null and t.archived_at is null and te.deleted_at is null
   and ((t.name = 'Main Day A' and te.exercise_id = '0c25dc20-cf47-5ee1-8f49-7245ded33260')    -- Butterfly (Machine)
     or (t.name = 'Main Day B' and te.exercise_id = '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3'))   -- Cable Curl
   and te.comment is distinct from 'Extra';

-- Check
select 'ROW ' || string_agg(t.name || ' #' || te.position || ' ' || coalesce(te.comment, '-'), ' | ' order by t.name, te.position)
  from public.template t join public.template_exercise te on te.template_id = t.id and te.deleted_at is null
 where t.name in ('Main Day A', 'Main Day B') and t.deleted_at is null and t.archived_at is null and te.comment is not null;
