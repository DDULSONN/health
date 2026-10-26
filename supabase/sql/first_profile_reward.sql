-- Install only. Explicit activation freezes today's existing eligible members.
-- No matching, payment, photo, refresh quota, or registration trigger changes.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table if not exists public.first_profile_reward_campaign (
  campaign_key text primary key check (campaign_key = 'first-profile-2026-10'),
  enabled boolean not null default false,
  activated_at timestamptz,
  check (not enabled or activated_at is not null)
);
insert into public.first_profile_reward_campaign(campaign_key)
values ('first-profile-2026-10') on conflict do nothing;
create table if not exists public.first_profile_reward_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  campaign_key text not null references public.first_profile_reward_campaign(campaign_key),
  eligible_at timestamptz not null,
  rewarded_at timestamptz,
  reward_order_id uuid references public.apply_credit_orders(id) on delete set null,
  rewarded_card_id uuid
);
alter table public.first_profile_reward_campaign enable row level security;
alter table public.first_profile_reward_members enable row level security;
revoke all on public.first_profile_reward_campaign, public.first_profile_reward_members from public,anon,authenticated,service_role;
grant select on public.first_profile_reward_campaign, public.first_profile_reward_members to service_role;

create or replace function public.activate_first_profile_reward()
returns integer language plpgsql security definer set search_path = pg_catalog
set lock_timeout = '3s' set statement_timeout = '30s' as $$
declare v_start timestamptz := clock_timestamp(); v_existing timestamptz; v_count integer;
begin
  select activated_at into v_existing from public.first_profile_reward_campaign
    where campaign_key = 'first-profile-2026-10' for update;
  if v_existing is not null then
    select count(*)::integer into v_count from public.first_profile_reward_members;
    return v_count;
  end if;
  -- Both history sources matter: deleting a profile must not create eligibility.
  -- Missing required migrations fail the transaction; never enroll too broadly.
  insert into public.first_profile_reward_members(user_id,campaign_key,eligible_at)
  select p.user_id,'first-profile-2026-10',v_start
  from public.profiles p join auth.users u on u.id=p.user_id
  where p.role='user' and not coalesce(p.is_banned,false)
    and u.created_at<=v_start and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=v_start)
    and not exists(select 1 from public.dating_1on1_cards c where c.user_id=p.user_id)
    and not exists(select 1 from public.dating_1on1_metric_events e
      where e.user_id=p.user_id and e.event_kind='application_created')
    and not exists(select 1 from public.return_profile_reward_members r where r.user_id=p.user_id)
  on conflict(user_id) do nothing;
  get diagnostics v_count = row_count;
  update public.first_profile_reward_campaign set enabled=true,activated_at=v_start
    where campaign_key='first-profile-2026-10';
  return v_count;
end;
$$;

-- Internal helper; no browser/service-role execution grant.
create or replace function public.first_profile_reward_card(p_user_id uuid,p_since timestamptz)
returns uuid language sql stable security definer set search_path = pg_catalog as $$
  select c.id from public.dating_1on1_cards c join public.profiles p on p.user_id=c.user_id
  where c.user_id=p_user_id and c.created_at>=p_since
    and c.status in ('submitted','reviewing','approved') and p.phone_verified is true
    and case when jsonb_typeof(c.photo_paths)='array' then jsonb_array_length(c.photo_paths)=2 else false end
    and jsonb_typeof(c.photo_paths->0)='string' and jsonb_typeof(c.photo_paths->1)='string'
    and c.photo_paths->>0 like 'cards/'||c.user_id::text||'/%'
    and c.photo_paths->>1 like 'cards/'||c.user_id::text||'/%'
    and length(c.photo_paths->>0)>length('cards/'||c.user_id::text||'/')
    and length(c.photo_paths->>1)>length('cards/'||c.user_id::text||'/')
    and c.photo_paths->>0<>c.photo_paths->>1
    and c.consent_fake_info and c.consent_no_show and c.consent_fee and c.consent_privacy
  order by c.created_at,c.id limit 1;
$$;

create or replace function public.first_profile_reward_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_member public.first_profile_reward_members%rowtype;
begin
  if not exists(select 1 from public.first_profile_reward_campaign where enabled) then return null; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=p_user_id and p.role='user' and not coalesce(p.is_banned,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then return null; end if;
  -- Defence in depth if a returning-member cohort is activated later.
  if exists(select 1 from public.return_profile_reward_members where user_id=p_user_id) then return null; end if;
  select * into v_member from public.first_profile_reward_members where user_id=p_user_id;
  if not found then return null; end if;
  return jsonb_build_object('campaignKey',v_member.campaign_key,'credits',1,'state',
    case when v_member.rewarded_at is not null then 'rewarded'
      when public.first_profile_reward_card(p_user_id,v_member.eligible_at) is not null then 'ready'
      else 'eligible' end);
end;
$$;

create or replace function public.claim_first_profile_reward(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
set lock_timeout = '2s' set statement_timeout = '3s' as $$
declare v_member public.first_profile_reward_members%rowtype; v_card uuid; v_order uuid:=gen_random_uuid();
begin
  -- Same lock order as the existing reward: campaign -> member -> profile -> card -> balance.
  perform 1 from public.first_profile_reward_campaign where enabled for share;
  if not found then return null; end if;
  select * into v_member from public.first_profile_reward_members where user_id=p_user_id for update;
  if not found then return null; end if;
  perform 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=p_user_id and p.role='user' and not coalesce(p.is_banned,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) for update of p;
  if not found then return null; end if;
  if exists(select 1 from public.return_profile_reward_members where user_id=p_user_id) then return null; end if;
  if v_member.rewarded_at is not null then return public.first_profile_reward_status(p_user_id); end if;
  v_card:=public.first_profile_reward_card(p_user_id,v_member.eligible_at);
  if v_card is null then return public.first_profile_reward_status(p_user_id); end if;
  perform 1 from public.dating_1on1_cards where id=v_card and status in ('submitted','reviewing','approved') for share;
  if not found or public.first_profile_reward_card(p_user_id,v_member.eligible_at) is distinct from v_card
    then return public.first_profile_reward_status(p_user_id); end if;
  insert into public.user_apply_credits as balance(user_id,credits,updated_at)
    values(p_user_id,1,now()) on conflict(user_id) do update set credits=balance.credits+1,updated_at=now();
  insert into public.apply_credit_orders(id,user_id,pack_size,amount,status,processed_at,memo)
    values(v_order,p_user_id,1,0,'approved',now(),'first_profile_reward campaign=first-profile-2026-10');
  update public.first_profile_reward_members set rewarded_at=now(),reward_order_id=v_order,rewarded_card_id=v_card
    where user_id=p_user_id;
  return jsonb_build_object('campaignKey',v_member.campaign_key,'credits',1,'state','rewarded');
end;
$$;
revoke all on function public.activate_first_profile_reward() from public,anon,authenticated;
revoke all on function public.first_profile_reward_card(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.first_profile_reward_status(uuid) from public,anon,authenticated;
revoke all on function public.claim_first_profile_reward(uuid) from public,anon,authenticated;
grant execute on function public.activate_first_profile_reward() to service_role;
grant execute on function public.first_profile_reward_status(uuid) to service_role;
grant execute on function public.claim_first_profile_reward(uuid) to service_role;
commit;
notify pgrst, 'reload schema';
