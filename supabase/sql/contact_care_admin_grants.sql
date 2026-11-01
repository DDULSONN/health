-- Additive admin issuance only. Existing redemption/payment/phone functions are unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table if not exists public.contact_care_admin_grants (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  admin_user_id uuid not null,
  nickname_at_grant text not null,
  quantity smallint not null check(quantity between 1 and 10),
  reason text not null check(char_length(reason) between 5 and 300),
  created_at timestamptz not null default now()
);
create index if not exists contact_care_admin_grants_member on public.contact_care_admin_grants(user_id,created_at desc);
alter table public.contact_care_admin_grants enable row level security;
revoke all on public.contact_care_admin_grants from public,anon,authenticated,service_role;
grant select on public.contact_care_admin_grants to service_role;

create or replace function public.grant_contact_care_manual(
  p_admin uuid,p_user uuid,p_request uuid,p_quantity integer,p_reason text,p_expected_nickname text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare prior public.contact_care_admin_grants%rowtype; ref text; inserted integer; repeated boolean := false;
  manual_count integer; claim_count integer;
begin
  if p_admin is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=p_admin and p.role='admin' and not coalesce(p.is_banned,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then raise exception 'CARE_GRANT_ADMIN'; end if;
  if p_user is null or p_request is null or p_quantity is null or p_quantity not between 1 and 10
    or p_reason is null or char_length(btrim(p_reason)) not between 5 and 300
    or p_expected_nickname is null or char_length(btrim(p_expected_nickname)) not between 1 and 100
    then raise exception 'CARE_GRANT_INPUT'; end if;
  ref := 'admin-ui:'||p_request::text;
  -- Serialize a request across different recipients, then this recipient's voucher wallet.
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,17005));
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,17003));
  select * into prior from public.contact_care_admin_grants where id=p_request;
  if found then
    if prior.admin_user_id<>p_admin or prior.user_id<>p_user or prior.quantity<>p_quantity
      or prior.reason<>btrim(p_reason) or prior.nickname_at_grant<>p_expected_nickname
      then raise exception 'CARE_GRANT_CONFLICT'; end if;
    if (select count(*) from public.contact_care_manual_vouchers where grant_reference=ref and user_id=p_user)<>p_quantity
      then raise exception 'CARE_GRANT_INCONSISTENT'; end if;
    repeated := true;
  else
    -- Recheck the exact selected member inside the same transaction as issuance.
    if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
      where p.user_id=p_user and p.nickname=p_expected_nickname and p.phone_verified is true
        and not coalesce(p.is_banned,false) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
      then raise exception 'CARE_GRANT_MEMBER_CHANGED'; end if;
    insert into public.contact_care_admin_grants(id,user_id,admin_user_id,nickname_at_grant,quantity,reason)
      values(p_request,p_user,p_admin,p_expected_nickname,p_quantity,btrim(p_reason));
    insert into public.contact_care_manual_vouchers(user_id,grant_reference,grant_index,reason)
      select p_user,ref,n,btrim(p_reason) from generate_series(1,p_quantity) n;
    get diagnostics inserted = row_count;
    if inserted<>p_quantity then raise exception 'CARE_GRANT_INCONSISTENT'; end if;
  end if;
  select count(*)::int into manual_count from public.contact_care_manual_vouchers where user_id=p_user and used_at is null and revoked_at is null;
  select count(*)::int into claim_count from public.contact_care_claims where user_id=p_user and status='approved' and used_at is null;
  return jsonb_build_object('ok',true,'requestId',p_request,'alreadyGranted',repeated,'quantity',p_quantity,
    'remaining',manual_count+claim_count);
end;
$$;
revoke all on function public.grant_contact_care_manual(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.grant_contact_care_manual(uuid,uuid,uuid,integer,text,text) to service_role;
commit;
notify pgrst,'reload schema';
