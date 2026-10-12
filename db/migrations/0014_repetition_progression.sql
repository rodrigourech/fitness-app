-- Progression without logged RIR. Apply only after beta approval, then refresh the Data API schema.
-- The beta uses a local snapshot and does not need this migration on production.
-- Nullable exercise settings allow variants to inherit. Workout exercise settings are snapshots.
-- Existing history, including RIR and warm-up sets, is preserved.
begin;

do $$
declare first_run boolean;
begin
  first_run := not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'exercise' and column_name = 'min_reps'
  );

  alter table public.exercise add column if not exists target_reps integer;
  alter table public.exercise add column if not exists min_reps integer;
  alter table public.exercise add column if not exists warm_up boolean;
  alter table public.workout_exercise add column if not exists target_reps integer;
  alter table public.workout_exercise add column if not exists min_reps integer;
  alter table public.workout_exercise add column if not exists warm_up boolean;

  if first_run then
    update public.exercise set target_reps = 10, min_reps = 7, updated_at = now()
      where parent_id is null and tracking_type = 'weight_reps';
    update public.exercise e set warm_up = true, updated_at = now()
      where e.id in (
        '1f3d184e-fccb-514f-a554-b6a6cbbc7380', -- Chest Press
        '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', -- Lat Pulldown
        '09ab0a44-dcd2-5c33-989a-3986f73cdb06', -- Seated Row
        '6144fd76-baee-5c78-a409-4ce968051388', -- Leg Press
        'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7'  -- Lying Leg Curl
      ) or exists (
        select 1 from public.template_exercise te join public.template_set ts on ts.template_exercise_id = te.id
        where te.exercise_id = e.id and te.deleted_at is null and ts.deleted_at is null and ts.set_type = 'warmup'
      );
    update public.exercise set warm_up = false, updated_at = now() where parent_id is null and warm_up is null;

    -- Fixed legacy targets (e.g. 10/10) were not minimum thresholds: inherit the new minimum.
    -- Genuine ranges (e.g. 10/15) and the upper targets remain unchanged.
    update public.template_set set target_reps_min = null, updated_at = now()
      where deleted_at is null and set_type = 'working' and target_reps_min = target_reps_max;
    -- Future workouts show a warm-up reminder; recorded historical warm-ups remain intact.
    update public.template_set set deleted_at = now(), updated_at = now()
      where deleted_at is null and set_type = 'warmup';

    alter table public.exercise add constraint exercise_repetition_targets_valid check (
      (target_reps is null or target_reps between 1 and 100)
      and (min_reps is null or min_reps between 1 and 100)
      and (target_reps is null or min_reps is null or min_reps <= target_reps)
    );
    alter table public.workout_exercise add constraint workout_exercise_repetition_targets_valid check (
      (target_reps is null or target_reps between 1 and 100)
      and (min_reps is null or min_reps between 1 and 100)
      and (target_reps is null or min_reps is null or min_reps <= target_reps)
    );
  end if;
end $$;

commit;
