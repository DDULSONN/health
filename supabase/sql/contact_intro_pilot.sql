-- Install only. DOES NOT activate the pilot, charge users, or change matches/orders.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table if not exists public.contact_intro_campaign (
  id boolean primary key default true check(id),
  starts_at timestamptz not null,
  expires_at timestamptz not null check(expires_at = starts_at + interval '48 hours'),
  stopped_at timestamptz
);
create table if not exists public.contact_intro_offers (
  slot smallint primary key check(slot between 1 and 10),
  offer_id uuid not null unique default gen_random_uuid(),
  match_id uuid unique references public.dating_1on1_match_proposals(id) on delete set null,
  assigned_at timestamptz not null default now(),
  -- No FK: deleting an old order must never make this slot reusable.
  order_id uuid unique
);
create table if not exists public.contact_intro_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slot smallint not null references public.contact_intro_offers(slot)
);
create table if not exists public.contact_intro_attempts (
  order_id uuid primary key,
  slot smallint not null references public.contact_intro_offers(slot)
);
alter table public.contact_intro_campaign enable row level security;
alter table public.contact_intro_offers enable row level security;
alter table public.contact_intro_members enable row level security;
alter table public.contact_intro_attempts enable row level security;
revoke all on public.contact_intro_campaign,public.contact_intro_offers,public.contact_intro_members,public.contact_intro_attempts from public,anon,authenticated,service_role;

-- Native purchases are outside this web-only pilot. The optional native schema
-- is absent on web-only installations; if present, conservatively exclude any
-- account with a store verification attempt (including processing/failure).
create or replace function public.contact_intro_has_store_history(p_users uuid[])
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare result boolean;
begin
  if to_regclass('public.app_purchase_events') is null then return false; end if;
  execute 'select exists(select 1 from public.app_purchase_events where user_id=any($1))' into result using p_users;
  return result;
end;
$$;

-- Older installations do not have the optional user-to-user block feature.
-- Match the existing application's missing-table behavior, but do not swallow
-- permission, column or query failures when that table is present.
create or replace function public.contact_intro_has_user_blocks(p_users uuid[])
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare result boolean;
begin
  if to_regclass('public.dating_user_blocks') is null then return false; end if;
  execute 'select exists(select 1 from public.dating_user_blocks where blocker_user_id=any($1) or blocked_user_id=any($1))'
    into result using p_users;
  return result;
end;
$$;

