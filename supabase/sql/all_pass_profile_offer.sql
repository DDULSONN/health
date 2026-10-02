-- Optional, web checkout-only offer. Installing does not charge or grant benefits.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create table if not exists public.all_pass_profile_offers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  offer_id uuid not null unique default gen_random_uuid(),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  order_id uuid unique references public.toss_test_payment_orders(id),
  check (expires_at = starts_at + interval '24 hours')
);
alter table public.all_pass_profile_offers enable row level security;
revoke all on public.all_pass_profile_offers from public, anon, authenticated, service_role;
grant select on public.all_pass_profile_offers to service_role;

create or replace function public.all_pass_profile_offer_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.user_id
    where p.user_id = p_user_id and p.role = 'user' and p.phone_verified is true
      and not coalesce(p.is_banned,false) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
  ) and exists (
    select 1 from public.dating_cards c where c.owner_user_id = p_user_id
      and c.status in ('pending','public') and nullif(btrim(c.instagram_id),'') is not null
  ) and exists (
    select 1 from public.dating_1on1_cards c where c.user_id = p_user_id
      and c.status in ('submitted','reviewing','approved')
  ) and not (
    exists(select 1 from public.dating_1on1_plus_subscriptions s where s.user_id=p_user_id and s.expires_at>now())
    and exists(select 1 from public.dating_swipe_subscription_requests s where s.user_id=p_user_id and s.status='approved' and s.expires_at>now())
  );
$$;

create or replace function public.all_pass_profile_offer_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_offer public.all_pass_profile_offers%rowtype; v_state text;
begin
  if not public.all_pass_profile_offer_eligible(p_user_id) then return null; end if;
  select * into v_offer from public.all_pass_profile_offers where user_id=p_user_id;
  v_state := case when not found then 'available'
    when exists(select 1 from public.toss_test_payment_orders where id=v_offer.order_id and status in ('paid','canceled','failed')) then 'used'
    when v_offer.expires_at <= now() then 'expired' else 'active' end;
  return jsonb_build_object('state',v_state,'offerId',v_offer.offer_id,'startsAt',v_offer.starts_at,
    'expiresAt',v_offer.expires_at,'serverNow',now(),'amount',32000,'originalAmount',39900);
end;
$$;

create or replace function public.start_all_pass_profile_offer(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
set lock_timeout = '2s' set statement_timeout = '3s' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if not public.all_pass_profile_offer_eligible(p_user_id) then return null; end if;
  insert into public.all_pass_profile_offers(user_id,starts_at,expires_at)
    values(p_user_id,v_now,v_now+interval '24 hours') on conflict(user_id) do nothing;
  return public.all_pass_profile_offer_status(p_user_id);
end;
$$;

-- Only the server may replace a provider-confirmed EXPIRED/ABORTED attempt.
-- Unknown/ongoing/paid attempts always keep the same order. The deadline never moves.
create or replace function public.reserve_all_pass_profile_offer_order(
  p_user_id uuid, p_offer_id uuid, p_replace_order_id uuid default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog
set lock_timeout = '2s' set statement_timeout = '3s' as $$
declare v_offer public.all_pass_profile_offers%rowtype; v_order public.toss_test_payment_orders%rowtype;
  v_card uuid; v_new_id uuid := gen_random_uuid(); v_reused boolean := false;
begin
  select * into v_offer from public.all_pass_profile_offers
    where user_id=p_user_id and offer_id=p_offer_id for update;
  if not found or v_offer.expires_at <= clock_timestamp() or not public.all_pass_profile_offer_eligible(p_user_id) then
    raise exception 'ALL_PASS_OFFER_UNAVAILABLE';
  end if;
  if v_offer.order_id is not null then
    select * into v_order from public.toss_test_payment_orders where id=v_offer.order_id for update;
    if not found or v_order.status <> 'ready' then raise exception 'ALL_PASS_ORDER_UNAVAILABLE'; end if;
    if p_replace_order_id is null then v_reused := true;
    elsif p_replace_order_id <> v_order.id then raise exception 'ALL_PASS_ORDER_CHANGED';
    else
      update public.toss_test_payment_orders set status='canceled',updated_at=now() where id=v_order.id;
    end if;
  elsif p_replace_order_id is not null then raise exception 'ALL_PASS_ORDER_CHANGED';
  end if;
  if not v_reused then
    select id into v_card from public.dating_1on1_cards where user_id=p_user_id
      and status in ('submitted','reviewing','approved') order by created_at desc,id limit 1;
    insert into public.toss_test_payment_orders(id,user_id,product_type,product_ref_id,product_meta,toss_order_id,order_name,amount,status)
    values(v_new_id,p_user_id,'dating_all_pass_30d',v_card,
      jsonb_build_object('profileAllPassOfferKey','completed-profile-all-pass-v1','profileAllPassOfferId',v_offer.offer_id,
        'profileAllPassOfferExpiresAt',v_offer.expires_at,'originalAmount',39900,'discountPercent',19.8,'discountAmount',7900,
        'offerPlacement','completed_profile_banner','cardId',v_card,'durationDays',30,'planVersion',2,
        'contactExchangeIncluded',false,'includesOneOnOnePlus',true,'includesSwipePremium',true,
        'swipeDurationDays',30,'swipeDailyLimit',30,'swipePremiumAmount',30000),
      replace(gen_random_uuid()::text,'-',''),'매칭 올패스 30일 · 프로필 완성 약 20% 할인',32000,'ready')
    returning * into v_order;
    update public.all_pass_profile_offers set order_id=v_order.id where user_id=p_user_id;
  end if;
  return jsonb_build_object('id',v_order.id,'orderId',v_order.toss_order_id,'amount',v_order.amount,
    'orderName',v_order.order_name,'expiresAt',v_offer.expires_at,'reused',v_reused);
end;
$$;
revoke all on function public.all_pass_profile_offer_eligible(uuid) from public,anon,authenticated;
revoke all on function public.all_pass_profile_offer_status(uuid) from public,anon,authenticated;
revoke all on function public.start_all_pass_profile_offer(uuid) from public,anon,authenticated;
revoke all on function public.reserve_all_pass_profile_offer_order(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.all_pass_profile_offer_status(uuid) to service_role;
grant execute on function public.start_all_pass_profile_offer(uuid) to service_role;
grant execute on function public.reserve_all_pass_profile_offer_order(uuid,uuid,uuid) to service_role;
commit;
notify pgrst, 'reload schema';
