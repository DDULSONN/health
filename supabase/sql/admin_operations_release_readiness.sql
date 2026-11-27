-- Catalog-only checklist. This file does not install or modify anything.
-- Run using the project's operator role. A false check requires a separate
-- reviewed remediation; this report is not wired to the existing build gate.
with targets as (
  select to_regclass('public.admin_audit_logs') as audit_table,
         to_regclass('public.toss_test_payment_orders') as orders
)
select 'admin_audit_exists_with_rls' as check_name,
       coalesce((select relrowsecurity from pg_class where oid=targets.audit_table), false) as ok
from targets
union all
select 'member_cannot_create_payment_order_rows',
       orders is not null and not coalesce(has_table_privilege('authenticated', orders, 'INSERT'), true)
         and not coalesce(has_any_column_privilege('authenticated', orders, 'INSERT'), true)
from targets
union all
select 'guest_cannot_create_payment_order_rows',
       orders is not null and not coalesce(has_table_privilege('anon', orders, 'INSERT'), true)
         and not coalesce(has_any_column_privilege('anon', orders, 'INSERT'), true)
from targets
union all
select 'existing_member_only_policy_enabled', exists (
  select 1 from pg_class where oid=to_regclass('public.dating_cards') and relrowsecurity
) and exists (
  select 1 from pg_policies
  where schemaname='public' and tablename='dating_cards' and policyname='dating_cards_members_only_anon'
    and permissive='RESTRICTIVE' and cmd='SELECT' and roles @> array['anon']::name[]
);
