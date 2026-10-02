-- One fixed reactivation cohort; install does NOT enroll members or award credits.
-- Requires existing activity, onboarding, profile, card, and apply-credit tables.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table if not exists public.return_profile_reward_campaign (
  campaign_key text primary key check (campaign_key = 'return-profile-2026-10'),
  enabled boolean not null default false,
  activated_at timestamptz,
  inactivity_cutoff timestamptz,
  check ((activated_at is null) = (inactivity_cutoff is null)),
  check (not enabled or activated_at is not null)
);
insert into public.return_profile_reward_campaign(campaign_key)
values ('return-profile-2026-10') on conflict do nothing;

create table if not exists public.return_profile_reward_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  campaign_key text not null references public.return_profile_reward_campaign(campaign_key),
  eligible_at timestamptz not null,
  last_activity_at timestamptz not null,
  rewarded_at timestamptz,
  reward_order_id uuid references public.apply_credit_orders(id) on delete set null,
  rewarded_card_id uuid,
  check (last_activity_at < eligible_at)
);
alter table public.return_profile_reward_campaign enable row level security;
alter table public.return_profile_reward_members enable row level security;
revoke all on public.return_profile_reward_campaign, public.return_profile_reward_members from public, anon, authenticated, service_role;
grant select on public.return_profile_reward_campaign, public.return_profile_reward_members to service_role;

-- Deliberately invoked separately, ONCE, before public release. Never re-enroll on login.
create or replace function public.activate_return_profile_reward()
returns integer language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_start timestamptz := clock_timestamp();
  v_cutoff timestamptz;
  v_existing timestamptz;
  v_count integer;
begin
  select activated_at into v_existing from public.return_profile_reward_campaign
    where campaign_key = 'return-profile-2026-10' for update;
  if v_existing is not null then
    select count(*)::integer into v_count from public.return_profile_reward_members;
    return v_count;
  end if;
  v_cutoff := ((v_start at time zone 'Asia/Seoul') - interval '3 months') at time zone 'Asia/Seoul';
  with one_activity as (
    select c.user_id, max(greatest(c.created_at,
      nullif(to_jsonb(c)->>'recommendation_refresh_used_at', '')::timestamptz)) as last_at
    from public.dating_1on1_cards c group by c.user_id
  ), open_activity as (
    select c.owner_user_id as user_id, max(c.created_at) as last_at
    from public.dating_cards c group by c.owner_user_id
  ), funnel_activity as (
    select e.user_id, max(e.first_seen_at) as last_at
    from public.onboarding_funnel_events e group by e.user_id
  ), session_activity as (
    select s.user_id, max(greatest(s.created_at,s.updated_at)) as last_at
    from auth.sessions s group by s.user_id
  ), candidates as (
    select p.user_id, greatest(u.created_at, u.last_sign_in_at,
      p.last_meaningful_activity_at, o.last_at, c.last_at, f.last_at, s.last_at) as last_at
    from public.profiles p join auth.users u on u.id = p.user_id
    left join one_activity o on o.user_id = p.user_id
    left join open_activity c on c.user_id = p.user_id
    left join funnel_activity f on f.user_id = p.user_id
    left join session_activity s on s.user_id = p.user_id
    where p.role = 'user' and not coalesce(p.is_banned, false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= v_start)
      and not exists(select 1 from public.dating_1on1_cards a where a.user_id = p.user_id
        and a.status in ('submitted', 'reviewing', 'approved'))
  )
  insert into public.return_profile_reward_members(user_id,campaign_key,eligible_at,last_activity_at)
  select user_id, 'return-profile-2026-10', v_start, last_at from candidates where last_at <= v_cutoff
  on conflict (user_id) do nothing;
  get diagnostics v_count = row_count;
  update public.return_profile_reward_campaign set activated_at = v_start,
    inactivity_cutoff = v_cutoff, enabled = true where campaign_key = 'return-profile-2026-10';
  return v_count;
end;
$$;

