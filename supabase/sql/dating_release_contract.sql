-- Catalog-only deployment preflight. Never reads or changes member records.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
create or replace function public.check_dating_release_contract()
returns jsonb language sql stable security definer set search_path = pg_catalog
set statement_timeout = '5s' as $$
with required_tables(name, columns, service_privileges, private_table) as (values
  ('dating_user_blocks', array['id','blocker_user_id','blocked_user_id','reason','created_at'], array['SELECT','INSERT','UPDATE','DELETE'], true),
  ('dating_1on1_candidate_hides', array['id','user_id','candidate_user_id','candidate_card_id','candidate_name','created_at'], array['SELECT'], true),
  ('dating_user_reports', array['reporter_user_id','reported_user_id','target_type','target_id','status'], array['SELECT','INSERT','UPDATE'], false),
  ('dating_1on1_match_proposals', array['id','source_user_id','candidate_user_id','state','contact_exchange_status','contact_exchange_paid_at','contact_exchange_approved_at'], array['SELECT','INSERT','UPDATE'], false)
), table_checks as (
  select t.name, coalesce(c.relrowsecurity, false) and c.relkind='r'
    and not exists(select 1 from unnest(t.columns) col where not exists(
      select 1 from pg_attribute a where a.attrelid=c.oid and a.attname=col and a.attnum>0 and not a.attisdropped))
    and not exists(select 1 from unnest(t.service_privileges) privilege where not has_table_privilege('service_role',c.oid,privilege))
    and (not t.private_table or not exists(select 1 from unnest(array['anon','authenticated']) role_name
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
      where has_table_privilege(role_name,c.oid,privilege))) as ok
  from required_tables t left join pg_namespace n on n.nspname='public'
  left join pg_class c on c.relnamespace=n.oid and c.relname=t.name
), required_functions(signature) as (values
  ('public.hide_dating_1on1_candidate(uuid,uuid,uuid)'),
  ('public.restore_dating_1on1_candidate(uuid,uuid)')
), function_checks as (
  select signature as name, p.oid is not null and p.prosecdef
    and has_function_privilege('service_role',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not has_function_privilege('authenticated',p.oid,'EXECUTE') as ok
  from required_functions r left join pg_proc p on p.oid=to_regprocedure(r.signature)
), checks as (
  select name, coalesce(ok,false) ok from table_checks
  union all select name,coalesce(ok,false) from function_checks
  union all select 'private_hides_writes', coalesce(not has_table_privilege('service_role',to_regclass('public.dating_1on1_candidate_hides'),'INSERT,UPDATE,DELETE'),false)
  union all select 'block_pair_unique', exists(select 1 from pg_constraint c where c.conrelid=to_regclass('public.dating_user_blocks') and c.contype='u'
    and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid=c.conrelid and a.attnum=any(c.conkey))=array['blocked_user_id','blocker_user_id'])
  union all select 'hide_pair_unique', exists(select 1 from pg_constraint c where c.conrelid=to_regclass('public.dating_1on1_candidate_hides') and c.contype='u'
    and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid=c.conrelid and a.attnum=any(c.conkey))=array['candidate_user_id','user_id'])
)
select jsonb_build_object('version',1,'ok',bool_and(ok),
  'checks',jsonb_agg(jsonb_build_object('name',name,'ok',ok) order by name)) from checks;
$$;
revoke all on function public.check_dating_release_contract() from public,anon,authenticated,service_role;
grant execute on function public.check_dating_release_contract() to service_role;
commit;
notify pgrst, 'reload schema';
