-- Only for the early diagnostic function with the wrong open-card owner column.
-- Preserve the existing function identity, permissions, owner and security settings.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $repair$
declare
  v_oid oid := to_regprocedure('public.admin_onboarding_funnel_summary(integer)');
  v_hash text;
  v_definition text;
  v_metadata jsonb;
begin
  if v_oid is null then
    raise exception 'Install onboarding_funnel.sql first';
  end if;
  select md5(regexp_replace(prosrc, '[[:space:]]', '', 'g')),
    to_jsonb(p) - 'prosrc' into v_hash, v_metadata
    from pg_proc p where oid = v_oid;
  if v_hash = 'aa9a2180954a6d282abb3732059b5234' then return; end if;
  if v_hash <> 'd9942d747cba9aae825ef16e055e2472' then
    raise exception 'Unexpected diagnostic function version; no changes made';
  end if;
  v_definition := replace(pg_get_functiondef(v_oid),
    'public.dating_cards c where c.user_id = p.user_id',
    'public.dating_cards c where c.owner_user_id = p.user_id');
  execute v_definition;
  if not exists(select 1 from pg_proc p where oid = v_oid
    and md5(regexp_replace(prosrc, '[[:space:]]', '', 'g')) = 'aa9a2180954a6d282abb3732059b5234'
    and to_jsonb(p) - 'prosrc' = v_metadata) then
    raise exception 'Diagnostic function verification failed; rolling back';
  end if;
end;
$repair$;
commit;