-- A deliberately conservative FIRST experiment: no previous contact checkout
-- (including abandoned/failed attempts), no previous exchange on either side,
-- no active included-contact Plus, and no block records on either participant.
-- Checking any block record avoids reproducing server HMAC secrets inside SQL.
create or replace function public.contact_intro_eligible(p_match_id uuid, p_initial boolean)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select exists(
    select 1 from public.dating_1on1_match_proposals m
    join public.profiles a on a.user_id=m.source_user_id
    join public.profiles b on b.user_id=m.candidate_user_id
    join auth.users ua on ua.id=a.user_id
    join auth.users ub on ub.id=b.user_id
    join public.dating_1on1_cards ca on ca.id=m.source_card_id and ca.user_id=a.user_id
    join public.dating_1on1_cards cb on cb.id=m.candidate_card_id and cb.user_id=b.user_id
    where m.id=p_match_id and a.user_id<>b.user_id
      and m.state='mutual_accepted' and m.contact_exchange_status='awaiting_applicant_payment'
      and m.contact_exchange_paid_at is null and m.contact_exchange_approved_at is null
      and a.role='user' and b.role='user' and a.phone_verified is true and b.phone_verified is true
      and a.phone_e164 ~ '^\+[1-9][0-9]{7,14}$' and b.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      and not coalesce(a.is_banned,false) and not coalesce(b.is_banned,false)
      and ua.deleted_at is null and ub.deleted_at is null
      and (ua.banned_until is null or ua.banned_until<=now()) and (ub.banned_until is null or ub.banned_until<=now())
      and ca.status in ('submitted','reviewing','approved') and cb.status in ('submitted','reviewing','approved')
      and ca.birth_year between 1960 and extract(year from now() at time zone 'Asia/Seoul')::int-19
      and cb.birth_year between 1960 and extract(year from now() at time zone 'Asia/Seoul')::int-19
      and (not p_initial or (
        m.source_final_responded_at<=now()-interval '24 hours'
        and m.source_final_responded_at>=now()-interval '72 hours'
        and greatest(a.last_meaningful_activity_at,b.last_meaningful_activity_at)>m.source_final_responded_at
        and greatest(a.last_meaningful_activity_at,b.last_meaningful_activity_at)<=now()
      ))
      and not exists(select 1 from public.dating_1on1_match_proposals old
        where (old.source_user_id in(a.user_id,b.user_id) or old.candidate_user_id in(a.user_id,b.user_id))
          and (old.contact_exchange_status in ('approved','payment_pending_admin')
            or old.contact_exchange_paid_at is not null or old.contact_exchange_approved_at is not null))
      and not exists(select 1 from public.toss_test_payment_orders o
        where o.product_type='one_on_one_contact_exchange'
          and (o.user_id in(a.user_id,b.user_id) or o.product_ref_id=m.id)
          and (o.status='paid' or o.approved_at is not null or o.payment_key is not null
            or not exists(select 1 from public.contact_intro_attempts x join public.contact_intro_offers f on f.slot=x.slot
              where f.match_id=m.id and x.order_id=o.id)))
      and not exists(select 1 from public.dating_1on1_plus_subscriptions s
        where s.user_id in(a.user_id,b.user_id) and s.expires_at>now() and s.contact_exchange_included is true)
      and not public.contact_intro_has_user_blocks(array[a.user_id,b.user_id])
      and not exists(select 1 from public.dating_1on1_admin_user_blocks x
        where x.user_a_id in(a.user_id,b.user_id) or x.user_b_id in(a.user_id,b.user_id))
      and not exists(select 1 from public.dating_contact_blocks x where x.user_id in(a.user_id,b.user_id))
      and not exists(select 1 from public.dating_1on1_phone_blocks x where x.user_id in(a.user_id,b.user_id))
      and not public.contact_intro_has_store_history(array[a.user_id,b.user_id])
  );
$$;

-- Explicit operator action AFTER app deployment/verification. Fixed cohort, no
-- refills, no rolling deadline, and repeat activation cannot restart the clock.
create or replace function public.activate_contact_intro_pilot()
returns jsonb language plpgsql security definer set search_path = pg_catalog
set lock_timeout='2s' set statement_timeout='15s' as $$
declare c public.contact_intro_campaign%rowtype; m record; n int:=0; t timestamptz:=clock_timestamp();
begin
  perform pg_advisory_xact_lock(173015,15000);
  select * into c from public.contact_intro_campaign where id;
  if found then
    return jsonb_build_object('alreadyStarted',true,'startsAt',c.starts_at,'expiresAt',c.expires_at,
      'assignedPairs',(select count(*) from public.contact_intro_offers));
  end if;
  insert into public.contact_intro_campaign(id,starts_at,expires_at) values(true,t,t+interval '48 hours');
  for m in select id,source_user_id,candidate_user_id from public.dating_1on1_match_proposals
    where state='mutual_accepted' and contact_exchange_status='awaiting_applicant_payment'
      and source_final_responded_at between t-interval '72 hours' and t-interval '24 hours'
    order by random()
  loop
    exit when n=10;
    -- Share the order-insert lock so an ordinary checkout racing activation
    -- either exists before eligibility, or is rejected after assignment.
    perform pg_advisory_xact_lock(hashtextextended(m.id::text,15000));
    if exists(select 1 from public.contact_intro_members where user_id in(m.source_user_id,m.candidate_user_id))
      or not public.contact_intro_eligible(m.id,true) then continue; end if;
    n:=n+1;
    insert into public.contact_intro_offers(slot,match_id) values(n,m.id);
    insert into public.contact_intro_members(user_id,slot) values(m.source_user_id,n),(m.candidate_user_id,n);
  end loop;
  -- No eligible users: do not consume the one-time activation.
  if n=0 then delete from public.contact_intro_campaign where id; end if;
  return jsonb_build_object('alreadyStarted',false,'startsAt',case when n>0 then t end,
    'expiresAt',case when n>0 then t+interval '48 hours' end,'assignedPairs',n);
