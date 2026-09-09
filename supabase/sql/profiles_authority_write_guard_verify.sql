-- Metadata-only verification. No real account impersonation or member writes.
begin read only;
do $$
declare
  guard_oid oid := to_regprocedure('private.guard_profile_authority_write()');
begin
  if guard_oid is null then raise exception 'Profile authority guard is missing'; end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.profiles'::regclass
      and t.tgname='profiles_guard_authority_write' and not t.tgisinternal
      and t.tgfoid=guard_oid and t.tgenabled='O' and t.tgtype=23
      and not p.prosecdef and p.proconfig @> array['search_path=""']::text[]
  ) then raise exception 'Profile authority guard trigger configuration is invalid'; end if;
  if has_function_privilege('anon',guard_oid,'EXECUTE')
     or has_function_privilege('authenticated',guard_oid,'EXECUTE') then
    raise exception 'Guard function must not be a client-callable RPC';
  end if;
end;
$$;
select 'PASS: authority guard installed; no member data changed' as result;
commit;
