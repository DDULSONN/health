-- Rollout: apply this file, then dating_love_pass_swipe.sql. Sales remain off
-- until the service operator enables site_settings.dating_love_pass_sale.
-- Fulfillment and already-purchased entitlements are not tied to the sale switch.
begin;
set local lock_timeout = '2s';

-- Preserve every already-installed product kind (including later additions) without
-- recreating the historical allow-list from an older migration.
do $migration$
declare v_expr text;
begin
  select pg_get_expr(c.conbin,c.conrelid) into v_expr
    from pg_constraint c
    where c.conrelid='public.toss_test_payment_orders'::regclass
      and c.conname='toss_test_payment_orders_product_type_check' and c.contype='c';
  if v_expr is null then raise exception 'Toss product constraint missing'; end if;
  if strpos(v_expr,'dating_love_pass_30d')=0 then
    alter table public.toss_test_payment_orders drop constraint toss_test_payment_orders_product_type_check;
    execute format('alter table public.toss_test_payment_orders add constraint toss_test_payment_orders_product_type_check check ((%s) or product_type=%L) not valid',v_expr,'dating_love_pass_30d');
  end if;
end $migration$;

-- Do not change legacy owners' history access. Only the new SKU cannot be
-- inserted, altered, or removed directly through the browser's DB role.
drop policy if exists dating_love_pass_order_insert_guard on public.toss_test_payment_orders;
create policy dating_love_pass_order_insert_guard on public.toss_test_payment_orders as restrictive
  for insert to anon, authenticated with check (product_type<>'dating_love_pass_30d');
drop policy if exists dating_love_pass_order_update_guard on public.toss_test_payment_orders;
create policy dating_love_pass_order_update_guard on public.toss_test_payment_orders as restrictive
  for update to anon, authenticated using (product_type<>'dating_love_pass_30d') with check (product_type<>'dating_love_pass_30d');
drop policy if exists dating_love_pass_order_delete_guard on public.toss_test_payment_orders;
create policy dating_love_pass_order_delete_guard on public.toss_test_payment_orders as restrictive
  for delete to anon, authenticated using (product_type<>'dating_love_pass_30d');

create unique index if not exists dating_love_pass_one_open_order
  on public.toss_test_payment_orders (user_id)
  where product_type='dating_love_pass_30d' and status='ready';

create table if not exists public.dating_love_passes (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null unique references public.toss_test_payment_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > starts_at),
  revoked_at timestamptz,
  areas text[] not null default array[]::text[] check (
    cardinality(areas)<=2 and coalesce(array_ndims(areas),1)=1
    and array_position(areas,null::text) is null
    and (cardinality(areas)<2 or areas[1]<>areas[2])
    and areas <@ array['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주']::text[]
  ),
  credits_remaining int not null default 40 check (credits_remaining between 0 and 40)
);
create index if not exists dating_love_passes_user_end on public.dating_love_passes(user_id, expires_at desc);

create table if not exists public.dating_love_pass_publications (
  id uuid primary key default gen_random_uuid(),
  pass_id uuid not null references public.dating_love_passes(id) on delete cascade,
  card_id uuid references public.dating_cards(id) on delete set null,
  published_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > published_at)
);
create index if not exists dating_love_pass_publications_pass_history
  on public.dating_love_pass_publications(pass_id,published_at desc);
alter table public.dating_cards add column if not exists love_pass_publication_id uuid
  references public.dating_love_pass_publications(id) on delete set null;

create table if not exists public.dating_love_pass_application_usage (
  application_id uuid primary key references public.dating_card_applications(id) on delete cascade,
  pass_id uuid not null references public.dating_love_passes(id) on delete cascade,
  consumed_at timestamptz not null default now()
);

alter table public.dating_love_passes enable row level security;
alter table public.dating_love_pass_publications enable row level security;
alter table public.dating_love_pass_application_usage enable row level security;
revoke all on public.dating_love_passes, public.dating_love_pass_publications, public.dating_love_pass_application_usage
  from public, anon, authenticated;
grant select on public.dating_love_passes, public.dating_love_pass_publications, public.dating_love_pass_application_usage
  to service_role;

