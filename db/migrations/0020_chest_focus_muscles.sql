-- 0020_chest_focus_muscles.sql
-- Data only, 19 October 2026: focus muscles of the chest exercises (Chest Press lost them with the merged variants),
-- top set on for both Incline Chest Press exercises (compound like the Chest Press). Idempotent.

update public.exercise set focus_muscles = v.m::text[], updated_at = now()
  from (values
    ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', '{chest-lower,chest-upper}'),   -- Chest Press (Machine)
    ('7ca1c0fa-f1c7-576b-a946-f1832f3dcb14', '{chest-upper,shoulder-front}'), -- Incline Chest Press (Dumbbell)
    ('bcd40dee-75cb-544b-af11-36e6d8d15a53', '{chest-upper,shoulder-front}')  -- Incline Chest Press (Machine)
  ) v(id, m)
 where exercise.id = v.id::uuid and exercise.focus_muscles is distinct from v.m::text[];

update public.exercise set top_set = true, updated_at = now()
 where id in ('7ca1c0fa-f1c7-576b-a946-f1832f3dcb14', 'bcd40dee-75cb-544b-af11-36e6d8d15a53') and top_set is distinct from true;

select 'ROW ' || string_agg(name || ' = ' || array_to_string(focus_muscles, ',') || ' top=' || coalesce(top_set::text, '-'), ' || ')
  from public.exercise where id in ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', '7ca1c0fa-f1c7-576b-a946-f1832f3dcb14', 'bcd40dee-75cb-544b-af11-36e6d8d15a53');