create or replace function public.return_profile_reward_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare v_member public.return_profile_reward_members%rowtype; v_ready boolean;
begin
  if not exists(select 1 from public.return_profile_reward_campaign where enabled) then return null; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id = p.user_id
    where p.user_id = p_user_id and p.role = 'user' and not coalesce(p.is_banned,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())) then return null; end if;
  select * into v_member from public.return_profile_reward_members where user_id = p_user_id;
  if not found then return null; end if;
  select exists(select 1 from public.dating_1on1_cards c join public.profiles p on p.user_id = c.user_id
    where c.user_id = p_user_id and c.created_at >= v_member.eligible_at
      and c.status in ('submitted','reviewing','approved')
      and case when jsonb_typeof(c.photo_paths) = 'array' then jsonb_array_length(c.photo_paths) = 2 else false end
      and jsonb_typeof(c.photo_paths->0) = 'string' and jsonb_typeof(c.photo_paths->1) = 'string'
      and c.photo_paths->>0 like 'cards/' || c.user_id::text || '/%'
      and c.photo_paths->>1 like 'cards/' || c.user_id::text || '/%'
      and c.consent_fake_info and c.consent_no_show and c.consent_fee and c.consent_privacy
      and p.phone_verified is true) into v_ready;
  return jsonb_build_object('campaignKey',v_member.campaign_key,'credits',5,
    'state',case when v_member.rewarded_at is not null then 'rewarded' when v_ready then 'ready' else 'eligible' end);
end;
$$;

create or replace function public.claim_return_profile_reward(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog
set lock_timeout = '2s' set statement_timeout = '3s' as $$
declare
  v_member public.return_profile_reward_members%rowtype;
  v_card uuid; v_order uuid := gen_random_uuid(); v_verified boolean;
begin
  -- Fixed lock order: campaign -> member -> profile -> card -> credit balance.
  perform 1 from public.return_profile_reward_campaign where enabled for share;
  if not found then return null; end if;
  select * into v_member from public.return_profile_reward_members where user_id = p_user_id for update;
  if not found then return null; end if;
  select p.phone_verified into v_verified from public.profiles p join auth.users u on u.id = p.user_id
    where p.user_id = p_user_id and p.role = 'user' and not coalesce(p.is_banned,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now()) for update of p;
  if not found then return null; end if;
  if v_member.rewarded_at is not null then return public.return_profile_reward_status(p_user_id); end if;
  if v_verified is not true then return public.return_profile_reward_status(p_user_id); end if;
  select c.id into v_card from public.dating_1on1_cards c
    where c.user_id = p_user_id and c.created_at >= v_member.eligible_at
      and c.status in ('submitted','reviewing','approved')
      and case when jsonb_typeof(c.photo_paths) = 'array' then jsonb_array_length(c.photo_paths) = 2 else false end
      and jsonb_typeof(c.photo_paths->0) = 'string' and jsonb_typeof(c.photo_paths->1) = 'string'
      and c.photo_paths->>0 like 'cards/' || c.user_id::text || '/%'
      and c.photo_paths->>1 like 'cards/' || c.user_id::text || '/%'
      and c.consent_fake_info and c.consent_no_show and c.consent_fee and c.consent_privacy
    order by c.created_at,c.id limit 1 for share;
  if v_card is null then return public.return_profile_reward_status(p_user_id); end if;

  insert into public.user_apply_credits as balance(user_id,credits,updated_at)
    values(p_user_id,5,now()) on conflict(user_id) do update
    set credits = balance.credits + 5, updated_at = now();
  insert into public.apply_credit_orders(id,user_id,pack_size,amount,status,processed_at,memo)
    values(v_order,p_user_id,5,0,'approved',now(),'return_profile_reward campaign=return-profile-2026-10');
  update public.return_profile_reward_members set rewarded_at = now(), reward_order_id = v_order,
    rewarded_card_id = v_card where user_id = p_user_id;
  return jsonb_build_object('campaignKey',v_member.campaign_key,'credits',5,'state','rewarded');
end;
$$;
revoke all on function public.activate_return_profile_reward() from public,anon,authenticated;
revoke all on function public.return_profile_reward_status(uuid) from public,anon,authenticated;
revoke all on function public.claim_return_profile_reward(uuid) from public,anon,authenticated;
grant execute on function public.activate_return_profile_reward() to service_role;
grant execute on function public.return_profile_reward_status(uuid) to service_role;
grant execute on function public.claim_return_profile_reward(uuid) to service_role;
commit;
notify pgrst, 'reload schema';
