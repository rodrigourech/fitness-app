-- 0003_exercise_focus.sql
-- Mind-muscle connection: muscles to feel (regions of the body-muscles map) and a short cue per exercise.
-- NULL on a variant means: inherit from the parent exercise.

begin;

alter table public.exercise add column focus_muscles text[];
alter table public.exercise add column focus_cue text;

-- Initial focus for the seed exercises (confirmed 4 October 2026).
-- updated_at = now() makes the change win over local copies on the next sync.
update public.exercise set focus_muscles = array['chest-upper', 'chest-lower'], focus_cue = 'Brust zusammendrücken, Schulterblätter hinten unten fixiert', updated_at = now() where id = '03d8bced-f440-542c-b6eb-0bfd3a4e08ba';  -- chest_press_mid
update public.exercise set focus_muscles = array['chest-upper'], focus_cue = 'Obere Brust spüren, Ellbogen leicht unter Schulterhöhe', updated_at = now() where id = 'ce51ba9f-ae6a-5876-b3ee-40df14397a37';  -- chest_press_low_seat
update public.exercise set focus_muscles = array['shoulder-side'], focus_cue = 'Mit dem Ellbogen führen, Trapez locker lassen', updated_at = now() where id = 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7';  -- lateral_raise_cable
update public.exercise set focus_muscles = array['triceps-lateral', 'triceps-long'], focus_cue = 'Ellbogen fix am Körper, unten voll strecken', updated_at = now() where id = 'c6473665-753c-5771-ba78-c6e0d8c1c89b';  -- triceps_pushdown_bar
update public.exercise set focus_muscles = array['biceps'], focus_cue = 'Oberarm aufs Polster, langsam ablassen', updated_at = now() where id = '51217eb3-ec3e-52ea-8065-2e689d996e75';  -- preacher_curl_machine
update public.exercise set focus_muscles = array['abs-upper', 'abs-lower'], focus_cue = 'Wirbelsäule einrollen, nicht aus der Hüfte ziehen', updated_at = now() where id = 'ed13da4b-ac33-57f7-8cda-c3aae3c9dded';  -- decline_crunch_15
update public.exercise set focus_muscles = array['lats-upper', 'lats-mid', 'lats-lower'], focus_cue = 'Ellbogen Richtung Hüfte ziehen, Lat spüren', updated_at = now() where id = 'b587ecd4-4ddc-54f8-86bf-325f26dda158';  -- lat_pulldown_vgrip
update public.exercise set focus_muscles = array['lats-mid', 'traps-mid', 'deltoid-rear'], focus_cue = 'Schulterblätter zusammenziehen, Ellbogen nach hinten', updated_at = now() where id = '09ab0a44-dcd2-5c33-989a-3986f73cdb06';  -- seated_row_cable
update public.exercise set focus_muscles = array['quads', 'gluteus-maximus'], focus_cue = 'Druck über die ganze Fusssohle, Knie in Fussrichtung', updated_at = now() where id = '6144fd76-baee-5c78-a409-4ce968051388';  -- leg_press
update public.exercise set focus_muscles = array['hamstrings-medial', 'hamstrings-lateral'], focus_cue = 'Hüfte aufs Polster drücken, kontrolliert ablassen', updated_at = now() where id = 'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7';  -- lying_leg_curl

commit;
