-- 0006_exercise_notes_safe.sql
-- Safe re-run of 0004: 0004 was not applied on production (check 5 October 2026: 6 notes, 4 template comments).
-- Fills setup_note only where it is still empty, so notes edited in the app are kept. Idempotent.
-- Data only, no schema change (no Data API refresh needed).

begin;

update public.exercise set setup_note = E'Oben\nLevel 7', floor = null, seat = null, foot_position = null, updated_at = now() where id = '584aae25-67a2-54c9-b314-2c9c0f6c78d9' and setup_note is null;  -- bicycle
update public.exercise set setup_note = E'Oben', floor = null, seat = null, foot_position = null, updated_at = now() where id = '1f3d184e-fccb-514f-a554-b6a6cbbc7380' and setup_note is null;  -- chest_press
update public.exercise set setup_note = E'Oben\nGriffe auf Brustwarzenhöhe\nAufwärmen wird nicht erfasst', floor = null, seat = null, foot_position = null, updated_at = now() where id = '03d8bced-f440-542c-b6eb-0bfd3a4e08ba' and setup_note is null;  -- chest_press_mid
update public.exercise set setup_note = E'Oben\nSitz tiefer, Griffe obere Brust (knapp unter dem Schlüsselbein)\nAufwärmen wird nicht erfasst', floor = null, seat = null, foot_position = null, updated_at = now() where id = 'ce51ba9f-ae6a-5876-b3ee-40df14397a37' and setup_note is null;  -- chest_press_low_seat
update public.exercise set setup_note = E'Oben\nKabel auf Handhöhe\nSeiten abwechselnd, rechts beginnt\nWiederholungen je Seite', floor = null, seat = null, foot_position = null, updated_at = now() where id = 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7' and setup_note is null;  -- lateral_raise_cable
update public.exercise set setup_note = E'Oben', floor = null, seat = null, foot_position = null, updated_at = now() where id = 'c6473665-753c-5771-ba78-c6e0d8c1c89b' and setup_note is null;  -- triceps_pushdown_bar
update public.exercise set setup_note = E'Oben', floor = null, seat = null, foot_position = null, updated_at = now() where id = '51217eb3-ec3e-52ea-8065-2e689d996e75' and setup_note is null;  -- preacher_curl_machine
update public.exercise set setup_note = E'Oben', floor = null, seat = null, foot_position = null, updated_at = now() where id = 'f1a5b601-f90c-5af6-8638-3e07239ec4c5' and setup_note is null;  -- decline_crunch
update public.exercise set setup_note = E'Oben\nBank −15 Grad\nAb 2 × 15 mit 5 kg Scheibe', floor = null, seat = null, foot_position = null, updated_at = now() where id = 'ed13da4b-ac33-57f7-8cda-c3aae3c9dded' and setup_note is null;  -- decline_crunch_15
update public.exercise set setup_note = E'Unten', floor = null, seat = null, foot_position = null, updated_at = now() where id = '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50' and setup_note is null;  -- lat_pulldown_cable
update public.exercise set setup_note = E'Unten\nV-Griff (schwarz)', floor = null, seat = null, foot_position = null, updated_at = now() where id = 'b587ecd4-4ddc-54f8-86bf-325f26dda158' and setup_note is null;  -- lat_pulldown_vgrip
update public.exercise set setup_note = E'Unten\nSitz 4, Füsse 2', floor = null, seat = null, foot_position = null, updated_at = now() where id = '6144fd76-baee-5c78-a409-4ce968051388' and setup_note is null;  -- leg_press
update public.exercise set setup_note = E'Unten', floor = null, seat = null, foot_position = null, updated_at = now() where id = '09ab0a44-dcd2-5c33-989a-3986f73cdb06' and setup_note is null;  -- seated_row_cable
update public.exercise set setup_note = E'Unten\nFuss 3, Höhe 1', floor = null, seat = null, foot_position = null, updated_at = now() where id = 'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7' and setup_note is null;  -- lying_leg_curl
update public.exercise set setup_note = null, floor = null, seat = null, foot_position = null, updated_at = now() where id = '9b59a2a8-77da-57ff-9cc0-14e69c647037' and setup_note is null;  -- running

-- Template comments ("Je Seite", "Aufwärmen wird nicht erfasst") are part of the exercise notes
update public.template_exercise set comment = null, updated_at = now() where comment is not null;
update public.workout_exercise set comment = null, updated_at = now() where comment is not null;

commit;
