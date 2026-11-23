-- 0058_preacher_curl_cable_alternative.sql
-- Data only, 23 November 2026 (Rodrigo): Cable Curl is the alternative of Preacher Curl (Machine) when the machine is
-- taken, in Full Body A and B. One direction only: in Full Body B the Cable Curl follows the Preacher Curl, so it does
-- not offer the Preacher Curl back. Progression stays per exercise; a Cable Curl done instead of the Preacher Curl
-- counts in the Cable Curl history (with a fresher biceps than in B, noted for the plan review on 10 December).

begin;

update public.exercise
   set alternative_id = '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3',   -- Cable Curl
       updated_at = greatest(now(), updated_at + interval '1 ms')
 where id = '51217eb3-ec3e-52ea-8065-2e689d996e75'                 -- Preacher Curl (Machine)
   and deleted_at is null
   and alternative_id is distinct from '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3';

do $$
begin
  if (select alternative_id from public.exercise where id = '51217eb3-ec3e-52ea-8065-2e689d996e75') is distinct from '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3'
     or not exists (select 1 from public.exercise where id = '9ae34067-6ea2-544b-87c2-c17ec0a2f7f3' and deleted_at is null) then
    raise exception 'Preacher Curl alternative not set';
  end if;
end
$$;

commit;

-- Check
select e.name || ' ⇄ ' || a.name as alternative
  from public.exercise e join public.exercise a on a.id = e.alternative_id
 where e.id = '51217eb3-ec3e-52ea-8065-2e689d996e75';
