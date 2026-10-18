-- OPERATOR ONLY, after contact_care.sql + contact_care_evidence.sql installation AND verified app deployment.
-- Run only after the owner approves the policy and release.
-- Starts the web-payment pilot; no existing payment, credit or match is modified.
-- Re-running never moves the first eligible-payment date forward.
begin;
set local lock_timeout='3s';
do $$ begin
  if not exists(select 1 from storage.buckets where id='contact-care-evidence' and public=false)
    or not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='contact_care_private_only' and permissive='RESTRICTIVE')
    then raise exception 'Install contact_care_evidence.sql before activation'; end if;
  if to_regprocedure('public.redeem_contact_care(uuid,uuid,text[],text[],text[])') is null
    or to_regprocedure('public.submit_contact_care(uuid,uuid,uuid,timestamp with time zone,text,text,uuid,uuid)') is null
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='contact_care_claims' and column_name='exchanged_at')
    or not exists(select 1 from pg_trigger where tgrelid='public.toss_test_payment_orders'::regclass and tgname='guard_contact_care_order_insert' and tgenabled='O')
    then raise exception 'Install the complete contact_care.sql before activation'; end if;
  if has_table_privilege('anon','public.contact_care_claims','SELECT')
    or has_table_privilege('authenticated','public.contact_care_claims','SELECT')
    or has_function_privilege('anon','public.redeem_contact_care(uuid,uuid,text[],text[],text[])','EXECUTE')
    or has_function_privilege('authenticated','public.redeem_contact_care(uuid,uuid,text[],text[],text[])','EXECUTE')
    then raise exception 'Unsafe contact-care grants; activation refused'; end if;
end $$;
update public.contact_care_policy
set enabled=true, starts_at=coalesce(starts_at,now())
where id;
select enabled,starts_at from public.contact_care_policy where id;
commit;

-- To stop NEW applications only (already granted credits remain usable):
-- update public.contact_care_policy set enabled=false where id;
