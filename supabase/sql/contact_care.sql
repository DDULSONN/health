-- Install only: opt-in pilot, disabled until an operator sets starts_at/enabled.
-- Existing orders, matches, phone verification and refunds are not rewritten.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table if not exists public.contact_care_policy (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  starts_at timestamptz,
  check(not enabled or starts_at is not null)
);
insert into public.contact_care_policy(id) values(true) on conflict do nothing;
create table if not exists public.contact_care_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  match_id uuid not null unique,
  order_id uuid not null unique,
  exchanged_at timestamptz,
  counterparty_name text,
  first_contact_at timestamptz not null,
  explanation text not null check(char_length(explanation) between 10 and 500),
  reason text not null check(reason in ('no_response','scam')),
  upload_id uuid not null,
  evidence_count integer not null check(evidence_count between 1 and 3),
  supplement_due_at timestamptz,
  status text not null default 'pending' check(status in ('pending','needs_info','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  evidence_checked boolean not null default false,
  used_match_id uuid unique,
  used_at timestamptz,
  check((used_match_id is null)=(used_at is null)),
  check(used_at is null or status='approved'),
  check(status<>'approved' or evidence_checked)
);
alter table public.contact_care_claims add column if not exists exchanged_at timestamptz;
alter table public.contact_care_claims add column if not exists counterparty_name text;
create index if not exists contact_care_review_queue on public.contact_care_claims(created_at,id) where status in ('pending','needs_info');
create table if not exists public.contact_care_rejected_history (
  claim_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  record jsonb not null,
  archived_at timestamptz not null default now()
);
alter table public.contact_care_policy enable row level security;
alter table public.contact_care_claims enable row level security;
alter table public.contact_care_rejected_history enable row level security;
revoke all on public.contact_care_policy,public.contact_care_claims,public.contact_care_rejected_history from public,anon,authenticated,service_role;
grant select on public.contact_care_policy,public.contact_care_claims to service_role;

-- Private, bounded upload reservations. Failed requests remain recoverable until
-- the admin cleanup action deletes abandoned objects after 24 hours.
create table if not exists public.contact_care_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, -- retain only the opaque owner ID until orphan files are purged after account deletion
  match_id uuid not null, order_id uuid not null,
  paths text[] not null, created_at timestamptz not null default now(),
  submitted_at timestamptz, purging boolean not null default false,
  check(cardinality(paths) between 1 and 3)
);
create index if not exists contact_care_upload_user on public.contact_care_uploads(user_id,created_at);
alter table public.contact_care_uploads enable row level security;
revoke all on public.contact_care_uploads from public,anon,authenticated,service_role;
grant select on public.contact_care_uploads to service_role;

-- Refunds invalidate unused credits. Once a valid application is submitted,
-- later removal/closure of the original match must not erase the payer's claim.
create or replace function public.contact_care_paid(p_user uuid,p_match uuid,p_order uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from public.toss_test_payment_orders o
    where o.id=p_order and o.user_id=p_user and o.product_type='one_on_one_contact_exchange'
      and o.product_ref_id=p_match and o.status='paid' and o.amount>0 and o.approved_at is not null
      and coalesce(o.cancel_amount,0)=0 and o.canceled_at is null
      and (exists(select 1 from public.dating_1on1_match_proposals m where m.id=p_match
        and p_user in(m.source_user_id,m.candidate_user_id)
        and m.contact_exchange_paid_by_user_id=p_user and m.contact_exchange_approved_at is not null)
      or exists(select 1 from public.contact_care_claims c where c.user_id=p_user
        and c.match_id=p_match and c.order_id=p_order and c.exchanged_at is not null)));
$$;

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

create or replace function public.reserve_contact_care_upload(p_user uuid,p_match uuid,p_order uuid,p_count integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare v_id uuid:=gen_random_uuid(); v_paths text[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,72101));
  perform public.check_contact_care_application(p_user,p_match,p_order);
  if p_count is null or p_count not between 1 and 3 then raise exception 'CARE_UPLOAD'; end if;
  if (select count(*) from public.contact_care_uploads where user_id=p_user and created_at>now()-interval '24 hours')>=5
    then raise exception 'CARE_RATE'; end if;
  select array_agg(p_user::text||'/'||v_id::text||'/'||i::text||'.webp' order by i) into v_paths from generate_series(1,p_count) i;
  insert into public.contact_care_uploads(id,user_id,match_id,order_id,paths) values(v_id,p_user,p_match,p_order,v_paths);
  return jsonb_build_object('id',v_id,'paths',v_paths);
