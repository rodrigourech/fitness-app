-- 0001_init.sql
-- Initial schema for fitness-app (Neon Postgres, Neon Auth, Data API)
-- Source of truth for explanations: docs/03_datenmodell.md
-- Run once against the production branch.

begin;

create extension if not exists pg_session_jwt;

create or replace function public.tg_sync_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- Last write wins: ein älterer Stand überschreibt keinen neueren
    if new.updated_at < old.updated_at then
      return null;
    end if;
    new.user_id    := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end
$$;

create table public.exercise_catalog (
  id                text primary key,              -- id aus der Free Exercise DB
  name              text not null,
  category          text,
  equipment         text,
  level             text,
  force             text,
  mechanic          text,
  primary_muscles   text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  instructions      text[] not null default '{}',
  images            text[] not null default '{}'    -- relative Pfade im Quell-Repo
);

alter table public.exercise_catalog enable row level security;
create policy exercise_catalog_read on public.exercise_catalog
  for select to authenticated using (true);

create table public.exercise (
  id                uuid primary key,
  user_id           text not null default (auth.user_id()),
  parent_id         uuid references public.exercise (id) deferrable initially deferred,
  name              text not null,
  equipment         text,
  muscles_primary   text[],
  muscles_secondary text[],
  tracking_type     text check (tracking_type in ('weight_reps', 'duration', 'distance_duration')),
  is_unilateral     boolean,
  weight_step       numeric(5,2) check (weight_step > 0),
  default_rest_s    integer check (default_rest_s >= 0),
  floor             text check (floor in ('oben', 'unten')),
  seat              text,
  foot_position     text,
  setup_note        text,
  source_id         text references public.exercise_catalog (id),
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  synced_at         timestamptz not null default now(),
  -- Hauptübungen müssen vollständig sein, Varianten erben
  constraint exercise_root_complete check (
    parent_id is not null
    or (tracking_type is not null and is_unilateral is not null
        and muscles_primary is not null and muscles_secondary is not null)
  )
);

create table public.exercise_link (
  id          uuid primary key,
  user_id     text not null default (auth.user_id()),
  exercise_id uuid not null references public.exercise (id) deferrable initially deferred,
  url         text not null,
  title       text,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

create table public.template (
  id         uuid primary key,
  user_id    text not null default (auth.user_id()),
  name       text not null,
  note       text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at  timestamptz not null default now()
);

create table public.template_exercise (
  id          uuid primary key,
  user_id     text not null default (auth.user_id()),
  template_id uuid not null references public.template (id) deferrable initially deferred,
  exercise_id uuid not null references public.exercise (id) deferrable initially deferred,
  position    integer not null check (position > 0),
  rest_s      integer check (rest_s >= 0),
  comment     text,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

create table public.template_set (
  id                   uuid primary key,
  user_id              text not null default (auth.user_id()),
  template_exercise_id uuid not null references public.template_exercise (id) deferrable initially deferred,
  position             integer not null check (position > 0),
  set_type             text not null check (set_type in ('warmup', 'working')),
  target_reps_min      integer check (target_reps_min >= 0),
  target_reps_max      integer check (target_reps_max >= target_reps_min),
  target_weight        numeric(6,2) check (target_weight >= 0),
  target_duration_s    integer check (target_duration_s >= 0),
  target_distance_km   numeric(6,2) check (target_distance_km >= 0),
  created_at           timestamptz not null,
  updated_at           timestamptz not null,
  deleted_at           timestamptz,
  synced_at            timestamptz not null default now()
);

create table public.workout (
  id                     uuid primary key,
  user_id                text not null default (auth.user_id()),
  template_id            uuid references public.template (id) deferrable initially deferred,
  template_name_snapshot text,
  started_at             timestamptz not null,
  finished_at            timestamptz check (finished_at >= started_at),
  note                   text,
  created_at             timestamptz not null,
  updated_at             timestamptz not null,
  deleted_at             timestamptz,
  synced_at              timestamptz not null default now()
);

create table public.workout_exercise (
  id          uuid primary key,
  user_id     text not null default (auth.user_id()),
  workout_id  uuid not null references public.workout (id) deferrable initially deferred,
  exercise_id uuid not null references public.exercise (id) deferrable initially deferred,
  position    integer not null check (position > 0),
  rest_s      integer check (rest_s >= 0),
  comment     text,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

create table public.workout_set (
  id                  uuid primary key,
  user_id             text not null default (auth.user_id()),
  workout_exercise_id uuid not null references public.workout_exercise (id) deferrable initially deferred,
  position            integer not null check (position > 0),
  set_type            text not null check (set_type in ('warmup', 'working')),
  weight              numeric(6,2) check (weight >= 0),
  reps                integer check (reps >= 0),
  reps_left           integer check (reps_left >= 0),
  reps_right          integer check (reps_right >= 0),
  rir                 integer check (rir between 0 and 10),
  duration_s          integer check (duration_s >= 0),
  distance_km         numeric(6,2) check (distance_km >= 0),
  completed_at        timestamptz,
  created_at          timestamptz not null,
  updated_at          timestamptz not null,
  deleted_at          timestamptz,
  synced_at           timestamptz not null default now()
);

create table public.body_weight (
  id          uuid primary key,
  user_id     text not null default (auth.user_id()),
  measured_on date not null,
  weight_kg   numeric(5,2) not null check (weight_kg between 20 and 300),
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'exercise', 'exercise_link', 'template', 'template_exercise', 'template_set',
    'workout', 'workout_exercise', 'workout_set', 'body_weight'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    -- Lesen, Anlegen, Ändern nur eigene Zeilen; kein Delete (Soft Delete)
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.user_id()))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.user_id()))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.user_id())) with check (user_id = (select auth.user_id()))',
      t || '_update', t);

    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.tg_sync_guard()',
      t || '_sync_guard', t);

    execute format('create index %I on public.%I (user_id, synced_at)', t || '_sync_idx', t);
  end loop;
end
$$;

-- Rechte für die Rolle der Data API; kein DELETE (Soft Delete)
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
revoke insert, update on public.exercise_catalog from authenticated;

create index exercise_parent_idx          on public.exercise (parent_id);
create index exercise_link_exercise_idx   on public.exercise_link (exercise_id);
create index template_exercise_tmpl_idx   on public.template_exercise (template_id);
create index template_set_te_idx          on public.template_set (template_exercise_id);
create index workout_started_idx          on public.workout (user_id, started_at);
create index workout_exercise_workout_idx on public.workout_exercise (workout_id);
create index workout_exercise_ex_idx      on public.workout_exercise (exercise_id);
create index workout_set_we_idx           on public.workout_set (workout_exercise_id);
create index body_weight_date_idx         on public.body_weight (user_id, measured_on);

create view public.exercise_effective
with (security_invoker = true) as
select
  e.id,
  e.parent_id,
  coalesce(p.id, e.id)                              as root_id,
  coalesce(p.name || ' – ' || e.name, e.name)       as display_name,
  coalesce(e.equipment, p.equipment)                as equipment,
  coalesce(e.muscles_primary, p.muscles_primary)    as muscles_primary,
  coalesce(e.muscles_secondary, p.muscles_secondary) as muscles_secondary,
  coalesce(e.tracking_type, p.tracking_type)        as tracking_type,
  coalesce(e.is_unilateral, p.is_unilateral)        as is_unilateral,
  e.weight_step,
  e.default_rest_s,
  e.floor,
  e.seat,
  e.foot_position,
  e.setup_note
from public.exercise e
left join public.exercise p on p.id = e.parent_id
where e.deleted_at is null;

grant select on public.exercise_effective to authenticated;

commit;
