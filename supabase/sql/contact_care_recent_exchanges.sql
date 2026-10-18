-- Allow pre-launch paid exchanges still within the original 72-hour deadline.
-- Existing claims, payments, credit grants and the notice start time stay intact.
-- Apply after contact_care.sql. Safe to run repeatedly.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $$ begin
  if to_regprocedure('public.check_contact_care_application(uuid,uuid,uuid)') is null then
    raise exception 'Install contact_care.sql first';
  end if;
end $$;

create or replace function public.check_contact_care_application(p_user uuid,p_match uuid,p_order uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare c public.contact_care_claims%rowtype; m public.dating_1on1_match_proposals%rowtype;
begin
  select * into c from public.contact_care_claims where user_id=p_user;
  if c.status in ('approved','pending') then raise exception 'CARE_ONCE'; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=p_user and not coalesce(p.is_banned,false) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())) then raise exception 'CARE_UNAVAILABLE'; end if;
  select * into m from public.dating_1on1_match_proposals where id=p_match;
  if not public.contact_care_paid(p_user,p_match,p_order) then raise exception 'CARE_PAYMENT'; end if;
  if c.status='needs_info' and c.match_id=p_match and c.order_id=p_order then
    if c.supplement_due_at is null or now()>c.supplement_due_at then raise exception 'CARE_SUPPLEMENT'; end if;
    return; -- timely initial applications may supplement after the original deadline, even during a pause.
  end if;
  if c.status='needs_info' then raise exception 'CARE_ONCE'; end if;
  if not exists(select 1 from public.contact_care_policy p
    where p.id and p.enabled and p.starts_at<=now()) then raise exception 'CARE_INACTIVE'; end if;
  if coalesce(m.contact_exchange_approved_at,case when c.match_id=p_match and c.order_id=p_order then c.exchanged_at end) is null
    or now()>coalesce(m.contact_exchange_approved_at,case when c.match_id=p_match and c.order_id=p_order then c.exchanged_at end)+interval '72 hours'
    then raise exception 'CARE_DEADLINE'; end if;
end;
$$;
-- CREATE OR REPLACE preserves the existing function owner and execute grants.
commit;