end;
$$;

create or replace function public.submit_contact_care(p_user uuid,p_match uuid,p_order uuid,p_first timestamptz,p_explanation text,p_reason text,p_upload uuid,p_revision uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare c public.contact_care_claims%rowtype; m public.dating_1on1_match_proposals%rowtype; u public.contact_care_uploads%rowtype;
  v_exchanged_at timestamptz; v_name text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,72101));
  select * into c from public.contact_care_claims where user_id=p_user for update;
  if found and c.status in ('pending','approved') then
    if c.match_id=p_match and c.order_id=p_order and c.upload_id=p_upload then return jsonb_build_object('ok',true,'id',c.id,'status',c.status); end if;
    raise exception 'CARE_ONCE';
  end if;
  if c.id is distinct from p_revision then raise exception 'CARE_REVIEWED'; end if;
  perform public.check_contact_care_application(p_user,p_match,p_order);
  select * into m from public.dating_1on1_match_proposals where id=p_match;
  v_exchanged_at:=coalesce(m.contact_exchange_approved_at,case when c.match_id=p_match and c.order_id=p_order then c.exchanged_at end);
  select name into v_name from public.dating_1on1_cards where id=case when m.source_user_id=p_user then m.candidate_card_id else m.source_card_id end;
  v_name:=coalesce(v_name,case when c.match_id=p_match then c.counterparty_name end,'상대 프로필');
  if p_reason is null or p_reason not in ('no_response','scam') then raise exception 'CARE_INPUT'; end if;
  if v_exchanged_at is null or p_first is null or p_first<v_exchanged_at or p_first>now()
    or (p_reason='no_response' and p_first>now()-interval '24 hours')
    then raise exception 'CARE_WAIT'; end if;
  if p_explanation is null or char_length(btrim(p_explanation)) not between 10 and 500 then raise exception 'CARE_INPUT'; end if;
  select * into u from public.contact_care_uploads where id=p_upload for update;
  if not found or u.user_id<>p_user or u.match_id<>p_match or u.order_id<>p_order or u.purging
    or u.submitted_at is not null or u.created_at<now()-interval '1 hour'
    or (select count(*) from storage.objects where bucket_id='contact-care-evidence' and name=any(u.paths))<>cardinality(u.paths)
    then raise exception 'CARE_UPLOAD'; end if;
  update public.contact_care_uploads set submitted_at=now() where id=u.id;
  if c.id is not null then
    -- Rejected applications can be corrected. Rotate the ID so an old admin
    -- screen cannot approve a changed submission; retain the rejected audit.
    insert into public.contact_care_rejected_history(claim_id,user_id,record) values(c.id,c.user_id,to_jsonb(c));
    update public.contact_care_claims set id=gen_random_uuid(),match_id=p_match,order_id=p_order,
      exchanged_at=v_exchanged_at,counterparty_name=v_name,
      first_contact_at=p_first,explanation=btrim(p_explanation),reason=p_reason,upload_id=u.id,evidence_count=cardinality(u.paths),status='pending',
      created_at=case when c.status='needs_info' then c.created_at else now() end,supplement_due_at=null,
      reviewed_at=null,reviewed_by=null,review_note=null,evidence_checked=false
      where user_id=p_user returning * into c;
    return jsonb_build_object('ok',true,'id',c.id,'status',c.status);
  end if;
  insert into public.contact_care_claims(user_id,match_id,order_id,exchanged_at,counterparty_name,first_contact_at,explanation,reason,upload_id,evidence_count)
    values(p_user,p_match,p_order,v_exchanged_at,v_name,p_first,btrim(p_explanation),p_reason,u.id,cardinality(u.paths)) returning * into c;
  return jsonb_build_object('ok',true,'id',c.id,'status',c.status);
end;
$$;

