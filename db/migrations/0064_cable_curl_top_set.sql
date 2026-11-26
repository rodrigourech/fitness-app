-- 0064_cable_curl_top_set.sql
-- Data only, 26 November 2026 (Rodrigo): Cable Curl with top set and back-off, as he already does it (27 kg × 8, then
-- 23 kg, one 4.5 kg step ≈ 85 %). The app then suggests 27 / 23 / 23 and raises when the top set reaches 12. No warm-up
-- set (accessory). Idempotent.

begin;

update public.exercise
   set top_set = true, updated_at = greatest(now(), updated_at + interval '1 ms')
 where id = '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3'   -- Cable Curl
   and deleted_at is null and top_set is distinct from true;

do $$
begin
  if (select top_set from public.exercise where id = '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3') is distinct from true then
    raise exception 'Cable Curl top set not on';
  end if;
end
$$;

commit;

select name || ' top_set=' || top_set || ' warm_up=' || coalesce(warm_up::text, '-') from public.exercise
 where id = '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3';
