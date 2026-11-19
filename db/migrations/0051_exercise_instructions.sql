-- 0051_exercise_instructions.sql
-- Schema and data, 20 November 2026 (Rodrigo): short execution steps per exercise in German, one per line «1) …»,
-- shown in the info window «i» under the videos (design «Uebung_Ausfuehrung_Info», variant A). A pragmatic hint, not a
-- full guide. New column exercise.instructions; null on a variant = inherit from the main exercise. Set for the
-- exercises of Main Day A and B and their alternatives, only where still empty (own edits stay).
-- After running: refresh the Data API schema cache (Console «Refresh schema cache» or neon data-api refresh-schema).
-- Idempotent.

begin;

alter table public.exercise add column if not exists instructions text;

update public.exercise set instructions = v.steps, updated_at = greatest(now(), exercise.updated_at + interval '1 ms')
  from (values
    ('8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', $t$1) Oberschenkel fest unter das Polster, Griff etwas breiter als schulterbreit.
2) Brust heraus, leicht nach hinten lehnen, zuerst die Schultern nach unten ziehen.
3) Stange bis auf Höhe Schlüsselbein ziehen, Ellbogen nach unten und hinten führen.
4) Kontrolliert hoch, bis die Arme fast gestreckt sind, ohne Schwung.$t$),  -- Lat Pulldown (Cable)
    ('6144fd76-baee-5c78-a409-4ce968051388', $t$1) Rücken und Gesäss fest im Polster, Füsse schulterbreit mitten auf der Platte.
2) Kontrolliert absenken bis etwa 90 bis 100 Grad im Knie, das Gesäss bleibt unten.
3) Über die ganze Fusssohle drücken, Knie zeigen in Richtung der Zehen.
4) Oben die Knie nicht ganz durchstrecken.$t$),  -- Leg Press
    ('377d7bce-a5f5-5da6-856e-3a695f79dfe5', $t$1) Sitz so einstellen, dass die Schultern auf Höhe der Drehachse liegen.
2) Oberarme an die Polster, Schultern tief, Oberkörper ruhig.
3) Arme seitlich bis etwa Schulterhöhe heben, mit den Ellbogen führen.
4) Langsam absenken, unten das Gewicht nicht ablegen.$t$),  -- Lateral Raise (Machine)
    ('a3f09696-52df-5e8f-a9b3-26ab3c1684f7', $t$1) Seitlich zum Turm, Rolle unten, Griff in der Hand auf der anderen Seite.
2) Leicht nach vorne geneigt, Ellbogen leicht gebeugt.
3) Arm seitlich bis Schulterhöhe heben, mit dem Ellbogen führen.
4) Langsam absenken, die Schulter bleibt tief.$t$),  -- Lateral Raise (Cable)
    ('0c25dc20-cf47-5ee1-8f49-7245ded33260', $t$1) Sitz so einstellen, dass die Griffe auf Brusthöhe sind.
2) Rücken an die Lehne, Brust heraus, Schultern hinten und tief.
3) Arme mit leicht gebeugten Ellbogen im Bogen vor der Brust zusammenführen.
4) Langsam öffnen, bis ein Zug in der Brust spürbar ist.$t$),  -- Butterfly (Machine)
    ('7ca1c0fa-f1c7-576b-a946-f1832f3dcb14', $t$1) Bank auf etwa 30 Grad, Schulterblätter zusammen und nach unten.
2) Hanteln über der Brust, Unterarme senkrecht, Füsse fest am Boden.
3) Kontrolliert bis zur oberen Brust absenken, Ellbogen etwa 45 Grad vom Körper.
4) Nach oben drücken, ohne die Ellbogen ganz durchzustrecken.$t$),  -- Incline Chest Press (Dumbbell)
    ('767f29a4-918b-5180-92a0-2f2ba5633811', $t$1) Brust fest ans Polster, Sitz so, dass die Griffe auf Brusthöhe sind.
