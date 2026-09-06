-- Read-only assertions after profiles_read_privacy_hardening.sql.
-- Run as the database owner. No profile values are returned or modified.
begin;
set local statement_timeout = '30s';

-- Capture only a test subject ID inside the transaction; do not output it.
do $$
declare subject uuid;
begin
  select user_id into subject from public.profiles order by user_id limit 1;
  if subject is null then raise exception 'Verification needs an existing profile'; end if;
  perform set_config('privacy_check.subject', subject::text, true);
end;
$$;

set local role anon;
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  if exists (select 1 from public.profiles) then
    raise exception 'FAIL: anonymous profile access is still open';
  end if;
end;
$$;
reset role;

set local role authenticated;
do $$
declare subject text := current_setting('privacy_check.subject');
begin
  perform set_config('request.jwt.claim.sub', subject, true);
  perform set_config('request.jwt.claims', json_build_object('sub', subject, 'role', 'authenticated')::text, true);
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FAIL: self profile access does not return exactly one row';
  end if;
  if exists (select 1 from public.profiles where user_id <> subject::uuid) then
    raise exception 'FAIL: another user profile is visible';
  end if;
end;
$$;
reset role;

set local role service_role;
do $$
begin
  if not exists (select 1 from public.profiles) then
    raise exception 'FAIL: server profile access is unavailable';
  end if;
end;
$$;
reset role;

select 'PASS: anonymous denied, self preserved, other users denied, server preserved' as result;
rollback;