create or replace function public.review_contact_care(p_claim uuid,p_admin uuid,p_decision text,p_checked boolean,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare c public.contact_care_claims%rowtype;
begin
  -- API additionally uses the project's administrator allowlist.
  if not exists(select 1 from public.profiles where user_id=p_admin and role='admin' and not coalesce(is_banned,false))
    then raise exception 'CARE_ADMIN'; end if;
  if p_decision is null or p_decision not in ('approved','rejected','needs_info') or p_note is null or char_length(btrim(p_note)) not between 5 and 300 then raise exception 'CARE_INPUT'; end if;
  select * into c from public.contact_care_claims where id=p_claim for update;
  if not found then raise exception 'CARE_UNAVAILABLE'; end if;
  if c.status in ('approved','rejected') or (c.status='needs_info' and p_decision='needs_info') then
    if c.status=p_decision then
      return jsonb_build_object('ok',true,'status',c.status,'alreadyProcessed',true);
    end if;
    raise exception 'CARE_REVIEWED';
  end if;
  if p_decision='approved' then
    if p_checked is distinct from true then raise exception 'CARE_EVIDENCE'; end if;
    perform 1 from public.toss_test_payment_orders where id=c.order_id for update;
    if not public.contact_care_paid(c.user_id,c.match_id,c.order_id) then raise exception 'CARE_PAYMENT'; end if;
    if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
      where p.user_id=c.user_id and not coalesce(p.is_banned,false) and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=now())) then raise exception 'CARE_UNAVAILABLE'; end if;
  end if;
  update public.contact_care_claims set status=p_decision,supplement_due_at=case when p_decision='needs_info' then now()+interval '72 hours' else null end,
    reviewed_at=now(),reviewed_by=p_admin,review_note=btrim(p_note),evidence_checked=p_checked is true where id=c.id;
  return jsonb_build_object('ok',true,'status',p_decision);
end;
$$;

-- Share the existing contact-checkout lock, including when approval races a
-- new order. Only a match actually exchanged with a credit is rejected.
create or replace function public.guard_contact_care_order()
returns trigger language plpgsql security definer set search_path=pg_catalog set lock_timeout='3s' as $$
begin
  if new.product_type<>'one_on_one_contact_exchange' or new.product_ref_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.product_ref_id::text,15000));
  if exists(select 1 from public.contact_care_claims where used_match_id=new.product_ref_id) then raise exception 'CARE_ALREADY_EXCHANGED'; end if;
  return new;
end;
$$;
drop trigger if exists guard_contact_care_order_insert on public.toss_test_payment_orders;
create trigger guard_contact_care_order_insert before insert on public.toss_test_payment_orders
  for each row execute function public.guard_contact_care_order();