2) Zuerst die Schulterblätter nach hinten und unten ziehen.
3) Ellbogen nah am Körper nach hinten ziehen, die Brust bleibt am Polster.
4) Langsam nach vorne, bis die Arme gestreckt sind.$t$),  -- Chest-Supported Row (Machine)
    ('2b7e9064-ce84-52ec-92ff-d4a73ac45fb0', $t$1) Aufrecht vor dem Turm, Rolle oben, Oberkörper leicht nach vorne.
2) Ellbogen seitlich am Körper fixieren.
3) Nach unten drücken, bis die Arme gestreckt sind.
4) Langsam hoch bis etwa 90 Grad, die Ellbogen bleiben stehen.$t$),  -- Triceps Pushdown (Cable)
    ('5db24cf0-d28b-520b-86bb-d88a8dc490ee', $t$1) Rücken zum Turm, Seil hinter dem Kopf, ein Fuss vorne.
2) Ellbogen zeigen nach vorne oben und bleiben stehen.
3) Unterarme nach vorne oben strecken.
4) Langsam zurück, bis ein Zug im Trizeps spürbar ist.$t$),  -- Overhead Triceps Extension (Cable)
    ('51217eb3-ec3e-52ea-8065-2e689d996e75', $t$1) Sitz so einstellen, dass die Achseln am oberen Rand des Polsters liegen.
2) Oberarme flach auf dem Polster, Handgelenke gerade.
3) Hoch curlen und oben kurz anspannen.
4) Langsam absenken, bis die Arme fast gestreckt sind.$t$),  -- Preacher Curl (Machine)
    ('9ae34067-6ea2-544b-87c2-c17ec0a2f7f3', $t$1) Aufrecht vor dem Turm, Rolle unten, Stange im Untergriff.
2) Ellbogen seitlich am Körper fixieren.
3) Hoch curlen, ohne Schwung aus dem Rücken.
4) Langsam absenken, bis die Arme fast gestreckt sind.$t$),  -- Cable Curl
    ('09ab0a44-dcd2-5c33-989a-3986f73cdb06', $t$1) Füsse an den Stützen, Knie leicht gebeugt, Oberkörper aufrecht.
2) Zuerst die Schulterblätter nach hinten und unten ziehen.
3) Griff zum Bauch ziehen, Ellbogen nah am Körper.
4) Langsam nach vorne, ohne mit dem Oberkörper zu schwingen.$t$),  -- Seated Row (Cable)
    ('4716d4ac-9fda-59f4-883a-c570aa7bd339', $t$1) Knie auf Höhe der Drehachse, Rolle knapp über der Ferse.
2) Oberschenkelpolster fest anlegen, an den Griffen halten.
3) Fersen so weit wie möglich nach unten und hinten ziehen.
4) Langsam zurück, bis die Beine fast gestreckt sind.$t$),  -- Seated Leg Curl (Machine)
    ('1f3d184e-fccb-514f-a554-b6a6cbbc7380', $t$1) Sitz so einstellen, dass die Griffe auf mittlerer Brusthöhe sind.
2) Schulterblätter zusammen und nach unten, Rücken an der Lehne.
3) Nach vorne drücken, ohne die Ellbogen ganz durchzustrecken.
4) Langsam zurück, bis ein Zug in der Brust spürbar ist.$t$),  -- Chest Press (Machine)
    ('07a6fcc8-141d-50b2-9a4b-5f19fa3e7fe8', $t$1) Sitz so einstellen, dass die Griffe etwa auf Hüfthöhe sind.
2) Aufrecht sitzen, Schultern tief, Ellbogen nah am Körper.
3) Nach unten drücken, bis die Arme gestreckt sind.
4) Langsam hoch bis etwa 90 Grad im Ellbogen.$t$)  -- Seated Dip (Machine)
  ) v(id, steps)
 where exercise.id = v.id::uuid and exercise.instructions is null;

commit;

-- Check
select 'ROW ' || count(*) filter (where instructions is not null) || ' exercises with instructions'
  from public.exercise where deleted_at is null and parent_id is null;
