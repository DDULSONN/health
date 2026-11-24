-- A small support inbox; does not alter payments, vouchers, matches or disclosure.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table if not exists public.contact_care_checkout_support (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.dating_1on1_match_proposals(id) on delete cascade,
  reason text not null check(reason in ('checkout_pending','payment_history','multiple_orders')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  unique(user_id,match_id),
  check((resolved_at is null)=(resolved_by is null))
);
create index if not exists contact_care_checkout_support_member_idx
  on public.contact_care_checkout_support(user_id,created_at desc);
create index if not exists contact_care_checkout_support_list_idx
  on public.contact_care_checkout_support(created_at desc,id desc);
create index if not exists contact_care_checkout_support_open_idx
  on public.contact_care_checkout_support(created_at desc,id desc) where resolved_at is null;
alter table public.contact_care_checkout_support enable row level security;
revoke all on public.contact_care_checkout_support from public,anon,authenticated,service_role;
grant select on public.contact_care_checkout_support to service_role;

create or replace function public.request_contact_care_checkout_support(p_user uuid,p_match uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare
  m public.dating_1on1_match_proposals%rowtype;
  r public.contact_care_checkout_support%rowtype;
  order_count integer;
  review_history boolean;
  support_reason text;
begin
  if p_user is null or p_match is null then raise exception 'CARE_SUPPORT_MATCH'; end if;
  -- Same lock order as checkout and voucher use. The per-wallet lock also
  -- serializes the support rate cap if different matches are filed together.
  perform pg_advisory_xact_lock(hashtextextended(p_match::text,15000));
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,17003));
  select * into m from public.dating_1on1_match_proposals where id=p_match for share;
  if not found or m.source_user_id is null or m.candidate_user_id is null
    or m.source_user_id=m.candidate_user_id or p_user not in(m.source_user_id,m.candidate_user_id)
    then raise exception 'CARE_SUPPORT_MATCH'; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=p_user and p.phone_verified is true and not coalesce(p.is_banned,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
    then raise exception 'CARE_SUPPORT_MATCH'; end if;

  -- A delayed retry can recover the same tracking reference after the hold clears.
  select * into r from public.contact_care_checkout_support where user_id=p_user and match_id=p_match;
  if found then return jsonb_build_object('ok',true,'supportReference',r.id,'alreadyRequested',true,'alreadyResolved',r.resolved_at is not null); end if;

  if m.state is distinct from 'mutual_accepted' or m.contact_exchange_status is null
    or m.contact_exchange_status not in ('none','awaiting_applicant_payment')
    or m.contact_exchange_paid_at is not null or m.contact_exchange_approved_at is not null
    then raise exception 'CARE_SUPPORT_NOT_BLOCKED'; end if;
  if not exists(select 1 from public.contact_care_manual_vouchers v where v.user_id=p_user and v.used_at is null and v.revoked_at is null)
    and not exists(select 1 from public.contact_care_claims c where c.user_id=p_user and c.status='approved' and c.used_at is null and c.match_id<>p_match)
    then raise exception 'CARE_SUPPORT_NO_CREDIT'; end if;

  -- Match the checkout gate, without calling the provider, fetching PII, or
  -- serializing order identifiers into the support request or response.
  select count(*)::integer,coalesce(bool_or(o.status is distinct from 'ready'
      or o.payment_key is not null or o.approved_at is not null or o.canceled_at is not null or coalesce(o.cancel_amount,0)<>0
      or o.user_id is null or o.user_id not in(m.source_user_id,m.candidate_user_id)
      or o.toss_order_id is null or o.toss_order_id !~ '^[a-zA-Z0-9_-]{6,64}$' or o.amount is null or o.amount<=0), false)
    into order_count,review_history
    from (select status,payment_key,approved_at,canceled_at,cancel_amount,user_id,toss_order_id,amount
      from public.toss_test_payment_orders where product_type='one_on_one_contact_exchange' and product_ref_id=p_match
      and (status in ('ready','paid') or payment_key is not null or approved_at is not null) limit 9) o;
  if order_count=0 then raise exception 'CARE_SUPPORT_NOT_BLOCKED'; end if;
  if (select count(*) from (select id from public.contact_care_checkout_support where user_id=p_user
      and created_at>=now()-interval '24 hours' limit 5) recent)>=5 then raise exception 'CARE_SUPPORT_LIMIT'; end if;
  support_reason := case when order_count>8 then 'multiple_orders' when review_history then 'payment_history' else 'checkout_pending' end;
  insert into public.contact_care_checkout_support(user_id,match_id,reason)
    values(p_user,p_match,support_reason) returning * into r;
  return jsonb_build_object('ok',true,'supportReference',r.id,'alreadyRequested',false,'alreadyResolved',false);
end;
$$;

create or replace function public.resolve_contact_care_checkout_support(p_admin uuid,p_reference uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare r public.contact_care_checkout_support%rowtype; repeated boolean;
begin
  if p_admin is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=p_admin and p.role='admin' and not coalesce(p.is_banned,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then raise exception 'CARE_SUPPORT_ADMIN'; end if;
  select * into r from public.contact_care_checkout_support where id=p_reference for update;
  if not found then raise exception 'CARE_SUPPORT_MISSING'; end if;
  repeated := r.resolved_at is not null;
  if not repeated then
    update public.contact_care_checkout_support set resolved_at=now(),resolved_by=p_admin where id=r.id returning * into r;
  end if;
  return jsonb_build_object('ok',true,'reference',r.id,'resolvedAt',r.resolved_at,'resolvedBy',r.resolved_by,'alreadyResolved',repeated);
end;
$$;

revoke all on function public.request_contact_care_checkout_support(uuid,uuid),public.resolve_contact_care_checkout_support(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.request_contact_care_checkout_support(uuid,uuid),public.resolve_contact_care_checkout_support(uuid,uuid) to service_role;
commit;
notify pgrst,'reload schema';
