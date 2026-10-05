-- 0010_body_photo.sql
-- Body weight: circumstance of the measurement and a note.
-- Progress photos: only metadata here; the image itself is encrypted in the app (AES-256-GCM, key from
-- the user's photo passphrase) and stored in the private Neon bucket "body-photos" via the auth proxy.
-- After running: neon data-api refresh-schema --database neondb

begin;

alter table public.body_weight
  add column if not exists condition text
    check (condition in ('morning_fasted', 'after_workout', 'after_meal', 'other')),
  add column if not exists note text;

create table public.body_photo (
  id          uuid primary key,
  user_id     text not null default (auth.user_id()),
  measured_on date not null,
  pose        text check (pose in ('front', 'side', 'back')),
  object_key  text not null,               -- <user_id>/<id> in the bucket body-photos
  iv          text not null,               -- AES-GCM nonce, base64
  mime        text not null,               -- type of the decrypted image, e.g. image/jpeg
  width       integer check (width > 0),
  height      integer check (height > 0),
  bytes       integer check (bytes >= 0),  -- size of the encrypted object
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);

alter table public.body_photo enable row level security;

create policy body_photo_select on public.body_photo for select to authenticated
  using (user_id = (select auth.user_id()) and (select private.is_app_owner()));
create policy body_photo_insert on public.body_photo for insert to authenticated
  with check (user_id = (select auth.user_id()) and (select private.is_app_owner()));
create policy body_photo_update on public.body_photo for update to authenticated
  using (user_id = (select auth.user_id()) and (select private.is_app_owner()))
  with check (user_id = (select auth.user_id()) and (select private.is_app_owner()));

create trigger body_photo_sync_guard before insert or update on public.body_photo
  for each row execute function public.tg_sync_guard();

create index body_photo_sync_idx on public.body_photo (user_id, synced_at);
create index body_photo_date_idx on public.body_photo (user_id, measured_on);

grant select, insert, update on public.body_photo to authenticated;

commit;