end;
$$;

-- Read-only. For checkout lookup retain the binding after expiry/ineligibility
-- so a caller cannot fall through and cancel/replace an existing discount order.
create or replace function public.read_contact_intro_offer(p_user_id uuid,p_match_id uuid,p_checkout boolean default false)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare f public.contact_intro_offers%rowtype; c public.contact_intro_campaign%rowtype; active boolean;
begin
  select o.* into f from public.contact_intro_offers o
    join public.contact_intro_members u on u.slot=o.slot and u.user_id=p_user_id
    join public.dating_1on1_match_proposals m on m.id=o.match_id
    where o.match_id=p_match_id and p_user_id in(m.source_user_id,m.candidate_user_id);
  if not found then return null; end if;
  select * into c from public.contact_intro_campaign where id;
  active:=c.starts_at<=now() and c.expires_at>now() and c.stopped_at is null
    and public.contact_intro_eligible(p_match_id,false)
    and (f.order_id is null or exists(select 1 from public.toss_test_payment_orders where id=f.order_id and status='ready'));
  if not active and not p_checkout and not (f.order_id is not null and public.contact_intro_eligible(p_match_id,false)
    and exists(select 1 from public.toss_test_payment_orders where id=f.order_id and status='ready')) then return null; end if;
  return jsonb_build_object('offerId',f.offer_id,'matchId',f.match_id,'amount',15000,'originalAmount',20000,
    'expiresAt',c.expires_at,'serverNow',now(),'active',active,'hasOrder',f.order_id is not null);
end;
$$;