create or replace function public.guard_dating_love_pass_publication_marker()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.status<>'public' then new.love_pass_publication_id:=null; end if;
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' and new.love_pass_publication_id is not null then
      raise exception 'PASS_SLOT_ADMIN_ONLY' using errcode='42501';
    elsif tg_op='UPDATE' and new.status='public' and old.love_pass_publication_id is distinct from new.love_pass_publication_id then
      raise exception 'PASS_SLOT_ADMIN_ONLY' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_dating_love_pass_publication_marker on public.dating_cards;
create trigger guard_dating_love_pass_publication_marker
  before insert or update on public.dating_cards for each row
  execute function public.guard_dating_love_pass_publication_marker();

create or replace function public.dating_love_pass_ready()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select s.value_json->'enabled' = 'true'::jsonb
    from public.site_settings s where s.key='dating_love_pass_sale'),false)
    and to_regprocedure('public.get_dating_love_pass_swipe_status(uuid)') is not null
    and to_regprocedure('public.record_dating_love_pass_swipe(uuid,uuid,uuid,uuid,text,text)') is not null
    and to_regprocedure('public.get_dating_love_pass_swipe_users(uuid[])') is not null
    and to_regprocedure('public.dating_profile_review_payload(text,jsonb)') is not null
    and to_regprocedure('public.get_daily_apply_base_limit(date)') is not null
$$;

-- A canceled order can never reactivate through this lookup. Sales may be
-- paused without locking out existing purchasers or late provider callbacks.
create or replace function public.get_active_dating_love_pass(p_user_id uuid)
returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
  select p.id from public.dating_love_passes p
  join public.toss_test_payment_orders o on o.id=p.payment_order_id and o.user_id=p.user_id
  where p.user_id=p_user_id and p.starts_at<=now() and p.expires_at>now() and p.revoked_at is null
    and o.product_type='dating_love_pass_30d' and o.status='paid'
  order by p.expires_at asc,p.id limit 1
$$;

create or replace function public.get_dating_love_pass_purchase_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(
    select 1 from public.profiles p
    join auth.users u on u.id=p.user_id
    join lateral (
      select card.sex,card.age,card.instagram_id,card.status,card.expires_at
      from public.dating_cards card where card.owner_user_id=p.user_id
      order by card.created_at desc,card.id desc limit 1
    ) c on true
    where p.user_id=p_user_id and p.phone_verified is true and p.is_banned is not true
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
      and c.sex in ('male','female') and c.age between 19 and 99 and nullif(btrim(c.instagram_id),'') is not null
      and ((c.status='pending' and (c.expires_at is null or c.expires_at>now())) or (c.status='public' and c.expires_at>now()))
  )
$$;

