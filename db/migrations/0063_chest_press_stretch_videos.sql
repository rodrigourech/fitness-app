-- 0063_chest_press_stretch_videos.sql
-- Data only, 26 November 2026 (Änderungsauftrag, Fitness-Coaching 26. November): Rodrigo feels a pull below the
-- collarbone at the Chest Press (upper chest, pectoralis minor). Two stretching videos with fixed titles under
-- Exercise › Videos of «Chest Press (Machine)», after the existing ones (the list sorts by created_at). A link with a
-- title keeps it; titles only fill themselves in for links without one (decision 19 November 2026), so no app change.
-- The note gets one line on stretching. Idempotent.

begin;

insert into public.exercise_link (id, user_id, exercise_id, url, title, created_at, updated_at, deleted_at)
select md5('chest-press-stretch-2026-11-26:' || v.url)::uuid, o.user_id, '1f3d184e-fccb-514f-a554-b6a6cbbc7380', v.url, v.title,
       now() + v.n * interval '1 ms', now() + v.n * interval '1 ms', null
  from private.app_owner o, (values
    (1, 'https://www.youtube.com/watch?v=069o76BafTk', 'Dehnen – Doorway Pec Stretch'),
    (2, 'https://www.youtube.com/watch?v=QGfS6MtHFjA', 'Dehnen – Pec Minor Stretch')
  ) v(n, url, title)
 where not exists (select 1 from public.exercise_link l where l.exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380'
                     and l.url = v.url and l.deleted_at is null)
on conflict (id) do nothing;

update public.exercise
   set setup_note = concat_ws(E'\n', nullif(setup_note, ''),
         'Nach dem Training dehnen: Pfosten am Rack, Ellbogen auf Schulterhöhe, dann etwas höher, je 2 × 30 s pro Seite'),
       updated_at = greatest(now(), updated_at + interval '1 ms')
 where id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380'
   and coalesce(setup_note, '') not like '%Nach dem Training dehnen%';

do $$
begin
  if (select count(*) from public.exercise_link where exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380'
        and deleted_at is null and title like 'Dehnen – %') <> 2
     or (select setup_note from public.exercise where id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380') not like '%Nach dem Training dehnen%' then
    raise exception 'Stretch videos or note missing';
  end if;
end
$$;

commit;

-- Check
select string_agg(coalesce(title, '(auto)') || ' ' || url, ' | ' order by created_at) as videos,
       (select replace(setup_note, E'\n', ' / ') from public.exercise where id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380') as note
  from public.exercise_link where exercise_id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380' and deleted_at is null;