create or replace function public.reserve_contact_intro_order(p_user_id uuid,p_match_id uuid,p_offer_id uuid,p_replace_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='2s' set statement_timeout='3s' as $$
declare f public.contact_intro_offers%rowtype; c public.contact_intro_campaign%rowtype;
  o public.toss_test_payment_orders%rowtype; reused boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_match_id::text,15000));
  select * into f from public.contact_intro_offers where match_id=p_match_id and offer_id=p_offer_id for update;
  if not found or not exists(select 1 from public.contact_intro_members where slot=f.slot and user_id=p_user_id)
    then raise exception 'CONTACT_INTRO_UNAVAILABLE'; end if;
  perform 1 from public.dating_1on1_match_proposals where id=p_match_id
    and p_user_id in(source_user_id,candidate_user_id) for update;
  if not found then raise exception 'CONTACT_INTRO_UNAVAILABLE'; end if;
  select * into c from public.contact_intro_campaign where id;
  if not public.contact_intro_eligible(p_match_id,false) then raise exception 'CONTACT_INTRO_UNAVAILABLE'; end if;
  if f.order_id is not null then
    select * into o from public.toss_test_payment_orders where id=f.order_id for update;
    if not found or o.status not in ('ready','paid') or o.amount<>15000 or o.product_ref_id<>p_match_id
      then raise exception 'CONTACT_INTRO_ORDER_CHECK_REQUIRED'; end if;
    reused:=true;
    if p_replace_order_id is not null then
      if o.id<>p_replace_order_id or o.status<>'ready' then raise exception 'CONTACT_INTRO_ORDER_CHANGED'; end if;
      -- Only the trusted server supplies this after a provider-confirmed ABORTED/EXPIRED.
      update public.toss_test_payment_orders set status='canceled',updated_at=now() where id=o.id;
      reused:=false;
    end if;
  elsif p_replace_order_id is not null then raise exception 'CONTACT_INTRO_ORDER_CHANGED';
  end if;
  if not reused then
    -- The window gates the FIRST reservation, not recovery of a price already
    -- promised. Provider-confirmed terminal attempts may retry at the same price
    -- after expiry/stop; no extra pairs or users are granted a new discount.
    if f.order_id is null and (c.starts_at>clock_timestamp() or c.expires_at<=clock_timestamp() or c.stopped_at is not null)
      then raise exception 'CONTACT_INTRO_UNAVAILABLE'; end if;
    if not public.contact_intro_eligible(p_match_id,false) then raise exception 'CONTACT_INTRO_UNAVAILABLE'; end if;
    insert into public.toss_test_payment_orders(user_id,product_type,product_ref_id,product_meta,toss_order_id,order_name,amount,status)
    values(p_user_id,'one_on_one_contact_exchange',p_match_id,
      jsonb_build_object('matchId',p_match_id,'contactIntroOfferId',f.offer_id,'contactIntroPilot','first-contact-10-pairs-v1',
        'originalAmount',20000,'discountAmount',5000,'discountPercent',25,'offerExpiresAt',c.expires_at),
      replace(gen_random_uuid()::text,'-',''),'1:1 첫 연락처 교환 · 25% 할인',15000,'ready') returning * into o;
    update public.contact_intro_offers set order_id=o.id where slot=f.slot;
    insert into public.contact_intro_attempts(order_id,slot) values(o.id,f.slot);
  end if;
  return jsonb_build_object('id',o.id,'orderId',o.toss_order_id,'amount',o.amount,'orderName',o.order_name,
    'expiresAt',c.expires_at,'reused',reused,'owned',o.user_id=p_user_id);
end;
$$;

create or replace function public.guard_contact_intro_order_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare f public.contact_intro_offers%rowtype; c public.contact_intro_campaign%rowtype;
begin
  if new.product_type<>'one_on_one_contact_exchange' or new.product_ref_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.product_ref_id::text,15000));
  select * into f from public.contact_intro_offers where match_id=new.product_ref_id;
  if not found then return new; end if;
  select * into c from public.contact_intro_campaign where id;
  -- If no discounted order exists and the member has since used their first
  -- exchange elsewhere, allow the normal checkout after server revalidation.
  -- An existing reservation must still never be replaced at full price.
  if f.order_id is not null or (c.starts_at<=now() and c.expires_at>now() and c.stopped_at is null
    and public.contact_intro_eligible(new.product_ref_id,false)) then
    if new.amount<>15000 or new.product_meta->>'contactIntroOfferId' is distinct from f.offer_id::text
      or exists(select 1 from public.toss_test_payment_orders where id=f.order_id and status in('ready','paid')) then
      raise exception 'CONTACT_INTRO_ORDER_CHECK_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_contact_intro_order_insert on public.toss_test_payment_orders;
create trigger guard_contact_intro_order_insert before insert on public.toss_test_payment_orders
  for each row execute function public.guard_contact_intro_order_insert();

-- All functions are service-only except activation, which requires the SQL
-- operator. There is intentionally no public/admin-web activation endpoint.
revoke all on function public.contact_intro_eligible(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.contact_intro_has_store_history(uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.contact_intro_has_user_blocks(uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.guard_contact_intro_order_insert() from public,anon,authenticated,service_role;
revoke all on function public.activate_contact_intro_pilot() from public,anon,authenticated,service_role;
revoke all on function public.read_contact_intro_offer(uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.reserve_contact_intro_order(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_contact_intro_offer(uuid,uuid,boolean) to service_role;
grant execute on function public.reserve_contact_intro_order(uuid,uuid,uuid,uuid) to service_role;
commit;
notify pgrst,'reload schema';
