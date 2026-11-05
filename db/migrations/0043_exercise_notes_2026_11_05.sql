-- 0043_exercise_notes_2026_11_05.sql
-- Data only, 5 November 2026 (decision Rodrigo, design «Übungskarte Variante A»): one form for the notes of the
-- exercises in the active plans. setup_note holds only machine settings in one line («Sitz 7 · Arme 4»), shown under
-- the name in the workout; focus_cue holds one execution cue, shown behind «i». Execution hints move out of the
-- setup note; «Kein Zwischensatz vor dem Top Set» goes (the app builds the sets itself); English settings become
-- German. Missing settings stay empty. Main exercises by name; variants keep inheriting. Idempotent.
update public.exercise e
   set setup_note = v.setup_note,
       focus_cue = v.focus_cue,
       foot_position = null,
       seat = null,
       updated_at = greatest(now(), e.updated_at + interval '1 ms')
  from (values
  ('Chest Press (Machine)', 'Griffe auf Brustwarzenhöhe', 'Schulterblätter hinten unten, Brust zusammendrücken'),
  ('Face Pull (Cable)', 'Seil auf Augenhöhe', 'Zum Gesicht ziehen, Ellbogen hoch und nach aussen'),
  ('Incline Chest Press (Dumbbell)', 'Bank 30°', 'Schulterblätter zurück, Hanteln über der oberen Brust zusammenführen'),
  ('Lat Pulldown (Cable)', null, 'Stange zum Schlüsselbein, Ellbogen nach unten hinten, oben voll strecken'),
  ('Lateral Raise (Machine)', 'Sitz 7 · Arme 4', 'Mit dem Ellbogen führen, Trapez locker'),
  ('Leg Press', 'Sitz 3|4 · Ferse 4', 'Druck über die ganze Fusssohle, Knie in Fussrichtung'),
  ('Lying Leg Curl (Machine)', 'Höhe 1 · Füsse 3', 'Hüfte aufs Polster drücken, kontrolliert ablassen'),
  ('Preacher Curl (Machine)', 'Sitz tiefste Stufe, eher vorne · Achseln breit', 'Oberarm aufs Polster, langsam ablassen'),
  ('Seated Dip (Machine)', 'Sitz 3', 'Oberkörper aufrecht, Ellbogen nah am Körper'),
  ('Seated Leg Curl (Machine)', 'Sitz 7 · Beine 4|3 · Füsse 3', 'Hüfte ins Polster, kontrolliert zurück'),
  ('Triceps Pushdown (Cable)', null, 'Ellbogen fix am Körper, unten voll strecken')
  ) v(name, setup_note, focus_cue)
 where e.name = v.name and e.parent_id is null and e.deleted_at is null
   and (e.setup_note is distinct from v.setup_note or e.focus_cue is distinct from v.focus_cue
        or e.foot_position is not null or e.seat is not null);

-- Check: every exercise of an active template with its effective setting and cue
select 'ROW ' || string_agg(distinct coalesce(p.name || ' > ', '') || e.name || ' = ' || coalesce(e.setup_note, p.setup_note, '-')
       || ' / ' || coalesce(e.focus_cue, p.focus_cue, '-'), ' | ')
  from public.template_exercise te
  join public.template t on t.id = te.template_id
  join public.exercise e on e.id = te.exercise_id
  left join public.exercise p on p.id = e.parent_id
 where te.deleted_at is null and t.deleted_at is null and t.archived_at is null;