create or replace function public.reserve_dating_love_pass_order(p_user_id uuid,p_toss_order_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_existing text;
begin
  if not public.dating_love_pass_ready() then return jsonb_build_object('code','DISABLED'); end if;
  if p_user_id is null or p_toss_order_id is null or p_toss_order_id !~ '^[A-Za-z0-9_-]{6,64}$'
    then raise exception 'INVALID_LOVE_PASS_ORDER' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dating-love-pass:' || p_user_id::text,0));
  if public.get_active_dating_love_pass(p_user_id) is not null then return jsonb_build_object('code','ACTIVE'); end if;
  select o.toss_order_id into v_existing from public.toss_test_payment_orders o
    where o.user_id=p_user_id and o.product_type='dating_love_pass_30d' and o.status='ready'
    limit 1;
  if v_existing is not null then return jsonb_build_object('code','READY','toss_order_id',v_existing,'reused',true); end if;
  if not public.get_dating_love_pass_purchase_eligible(p_user_id) then return jsonb_build_object('code','INELIGIBLE'); end if;
  insert into public.toss_test_payment_orders(user_id,product_type,product_meta,toss_order_id,order_name,amount,status)
    values(p_user_id,'dating_love_pass_30d','{"lovePassVersion":1}'::jsonb,p_toss_order_id,'짐툴 연애 패스',30000,'ready');
  return jsonb_build_object('code','READY','toss_order_id',p_toss_order_id,'reused',false);
end $$;

create or replace function public.activate_dating_love_pass(
  p_order_id text,p_payment_key text default null,p_approved_at timestamptz default null,p_payment jsonb default null
)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid; v_order public.toss_test_payment_orders%rowtype; v_pass_id uuid;
  v_key text; v_receipt jsonb; v_approved_at timestamptz; v_now timestamptz;
begin
  select o.user_id into v_user from public.toss_test_payment_orders o
    where o.toss_order_id=p_order_id and o.product_type='dating_love_pass_30d';
  if v_user is null then raise exception 'LOVE_PASS_ORDER_NOT_FOUND' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dating-love-pass:' || v_user::text,0));
  select o.* into v_order from public.toss_test_payment_orders o
    where o.toss_order_id=p_order_id and o.user_id=v_user for update;
  if not found or v_order.product_type<>'dating_love_pass_30d' or v_order.amount<>30000
    or v_order.product_meta->'lovePassVersion' is distinct from '1'::jsonb
    or v_order.status not in ('ready','paid') then
    raise exception 'INVALID_LOVE_PASS_ORDER' using errcode='22023';
  end if;
  if v_order.status='paid' and p_payment_key is not null and p_payment_key is distinct from v_order.payment_key
    then raise exception 'INVALID_LOVE_PASS_RECEIPT' using errcode='22023'; end if;
  if v_order.status='ready' then
    v_key:=p_payment_key; v_receipt:=p_payment; v_approved_at:=p_approved_at;
  else
    v_key:=v_order.payment_key; v_receipt:=v_order.raw_response; v_approved_at:=v_order.approved_at;
  end if;
  v_now:=clock_timestamp();
  if v_key is null or btrim(v_key)='' or v_approved_at is null or v_approved_at>v_now+interval '5 minutes'
    or v_receipt->>'status' is distinct from 'DONE'
    or v_receipt->>'orderId' is distinct from v_order.toss_order_id
    or v_receipt->>'paymentKey' is distinct from v_key
    or v_receipt->'totalAmount' is distinct from '30000'::jsonb
    or (v_receipt->>'approvedAt')::timestamptz is distinct from v_approved_at
    then raise exception 'INVALID_LOVE_PASS_RECEIPT' using errcode='22023';
  end if;
  select p.id into v_pass_id from public.dating_love_passes p where p.payment_order_id=v_order.id;
  if v_pass_id is not null then return v_pass_id; end if;
  if v_order.status='ready' then
    update public.toss_test_payment_orders
    set status='paid',payment_key=v_key,approved_at=v_approved_at,raw_response=v_receipt,updated_at=v_now
    where id=v_order.id;
  end if;
  insert into public.dating_love_passes (payment_order_id,user_id,starts_at,expires_at)
    values(v_order.id,v_user,v_now,v_now+interval '720 hours') returning id into v_pass_id;
  return v_pass_id;
end $$;

create or replace function public.close_dating_love_pass_order(p_user_id uuid,p_toss_order_id text,p_payment jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_user_id is null or p_toss_order_id is null or p_payment->>'orderId' is distinct from p_toss_order_id
    or p_payment->'totalAmount' is distinct from '30000'::jsonb
    or coalesce(p_payment->>'status','') not in ('CANCELED','ABORTED','EXPIRED') then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dating-love-pass:' || p_user_id::text,0));
  update public.toss_test_payment_orders
  set status='canceled',raw_response=p_payment,updated_at=clock_timestamp()
  where user_id=p_user_id and toss_order_id=p_toss_order_id and product_type='dating_love_pass_30d'
    and amount=30000 and status='ready';
  return found;
end $$;

create or replace function public.dating_love_pass_status(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id',p.id,'startsAt',p.starts_at,'expiresAt',p.expires_at,'areas',p.areas,
    'publicationsRemaining',greatest(0,4-usage.count),
    'nextPublicationAt',case when usage.count<4 and usage.last_at+interval '168 hours'>now()
        then usage.last_at+interval '168 hours' else null end,
    'creditsRemaining',p.credits_remaining
  ) from public.dating_love_passes p
  cross join lateral (select count(*)::int count,max(h.published_at) last_at
    from public.dating_love_pass_publications h where h.pass_id=p.id) usage
  where p.id=public.get_active_dating_love_pass(p_user_id)
$$;

create or replace function public.set_dating_love_pass_areas(p_user_id uuid,p_areas text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_pass_id uuid;
begin
  if p_user_id is null or p_areas is null then raise exception 'INVALID_PASS_AREAS' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dating-love-pass:' || p_user_id::text,0));
  v_pass_id:=public.get_active_dating_love_pass(p_user_id);
  if v_pass_id is null then raise exception 'PASS_INACTIVE' using errcode='42501'; end if;
  update public.dating_love_passes set areas=p_areas where id=v_pass_id;
  return public.dating_love_pass_status(p_user_id);
end $$;

-- Only a review that still describes this exact profile can authorize early
-- viewing or publication. No extra consent prompt is added.
create or replace function public.dating_love_pass_card_review_ok(p_card_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists (
    select 1 from public.dating_cards c
    left join public.dating_profile_review_jobs r on r.card_id=c.id and r.source_type='open_card'
    cross join lateral (select public.dating_profile_review_payload('open_card',to_jsonb(c)) payload) wanted
    where c.id=p_card_id and (
      (r.user_id=c.owner_user_id and r.payload=wanted.payload and
        (r.resolution='cleared' or (r.resolution='open' and r.state='complete' and r.result->>'suspicionLevel' in ('clear','low'))))
      or (r.card_id is null and exists(
        select 1 from public.dating_profile_review_settings s where s.singleton=true and
          s.initial_open_card_payloads->>c.id::text=md5(wanted.payload::text)
      ))
    )
  )
$$;

create or replace function public.get_dating_love_pass_reviewable_cards(p_card_ids uuid[])
returns uuid[] language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(array_agg(r.id),'{}'::uuid[])
  from (select distinct v.id from unnest(p_card_ids[1:50]) as v(id)) r
  where public.dating_love_pass_card_review_ok(r.id)
$$;

-- Resolve images and their moderation fingerprint in one PostgreSQL snapshot.
-- The HTTP layer still requires the viewer's current pass and card access.
create or replace function public.get_dating_love_pass_card_photo_snapshot(p_card_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'owner_user_id',c.owner_user_id,'photo_visibility',to_jsonb(c)->'photo_visibility',
    'photo_paths',to_jsonb(c)->'photo_paths','blur_paths',to_jsonb(c)->'blur_paths',
    'blur_thumb_path',to_jsonb(c)->'blur_thumb_path'
  )
  from public.dating_cards c where c.id=p_card_id and (
    (c.status='pending' and (c.expires_at is null or c.expires_at>now())) or (c.status='public' and c.expires_at>now())
  ) and public.dating_love_pass_card_review_ok(c.id)
$$;

create or replace function public.publish_dating_love_pass_card(p_user_id uuid,p_card_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_pass_id uuid; v_slot public.dating_love_pass_publications%rowtype; v_card public.dating_cards%rowtype;
  v_count integer; v_last timestamptz; v_now timestamptz; v_expires timestamptz;
begin
  if p_user_id is null or p_card_id is null then raise exception 'CARD_NOT_AVAILABLE' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dating-love-pass:' || p_user_id::text,0));
  v_pass_id:=public.get_active_dating_love_pass(p_user_id);
  if v_pass_id is null then raise exception 'PASS_INACTIVE' using errcode='42501'; end if;
  select c.* into v_card from public.dating_cards c where c.id=p_card_id and c.owner_user_id=p_user_id for update;
  if not found then raise exception 'CARD_NOT_AVAILABLE' using errcode='P0002'; end if;
  v_now:=clock_timestamp();
  if v_card.status='public' and v_card.expires_at>v_now and v_card.love_pass_publication_id is not null then
    select h.* into v_slot from public.dating_love_pass_publications h
      where h.id=v_card.love_pass_publication_id and h.pass_id=v_pass_id and h.card_id=p_card_id;
    if found then return jsonb_build_object('cardId',p_card_id,'publishedAt',v_slot.published_at,'expiresAt',v_slot.expires_at); end if;
  end if;
  if v_card.status<>'pending' or v_card.age is null or v_card.age<19
    or (v_card.expires_at is not null and v_card.expires_at<=v_now) then
    raise exception 'CARD_NOT_AVAILABLE' using errcode='22023';
  end if;
  if not exists (select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=p_user_id and p.phone_verified is true and p.is_banned is not true
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=v_now))
    then raise exception 'CARD_NOT_AVAILABLE' using errcode='42501'; end if;
  if exists (select 1 from public.dating_cards c where c.owner_user_id=p_user_id and c.id<>p_card_id
    and c.status='public' and c.expires_at>v_now) then
    raise exception 'OPEN_CARD_ALREADY_PUBLIC' using errcode='22023';
  end if;
  if not public.dating_love_pass_card_review_ok(p_card_id) then
    raise exception 'CARD_REVIEW_REQUIRED' using errcode='22023';
  end if;
  select count(*)::int,max(h.published_at) into v_count,v_last from public.dating_love_pass_publications h where h.pass_id=v_pass_id;
  if v_count>=4 then raise exception 'PASS_PUBLISH_LIMIT' using errcode='22023'; end if;
  if v_last is not null and v_last+interval '168 hours'>v_now then
    raise exception 'PASS_PUBLISH_COOLDOWN' using errcode='22023';
  end if;
  v_expires:=v_now+interval '24 hours';
  insert into public.dating_love_pass_publications(pass_id,card_id,published_at,expires_at)
    values(v_pass_id,p_card_id,v_now,v_expires) returning * into v_slot;
  update public.dating_cards set status='public',published_at=v_now,expires_at=v_expires,love_pass_publication_id=v_slot.id
    where id=p_card_id and owner_user_id=p_user_id and status='pending';
  if not found then raise exception 'CARD_NOT_AVAILABLE' using errcode='22023'; end if;
  return jsonb_build_object('cardId',p_card_id,'publishedAt',v_slot.published_at,'expiresAt',v_slot.expires_at);
end $$;

-- Caller must first enforce the existing authenticated request, user/site bans,
-- and the two block checks. We lock/recheck both credit and card before writing.
create or replace function public.submit_dating_love_pass_application(
  p_user_id uuid,p_card_id uuid,p_owner_id uuid,p_region text,p_pending_province text,
  p_legacy_pending_access boolean,p_application jsonb
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_pass public.dating_love_passes%rowtype; v_card public.dating_cards%rowtype;
  v_app public.dating_card_applications%rowtype; v_base integer; v_ordinary_credits integer; v_used text;
  v_now timestamptz; v_date date; v_limit integer; v_application_id uuid;
begin
  if p_user_id is null then return jsonb_build_object('code','NO_PASS'); end if;
  perform pg_advisory_xact_lock(hashtextextended('dating-love-pass:' || p_user_id::text,0));
  select p.* into v_pass from public.dating_love_passes p
    where p.id=public.get_active_dating_love_pass(p_user_id) for update;
  v_now:=clock_timestamp();
  if v_pass.id is null or v_pass.expires_at<=v_now then return jsonb_build_object('code','NO_PASS'); end if;
  select c.* into v_card from public.dating_cards c where c.id=p_card_id for share;
  if not found or v_card.owner_user_id is distinct from p_owner_id or v_card.owner_user_id=p_user_id
    then return jsonb_build_object('code','FORBIDDEN'); end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=p_user_id and p.phone_verified is true and p.is_banned is not true
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=v_now))
    then return jsonb_build_object('code','FORBIDDEN'); end if;
  if v_card.status='pending' then
    if (v_card.expires_at is not null and v_card.expires_at<=v_now) or v_card.region is distinct from p_region
      or (p_legacy_pending_access is true or
      (p_pending_province is not null and p_pending_province=any(v_pass.areas) and v_card.age between 19 and 99
        and exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
          where p.user_id=v_card.owner_user_id and p.is_banned is not true and u.deleted_at is null
            and (u.banned_until is null or u.banned_until<=v_now))
        and v_card.sex = (
          select case own.sex when 'male' then 'female' when 'female' then 'male' end
          from public.dating_cards own where own.owner_user_id=p_user_id
            and own.status in ('pending','public','hidden','expired') and own.age between 19 and 99
          order by own.created_at desc,own.id desc limit 1
        ) and public.dating_love_pass_card_review_ok(p_card_id))) is not true
      then return jsonb_build_object('code','FORBIDDEN'); end if;
  elsif v_card.status='expired' or (v_card.status='public' and (v_card.expires_at is null or v_card.expires_at<=v_now))
    then return jsonb_build_object('code','EXPIRED');
  elsif v_card.status<>'public' then return jsonb_build_object('code','FORBIDDEN');
  end if;

  if exists(select 1 from public.dating_card_applications a where a.card_id=p_card_id and a.applicant_user_id=p_user_id)
    then return jsonb_build_object('code','DUPLICATE'); end if;
  v_date:=(timezone('Asia/Seoul',v_now))::date;
  v_limit:=public.get_daily_apply_base_limit(v_date);

  -- Same ordering as the legacy token function on deliberately shared balances.
  insert into public.user_daily_apply_usage(user_id,kst_date,base_used) values(p_user_id,v_date,0)
    on conflict(user_id,kst_date) do nothing;
  select d.base_used into v_base from public.user_daily_apply_usage d where d.user_id=p_user_id and d.kst_date=v_date for update;
  insert into public.user_apply_credits(user_id,credits) values(p_user_id,0) on conflict(user_id) do nothing;
  select c.credits into v_ordinary_credits from public.user_apply_credits c where c.user_id=p_user_id for update;
  if v_base<v_limit then
    v_used:='base'; v_base:=v_base+1;
    update public.user_daily_apply_usage set base_used=v_base,updated_at=v_now
      where user_id=p_user_id and kst_date=v_date;
  elsif v_pass.credits_remaining>0 then
    v_used:='pass'; v_pass.credits_remaining:=v_pass.credits_remaining-1;
    update public.dating_love_passes set credits_remaining=v_pass.credits_remaining where id=v_pass.id;
  elsif v_ordinary_credits>0 then
    v_used:='credit'; v_ordinary_credits:=v_ordinary_credits-1;
    update public.user_apply_credits set credits=v_ordinary_credits,updated_at=v_now where user_id=p_user_id;
  else
    return jsonb_build_object('code','LIMIT','base_used',v_base,'credits_remaining',0);
  end if;

  -- Explicitly assign the subject IDs and status rather than trust JSON keys.
  v_app:=jsonb_populate_record(null::public.dating_card_applications,p_application);
  insert into public.dating_card_applications(
    card_id,applicant_user_id,applicant_display_nickname,age,height_cm,region,job,training_years,
    intro_text,instagram_id,photo_paths,status
  ) values (p_card_id,p_user_id,v_app.applicant_display_nickname,v_app.age,v_app.height_cm,
    v_app.region,v_app.job,v_app.training_years,v_app.intro_text,v_app.instagram_id,v_app.photo_paths,'submitted'
  ) returning id into v_application_id;
  if v_used='pass' then insert into public.dating_love_pass_application_usage(application_id,pass_id)
    values(v_application_id,v_pass.id); end if;

  return jsonb_build_object('code','APPLIED','application_id',v_application_id,'used',v_used,'base_used',v_base,
    'credits_remaining',v_ordinary_credits,'pass_credits_remaining',v_pass.credits_remaining);
end $$;

revoke all on function public.guard_dating_love_pass_publication_marker(),public.dating_love_pass_ready(),
  public.get_active_dating_love_pass(uuid),public.get_dating_love_pass_purchase_eligible(uuid),public.reserve_dating_love_pass_order(uuid,text),
  public.activate_dating_love_pass(text,text,timestamptz,jsonb),public.close_dating_love_pass_order(uuid,text,jsonb),
  public.dating_love_pass_status(uuid),public.set_dating_love_pass_areas(uuid,text[]),public.dating_love_pass_card_review_ok(uuid),
  public.get_dating_love_pass_reviewable_cards(uuid[]),public.get_dating_love_pass_card_photo_snapshot(uuid),
  public.publish_dating_love_pass_card(uuid,uuid),public.submit_dating_love_pass_application(uuid,uuid,uuid,text,text,boolean,jsonb)
from public,anon,authenticated;

grant execute on function public.dating_love_pass_ready(),public.get_active_dating_love_pass(uuid),
  public.get_dating_love_pass_purchase_eligible(uuid),public.reserve_dating_love_pass_order(uuid,text),public.activate_dating_love_pass(text,text,timestamptz,jsonb),
  public.close_dating_love_pass_order(uuid,text,jsonb),public.dating_love_pass_status(uuid),public.get_dating_love_pass_reviewable_cards(uuid[]),
  public.get_dating_love_pass_card_photo_snapshot(uuid),
  public.set_dating_love_pass_areas(uuid,text[]),public.dating_love_pass_card_review_ok(uuid),
  public.publish_dating_love_pass_card(uuid,uuid),public.submit_dating_love_pass_application(uuid,uuid,uuid,text,text,boolean,jsonb)
to service_role;

commit;
notify pgrst, 'reload schema';
