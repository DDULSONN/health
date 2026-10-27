-- Additive operator-granted vouchers. Does not rewrite claims, orders or matches.
-- No client/service role may issue vouchers; issuance is an audited operator SQL action.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table if not exists public.contact_care_manual_vouchers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_reference text not null check(char_length(grant_reference) between 12 and 160),
  grant_index smallint not null check(grant_index between 1 and 100),
  reason text not null check(char_length(reason) between 5 and 300),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  used_match_id uuid unique,
  used_at timestamptz,
  unique(grant_reference,grant_index),
  check((used_match_id is null)=(used_at is null)),
  check(used_at is null or revoked_at is null)
);
create index if not exists contact_care_manual_available
  on public.contact_care_manual_vouchers(user_id,created_at,id) where used_at is null and revoked_at is null;
create index if not exists contact_care_manual_history
  on public.contact_care_manual_vouchers(user_id,used_at desc) where used_at is not null;
alter table public.contact_care_manual_vouchers enable row level security;
revoke all on public.contact_care_manual_vouchers from public,anon,authenticated,service_role;
grant select on public.contact_care_manual_vouchers to service_role;

-- Uses exactly the same match/order lock as regular checkout and claim redemption.
-- Separate trigger leaves the original claim protection untouched.
create or replace function public.guard_contact_care_manual_order()
returns trigger language plpgsql security definer set search_path=pg_catalog set lock_timeout='3s' as $$
begin
  if new.product_type<>'one_on_one_contact_exchange' or new.product_ref_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.product_ref_id::text,15000));
  if exists(select 1 from public.contact_care_manual_vouchers where used_match_id=new.product_ref_id)
    then raise exception 'CARE_ALREADY_EXCHANGED'; end if;
  return new;
end;
$$;
drop trigger if exists guard_contact_care_manual_order_insert on public.toss_test_payment_orders;
create trigger guard_contact_care_manual_order_insert before insert on public.toss_test_payment_orders
  for each row execute function public.guard_contact_care_manual_order();

create or replace function public.redeem_contact_care_manual(p_user uuid,p_match uuid,p_phones text[],p_contact_hashes text[],p_legacy_hashes text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare c public.contact_care_manual_vouchers%rowtype; m public.dating_1on1_match_proposals%rowtype; blocked boolean;
begin
  if p_user is null or p_match is null then raise exception 'CARE_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_match::text,15000));
  -- Serialize this wallet across different matches without locking another user's wallet.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,17003));
  if exists(select 1 from public.contact_care_manual_vouchers where user_id=p_user and used_match_id=p_match)
    then return jsonb_build_object('ok',true,'alreadyUsed',true); end if;
  select * into c from public.contact_care_manual_vouchers
    where user_id=p_user and used_at is null and revoked_at is null order by created_at,id limit 1 for update;
  if not found then raise exception 'CARE_NO_CREDIT'; end if;
  select * into m from public.dating_1on1_match_proposals where id=p_match for update;
  if not found or m.source_user_id is null or m.candidate_user_id is null
    or p_user not in(m.source_user_id,m.candidate_user_id) or m.source_user_id=m.candidate_user_id
    then raise exception 'CARE_UNAVAILABLE'; end if;
  if m.state is distinct from 'mutual_accepted' or m.contact_exchange_status is null
    or m.contact_exchange_status not in ('none','awaiting_applicant_payment')
    or m.contact_exchange_paid_at is not null or m.contact_exchange_approved_at is not null then raise exception 'CARE_MATCH_CHANGED'; end if;
  if exists(select 1 from public.toss_test_payment_orders where product_type='one_on_one_contact_exchange' and product_ref_id=p_match
    and (status in ('ready','paid') or payment_key is not null or approved_at is not null)) then raise exception 'CARE_CHECKOUT'; end if;
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
    contact_exchange_note='contact-care manual voucher '||c.id::text,updated_at=now() where id=p_match;
  update public.contact_care_manual_vouchers set used_match_id=p_match,used_at=now() where id=c.id;
  return jsonb_build_object('ok',true,'alreadyUsed',false);
end;
$$;
revoke all on function public.guard_contact_care_manual_order(),public.redeem_contact_care_manual(uuid,uuid,text[],text[],text[])
  from public,anon,authenticated,service_role;
grant execute on function public.redeem_contact_care_manual(uuid,uuid,text[],text[],text[]) to service_role;
commit;
notify pgrst,'reload schema';