create or replace function public.redeem_contact_care(p_user uuid,p_match uuid,p_phones text[],p_contact_hashes text[],p_legacy_hashes text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare c public.contact_care_claims%rowtype; m public.dating_1on1_match_proposals%rowtype; blocked boolean;
begin
  -- Same match-order lock as the existing checkout experiment; never cancel an order.
  perform pg_advisory_xact_lock(hashtextextended(p_match::text,15000));
  select * into c from public.contact_care_claims where user_id=p_user for update;
  if not found or c.status<>'approved' then raise exception 'CARE_NO_CREDIT'; end if;
  if c.used_at is not null then
    if c.used_match_id=p_match then return jsonb_build_object('ok',true,'alreadyUsed',true); end if;
    raise exception 'CARE_NO_CREDIT';
  end if;
  if c.match_id=p_match then raise exception 'CARE_UNAVAILABLE'; end if;
  select * into m from public.dating_1on1_match_proposals where id=p_match for update;
  if not found or p_user not in(m.source_user_id,m.candidate_user_id) or m.source_user_id=m.candidate_user_id
    then raise exception 'CARE_UNAVAILABLE'; end if;
  if m.state<>'mutual_accepted' or m.contact_exchange_status not in ('none','awaiting_applicant_payment')
    or m.contact_exchange_paid_at is not null or m.contact_exchange_approved_at is not null then raise exception 'CARE_MATCH_CHANGED'; end if;
  perform 1 from public.toss_test_payment_orders where id=c.order_id for update;
  if not public.contact_care_paid(p_user,c.match_id,c.order_id) then raise exception 'CARE_PAYMENT'; end if;
  if exists(select 1 from public.toss_test_payment_orders where product_type='one_on_one_contact_exchange' and product_ref_id=p_match
    and (status in ('ready','paid') or payment_key is not null or approved_at is not null)) then raise exception 'CARE_CHECKOUT'; end if;
  -- Native in-app billing is intentionally outside this web pilot. Do not race a store purchase.
  if to_regclass('public.app_purchase_events') is not null then
    execute 'select exists(select 1 from public.app_purchase_events where user_id=any($1))'
      into blocked using array[m.source_user_id,m.candidate_user_id];
    if blocked then raise exception 'CARE_STORE'; end if;
  end if;
  if array_length(p_phones,1) is distinct from 2 or array_length(p_contact_hashes,1) is distinct from 2
    or array_length(p_legacy_hashes,1) is distinct from 2 then raise exception 'CARE_UNAVAILABLE'; end if;
  if (select count(*) from public.profiles p join auth.users u on u.id=p.user_id
      join public.dating_1on1_cards d on d.user_id=p.user_id
        and d.id=case when p.user_id=m.source_user_id then m.source_card_id else m.candidate_card_id end
      where p.user_id in(m.source_user_id,m.candidate_user_id) and p.phone_verified is true
        and p.phone_e164=case when p.user_id=m.source_user_id then p_phones[1] else p_phones[2] end
        and p.phone_e164 ~ '^\+[1-9][0-9]{7,14}$' and not coalesce(p.is_banned,false)
        and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
        and d.birth_year between 1960 and extract(year from now() at time zone 'Asia/Seoul')::int-19
        and d.status in ('submitted','reviewing','approved'))<>2 then raise exception 'CARE_UNAVAILABLE'; end if;
  if exists(select 1 from public.dating_1on1_plus_subscriptions where user_id=p_user
    and expires_at>now() and contact_exchange_included is true) then raise exception 'CARE_PLUS'; end if;
  if to_regclass('public.dating_user_blocks') is not null then
    execute 'select exists(select 1 from public.dating_user_blocks where (blocker_user_id=$1 and blocked_user_id=$2) or (blocker_user_id=$2 and blocked_user_id=$1))'
      into blocked using m.source_user_id,m.candidate_user_id;
    if blocked then raise exception 'CARE_BLOCKED'; end if;
  end if;
  if exists(select 1 from public.dating_1on1_admin_user_blocks where
    (user_a_id=m.source_user_id and user_b_id=m.candidate_user_id) or (user_a_id=m.candidate_user_id and user_b_id=m.source_user_id))
    or exists(select 1 from public.dating_contact_blocks where block_type='phone' and
      ((user_id=m.source_user_id and value_hash=p_contact_hashes[2]) or (user_id=m.candidate_user_id and value_hash=p_contact_hashes[1])))
    or exists(select 1 from public.dating_1on1_phone_blocks where
      (user_id=m.source_user_id and phone_hash=p_legacy_hashes[2]) or (user_id=m.candidate_user_id and phone_hash=p_legacy_hashes[1]))
    then raise exception 'CARE_BLOCKED'; end if;
  update public.dating_1on1_match_proposals set contact_exchange_status='approved',
    contact_exchange_requested_at=now(),contact_exchange_paid_at=now(),contact_exchange_paid_by_user_id=p_user,
    contact_exchange_approved_at=now(),contact_exchange_approved_by_user_id=null,
    contact_exchange_note='contact-care credit '||c.id::text,updated_at=now() where id=p_match;
  update public.contact_care_claims set used_match_id=p_match,used_at=now() where id=c.id;
  return jsonb_build_object('ok',true,'alreadyUsed',false);
end;
$$;

revoke all on function public.contact_care_paid(uuid,uuid,uuid),public.guard_contact_care_order(),
  public.check_contact_care_application(uuid,uuid,uuid),public.reserve_contact_care_upload(uuid,uuid,uuid,integer),
  public.submit_contact_care(uuid,uuid,uuid,timestamptz,text,text,uuid,uuid),public.review_contact_care(uuid,uuid,text,boolean,text),
  public.redeem_contact_care(uuid,uuid,text[],text[],text[]) from public,anon,authenticated,service_role;
grant execute on function public.reserve_contact_care_upload(uuid,uuid,uuid,integer),public.submit_contact_care(uuid,uuid,uuid,timestamptz,text,text,uuid,uuid),
  public.review_contact_care(uuid,uuid,text,boolean,text),public.redeem_contact_care(uuid,uuid,text[],text[],text[]) to service_role;
commit;
notify pgrst,'reload schema';
