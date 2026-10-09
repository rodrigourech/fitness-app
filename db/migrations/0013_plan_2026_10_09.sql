-- 0013_plan_2026_10_09.sql
-- Data only: training plan of 9 October 2026 (Main Day A, Main Day B, Bonus Day, Run).
-- - Archives the previous workouts DAY1, DAY2 and Lauf (section Archive in the app, history unchanged)
-- - Creates the four new workouts with targets, warm-up set, per-workout rest and the exercise notes
-- - Uses the existing exercises (ids from seed/trainingsplan.json; Chest Press variants
--   «Griffe Mitte Brust» for Main Day A and «Sitz tiefer» for Main Day B)
-- Requires 0012. Idempotent (fixed ids, on conflict do nothing). Aborts without changes if an
-- exercise is missing or there is not exactly one owner.

begin;

do $$
declare missing text;
begin
  if (select count(*) from private.app_owner) <> 1 then
    raise exception 'Expected exactly one owner';
  end if;
  select string_agg(x::text, ', ') into missing
    from unnest(array['584aae25-67a2-54c9-b314-2c9c0f6c78d9', '03d8bced-f440-542c-b6eb-0bfd3a4e08ba', 'ce51ba9f-ae6a-5876-b3ee-40df14397a37', 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7', 'c6473665-753c-5771-ba78-c6e0d8c1c89b', '51217eb3-ec3e-52ea-8065-2e689d996e75', 'b587ecd4-4ddc-54f8-86bf-325f26dda158', '6144fd76-baee-5c78-a409-4ce968051388', '09ab0a44-dcd2-5c33-989a-3986f73cdb06', 'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7', '9b59a2a8-77da-57ff-9cc0-14e69c647037']::uuid[]) x
   where not exists (select 1 from public.exercise e where e.id = x and e.deleted_at is null);
  if missing is not null then
    raise exception 'Missing exercises: %', missing;
  end if;
end
$$;

-- Previous workouts into the archive
update public.template set archived_at = now(), updated_at = now()
 where name in ('DAY1', 'DAY2', 'Lauf') and deleted_at is null and archived_at is null;

-- Notes from the plan (column «App Kommentar»), only where an exercise has no note yet,
-- so more detailed notes edited in the app are kept
update public.exercise set setup_note = 'Oben
Level 7', updated_at = now() where id = '584aae25-67a2-54c9-b314-2c9c0f6c78d9' and setup_note is null;
update public.exercise set setup_note = 'Oben
Griffe Mitte Brust (Brustwarzenhöhe)', updated_at = now() where id = '03d8bced-f440-542c-b6eb-0bfd3a4e08ba' and setup_note is null;
update public.exercise set setup_note = 'Oben
Sitz tiefer: Griffe obere Brust (knapp unter Schlüsselbein)', updated_at = now() where id = 'ce51ba9f-ae6a-5876-b3ee-40df14397a37' and setup_note is null;
update public.exercise set setup_note = 'Oben
Kabel auf Handhöhe
rechts beginnt', updated_at = now() where id = 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7' and setup_note is null;
update public.exercise set setup_note = 'Oben', updated_at = now() where id = 'c6473665-753c-5771-ba78-c6e0d8c1c89b' and setup_note is null;
update public.exercise set setup_note = 'Oben
tiefste Sitzhöhe
ganzes Gesäss auf Sitz', updated_at = now() where id = '51217eb3-ec3e-52ea-8065-2e689d996e75' and setup_note is null;
update public.exercise set setup_note = 'Unten
V-Griff (schwarz)', updated_at = now() where id = 'b587ecd4-4ddc-54f8-86bf-325f26dda158' and setup_note is null;
update public.exercise set setup_note = 'Unten
Sitz 4
Füsse 2', updated_at = now() where id = '6144fd76-baee-5c78-a409-4ce968051388' and setup_note is null;
update public.exercise set setup_note = 'Unten', updated_at = now() where id = '09ab0a44-dcd2-5c33-989a-3986f73cdb06' and setup_note is null;
update public.exercise set setup_note = 'Unten
Fuss 3
Höhe 1', updated_at = now() where id = 'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7' and setup_note is null;

with o as (select user_id from private.app_owner limit 1)
insert into public.template (id, user_id, name, note, created_at, updated_at, deleted_at)
select v.id::uuid, o.user_id, v.name, v.note::text, now(), now(), null from o, (values
  ('3f38b1e8-3677-5043-9738-2205e2547f79', 'Main Day A', null),
  ('1986dd1e-bcef-5189-8211-8ec6fc78ccc2', 'Main Day B', null),
  ('867e1d0c-3060-577d-9c5c-23de5fcf3f77', 'Bonus Day', null),
  ('a18020c7-1785-5cde-b5e0-385af1addb82', 'Run', null)
) v(id, name, note)
on conflict (id) do nothing;

with o as (select user_id from private.app_owner limit 1)
insert into public.template_exercise (id, user_id, template_id, exercise_id, position, rest_s, comment, created_at, updated_at, deleted_at)
select v.id::uuid, o.user_id, v.t::uuid, v.e::uuid, v.pos::int, v.rest::int, null, now(), now(), null from o, (values
  ('a11851d0-d6b8-5e04-a7db-593fbe43190c', '3f38b1e8-3677-5043-9738-2205e2547f79', '584aae25-67a2-54c9-b314-2c9c0f6c78d9', 1, null),
  ('f666071d-b59f-5a4b-b0b5-90b575eed941', '3f38b1e8-3677-5043-9738-2205e2547f79', '03d8bced-f440-542c-b6eb-0bfd3a4e08ba', 2, 150),
  ('4471f502-febd-58d0-bf58-68994d89a557', '3f38b1e8-3677-5043-9738-2205e2547f79', 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7', 3, 60),
  ('61a8b4dc-10db-56c7-bc98-b43dec2ca39b', '3f38b1e8-3677-5043-9738-2205e2547f79', 'c6473665-753c-5771-ba78-c6e0d8c1c89b', 4, 90),
  ('09b778a9-d8ba-50a5-b10e-34757594a701', '3f38b1e8-3677-5043-9738-2205e2547f79', '51217eb3-ec3e-52ea-8065-2e689d996e75', 5, 90),
  ('dca196d5-729e-5c11-b927-e78ba3fbd0bc', '3f38b1e8-3677-5043-9738-2205e2547f79', 'b587ecd4-4ddc-54f8-86bf-325f26dda158', 6, 90),
  ('ad032aa2-c7f6-5674-bc42-028c1e14a632', '3f38b1e8-3677-5043-9738-2205e2547f79', '6144fd76-baee-5c78-a409-4ce968051388', 7, 90),
  ('29bcf485-1b13-5907-a992-81edce368e28', '1986dd1e-bcef-5189-8211-8ec6fc78ccc2', '584aae25-67a2-54c9-b314-2c9c0f6c78d9', 1, null),
  ('df180c3c-8b5c-5388-b00c-89c495728553', '1986dd1e-bcef-5189-8211-8ec6fc78ccc2', 'ce51ba9f-ae6a-5876-b3ee-40df14397a37', 2, 150),
  ('16853eb7-20ec-5f81-93c7-84bf8b76105b', '1986dd1e-bcef-5189-8211-8ec6fc78ccc2', 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7', 3, 60),
  ('10426378-c008-53d3-b1c3-669a94a66314', '1986dd1e-bcef-5189-8211-8ec6fc78ccc2', 'c6473665-753c-5771-ba78-c6e0d8c1c89b', 4, 90),
  ('b81f122e-a096-54f4-8e0b-370517c1cea8', '1986dd1e-bcef-5189-8211-8ec6fc78ccc2', '51217eb3-ec3e-52ea-8065-2e689d996e75', 5, 90),
  ('385c2d08-de90-5d2b-94d3-c9163ab5b592', '1986dd1e-bcef-5189-8211-8ec6fc78ccc2', '09ab0a44-dcd2-5c33-989a-3986f73cdb06', 6, 90),
  ('9faab5a4-f732-5b53-a32a-8924ebc3d45f', '1986dd1e-bcef-5189-8211-8ec6fc78ccc2', 'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7', 7, 90),
  ('57e9afd2-3c57-51fb-b09c-df765f23f95a', '867e1d0c-3060-577d-9c5c-23de5fcf3f77', '584aae25-67a2-54c9-b314-2c9c0f6c78d9', 1, null),
  ('0fa0381d-3b26-57e8-9ee6-0819863e6676', '867e1d0c-3060-577d-9c5c-23de5fcf3f77', 'a3f09696-52df-5e8f-a9b3-26ab3c1684f7', 2, 60),
  ('9db482d3-1fa0-5fd8-a290-35b828303152', '867e1d0c-3060-577d-9c5c-23de5fcf3f77', 'c6473665-753c-5771-ba78-c6e0d8c1c89b', 3, 60),
  ('06c026ac-8b2a-5586-b67e-1b63b484d7ed', '867e1d0c-3060-577d-9c5c-23de5fcf3f77', '51217eb3-ec3e-52ea-8065-2e689d996e75', 4, 60),
  ('10b22862-9d54-5d80-8f6f-2bb34a76c506', '867e1d0c-3060-577d-9c5c-23de5fcf3f77', 'b587ecd4-4ddc-54f8-86bf-325f26dda158', 5, 90),
  ('f6954553-b2d7-5068-8e5f-ae2027db2c6a', '867e1d0c-3060-577d-9c5c-23de5fcf3f77', '6144fd76-baee-5c78-a409-4ce968051388', 6, 90),
  ('0de04bf4-e273-5924-8bbd-689917dedc97', 'a18020c7-1785-5cde-b5e0-385af1addb82', '9b59a2a8-77da-57ff-9cc0-14e69c647037', 1, null)
) v(id, t, e, pos, rest)
on conflict (id) do nothing;

with o as (select user_id from private.app_owner limit 1)
insert into public.template_set (id, user_id, template_exercise_id, position, set_type, target_reps_min, target_reps_max, target_weight, target_duration_s, target_distance_km, created_at, updated_at, deleted_at)
select v.id::uuid, o.user_id, v.te::uuid, v.pos::int, v.typ, v.rmin::int, v.rmax::int, v.kg::numeric, v.dur::int, v.km::numeric, now(), now(), null from o, (values
  ('abf8f216-4a32-55d9-8344-40c727dc16fe', 'a11851d0-d6b8-5e04-a7db-593fbe43190c', 1, 'working', null, null, null, 300, null),
  ('c315b036-515c-585e-b1f4-8a278b6f7acc', 'f666071d-b59f-5a4b-b0b5-90b575eed941', 1, 'warmup', 8, 8, 15, null, null),
  ('cfafab83-4d13-5040-ba0b-4e3a7d3cad2d', 'f666071d-b59f-5a4b-b0b5-90b575eed941', 2, 'working', 10, 10, 30, null, null),
  ('e4d162f7-e2a0-5e6c-bd1f-49dd2543140c', 'f666071d-b59f-5a4b-b0b5-90b575eed941', 3, 'working', 10, 10, 30, null, null),
  ('af7510df-4cda-50ac-863e-5adceaf5637b', 'f666071d-b59f-5a4b-b0b5-90b575eed941', 4, 'working', 10, 10, 30, null, null),
  ('11da7ea6-f91f-5ce1-9daf-571df01e4c6a', 'f666071d-b59f-5a4b-b0b5-90b575eed941', 5, 'working', 10, 10, 30, null, null),
  ('20fd847f-9c12-5c40-a6f4-b652c7be2891', '4471f502-febd-58d0-bf58-68994d89a557', 1, 'working', 10, 10, 4.5, null, null),
  ('5bff3a2e-cf1e-5793-9a4c-6cc927ff30f2', '4471f502-febd-58d0-bf58-68994d89a557', 2, 'working', 10, 10, 4.5, null, null),
  ('f9922849-ddb7-5d26-b2ca-953f30b50de1', '4471f502-febd-58d0-bf58-68994d89a557', 3, 'working', 10, 10, 4.5, null, null),
  ('4e5f827a-d80b-5575-a6b2-10c6bbb27060', '61a8b4dc-10db-56c7-bc98-b43dec2ca39b', 1, 'working', 10, 10, 36, null, null),
  ('eb27a06f-6218-55ba-9258-e871fba0a7e9', '61a8b4dc-10db-56c7-bc98-b43dec2ca39b', 2, 'working', 10, 10, 36, null, null),
  ('1f4c9e12-58a5-53c5-ab47-ad371da839b9', '09b778a9-d8ba-50a5-b10e-34757594a701', 1, 'working', 10, 10, 15, null, null),
  ('b33765c7-ea11-5dcf-a94a-314a45108fe4', '09b778a9-d8ba-50a5-b10e-34757594a701', 2, 'working', 10, 10, 15, null, null),
  ('0ba8eec1-37cb-5d55-a009-7adbf9ea68a1', 'dca196d5-729e-5c11-b927-e78ba3fbd0bc', 1, 'working', 10, 10, 45, null, null),
  ('77af106e-153d-5cd6-b02f-d1176c94d127', 'dca196d5-729e-5c11-b927-e78ba3fbd0bc', 2, 'working', 10, 10, 45, null, null),
  ('9a75d0ae-1857-5551-b244-a054164a34bb', 'dca196d5-729e-5c11-b927-e78ba3fbd0bc', 3, 'working', 10, 10, 45, null, null),
  ('a0a1f104-2cc6-506f-b9c2-e8f6d3ac26b7', 'ad032aa2-c7f6-5674-bc42-028c1e14a632', 1, 'working', 10, 10, 90, null, null),
  ('7cd7bcc8-4eab-5188-86a6-9740b819ce3a', 'ad032aa2-c7f6-5674-bc42-028c1e14a632', 2, 'working', 10, 10, 90, null, null),
  ('3f50948a-6921-5246-88bb-d01b2492fb3a', 'ad032aa2-c7f6-5674-bc42-028c1e14a632', 3, 'working', 10, 10, 90, null, null),
  ('2c72c403-b5d8-5644-b960-be13cea72510', '29bcf485-1b13-5907-a992-81edce368e28', 1, 'working', null, null, null, 300, null),
  ('914c8c42-55e0-54b6-87f0-cc3550e30a65', 'df180c3c-8b5c-5388-b00c-89c495728553', 1, 'warmup', 8, 8, 15, null, null),
  ('6d8441da-bee6-54ab-b6b8-4aaefa8f5966', 'df180c3c-8b5c-5388-b00c-89c495728553', 2, 'working', 10, 10, 30, null, null),
  ('10e94f9e-6946-59c4-9e18-0eee1973ff7e', 'df180c3c-8b5c-5388-b00c-89c495728553', 3, 'working', 10, 10, 30, null, null),
  ('52302ea3-43eb-55a8-88f4-cc7445cdcaa7', 'df180c3c-8b5c-5388-b00c-89c495728553', 4, 'working', 10, 10, 30, null, null),
  ('425613ed-da42-5128-8866-a8092f2c4c6b', 'df180c3c-8b5c-5388-b00c-89c495728553', 5, 'working', 10, 10, 30, null, null),
  ('daa992a5-4d6c-5413-a15c-d0cf1962621c', '16853eb7-20ec-5f81-93c7-84bf8b76105b', 1, 'working', 10, 10, 4.5, null, null),
  ('ccd534ce-5dd6-5b42-acd1-aa1cc1b67401', '16853eb7-20ec-5f81-93c7-84bf8b76105b', 2, 'working', 10, 10, 4.5, null, null),
  ('736ef2ce-b312-5e32-a08b-d031e7c277e1', '16853eb7-20ec-5f81-93c7-84bf8b76105b', 3, 'working', 10, 10, 4.5, null, null),
  ('d7942d69-44dd-51d8-9479-cc4b85329ffa', '10426378-c008-53d3-b1c3-669a94a66314', 1, 'working', 10, 10, 36, null, null),
  ('7a9a7c05-6a82-5387-a5d0-accc81a5251d', '10426378-c008-53d3-b1c3-669a94a66314', 2, 'working', 10, 10, 36, null, null),
  ('3a7af247-b0c3-5860-be13-2cb240fcd605', 'b81f122e-a096-54f4-8e0b-370517c1cea8', 1, 'working', 10, 10, 15, null, null),
  ('eefbecbe-364d-50cd-808a-948474c09d3a', 'b81f122e-a096-54f4-8e0b-370517c1cea8', 2, 'working', 10, 10, 15, null, null),
  ('c05fd459-e027-5bbb-839a-4d01ce1c6d0b', '385c2d08-de90-5d2b-94d3-c9163ab5b592', 1, 'working', 10, 10, 39, null, null),
  ('5b30def8-5231-566e-8c8a-f15e25320941', '385c2d08-de90-5d2b-94d3-c9163ab5b592', 2, 'working', 10, 10, 39, null, null),
  ('51750a63-5607-55a1-9919-4f1da88a121a', '385c2d08-de90-5d2b-94d3-c9163ab5b592', 3, 'working', 10, 10, 39, null, null),
  ('c1443e29-bec9-5530-8ca5-5fe6765a3690', '9faab5a4-f732-5b53-a32a-8924ebc3d45f', 1, 'working', 10, 10, 35, null, null),
  ('d5874e4f-00b9-5ceb-a7a3-fe3fcf452fc5', '9faab5a4-f732-5b53-a32a-8924ebc3d45f', 2, 'working', 10, 10, 35, null, null),
  ('79ab4ece-14b5-54e1-b71f-b85318c313c2', '9faab5a4-f732-5b53-a32a-8924ebc3d45f', 3, 'working', 10, 10, 35, null, null),
  ('39e4f137-7b02-5aa5-a940-6e1dc1adaa81', '57e9afd2-3c57-51fb-b09c-df765f23f95a', 1, 'working', null, null, null, 300, null),
  ('2c6d5d52-e5d3-5d46-b187-dee71ba54ccf', '0fa0381d-3b26-57e8-9ee6-0819863e6676', 1, 'working', 10, 10, 4.5, null, null),
  ('405b2924-2c5c-5254-97dc-5230815d9a11', '0fa0381d-3b26-57e8-9ee6-0819863e6676', 2, 'working', 10, 10, 4.5, null, null),
  ('51d9939e-b984-5b86-88e0-3eed3def9ad4', '0fa0381d-3b26-57e8-9ee6-0819863e6676', 3, 'working', 10, 10, 4.5, null, null),
  ('b0d10944-5552-5044-9e17-92253bcc5fb8', '9db482d3-1fa0-5fd8-a290-35b828303152', 1, 'working', 10, 10, 36, null, null),
  ('3a6b4285-b898-5626-b76f-eb26ffdfa340', '9db482d3-1fa0-5fd8-a290-35b828303152', 2, 'working', 10, 10, 36, null, null),
  ('40eb07a5-f8ed-583d-a5c2-f0be5010554f', '9db482d3-1fa0-5fd8-a290-35b828303152', 3, 'working', 10, 10, 36, null, null),
  ('afa9db61-7354-5e5b-a2a2-77af35de045c', '06c026ac-8b2a-5586-b67e-1b63b484d7ed', 1, 'working', 10, 10, 15, null, null),
  ('fd6a8cfe-b9c1-5b17-b5d3-4fa693e2fe44', '06c026ac-8b2a-5586-b67e-1b63b484d7ed', 2, 'working', 10, 10, 15, null, null),
  ('e4f0d453-3e52-5529-b7b5-82f691e2c8ff', '06c026ac-8b2a-5586-b67e-1b63b484d7ed', 3, 'working', 10, 10, 15, null, null),
  ('cb219692-f80c-5e62-a3f5-94cbe7a03ac5', '10b22862-9d54-5d80-8f6f-2bb34a76c506', 1, 'working', 10, 10, 39, null, null),
  ('a63c865f-31ac-5cda-83bf-7ccebcf89b6e', '10b22862-9d54-5d80-8f6f-2bb34a76c506', 2, 'working', 10, 10, 39, null, null),
  ('af39f528-b360-5be6-8a5a-0967f5eb59b7', '10b22862-9d54-5d80-8f6f-2bb34a76c506', 3, 'working', 10, 10, 39, null, null),
  ('9f8dee6d-a37e-5b43-882d-3f59b1b6dbaa', 'f6954553-b2d7-5068-8e5f-ae2027db2c6a', 1, 'working', 10, 10, 90, null, null),
  ('58fde33f-537f-53e3-8d5d-309fb525165d', 'f6954553-b2d7-5068-8e5f-ae2027db2c6a', 2, 'working', 10, 10, 90, null, null),
  ('f2516209-483a-50bf-8c36-75f03f4c1e2b', 'f6954553-b2d7-5068-8e5f-ae2027db2c6a', 3, 'working', 10, 10, 90, null, null),
  ('e551cefa-d645-5023-81f0-65e870e96906', '0de04bf4-e273-5924-8bbd-689917dedc97', 1, 'working', null, null, null, null, 7)
) v(id, te, pos, typ, rmin, rmax, kg, dur, km)
on conflict (id) do nothing;

commit;
