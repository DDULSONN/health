-- Referral codes and atomic two-sided apply-credit rewards.
-- Prerequisite: public.profiles, public.dating_cards, public.dating_1on1_cards,
-- public.user_apply_credits, and public.apply_credit_orders.

begin;

create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_codes_format_check check (code ~ '^[A-Z0-9]{8,16}$')
);

create table if not exists public.referral_relationships (
  invitee_user_id uuid primary key references auth.users(id) on delete cascade,
  inviter_user_id uuid not null references auth.users(id) on delete cascade,
  referral_code text not null,
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  claimed_at timestamptz not null default now(),
  rewarded_at timestamptz null,
  inviter_order_id uuid null references public.apply_credit_orders(id) on delete set null,
  invitee_order_id uuid null references public.apply_credit_orders(id) on delete set null,
  constraint referral_relationships_not_self_check check (inviter_user_id <> invitee_user_id)
);

create index if not exists idx_referral_relationships_inviter_claimed
  on public.referral_relationships (inviter_user_id, claimed_at desc);

create index if not exists idx_referral_relationships_status_claimed
  on public.referral_relationships (status, claimed_at desc);

create or replace function public.validate_referral_relationship_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter_created_at timestamptz;
  v_invitee_created_at timestamptz;
begin
  select u.created_at into v_inviter_created_at
  from auth.users u
  where u.id = new.inviter_user_id;

  select u.created_at into v_invitee_created_at
  from auth.users u
  where u.id = new.invitee_user_id;

  if v_inviter_created_at is null or v_invitee_created_at is null then
    raise exception 'REFERRAL_USER_NOT_FOUND';
  end if;

  if v_inviter_created_at >= v_invitee_created_at then
    raise exception 'REFERRAL_INVITER_NOT_OLDER';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_referral_relationship_order on public.referral_relationships;
create trigger trg_validate_referral_relationship_order
before insert or update of inviter_user_id, invitee_user_id on public.referral_relationships
for each row execute procedure public.validate_referral_relationship_order();

alter table public.referral_codes enable row level security;
alter table public.referral_relationships enable row level security;

drop policy if exists "referral_codes_select_own" on public.referral_codes;
create policy "referral_codes_select_own"
  on public.referral_codes for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "referral_relationships_select_participant" on public.referral_relationships;
create policy "referral_relationships_select_participant"
  on public.referral_relationships for select
  to authenticated
  using (auth.uid() = inviter_user_id or auth.uid() = invitee_user_id);

create or replace function public.try_complete_referral_reward(p_invitee_user_id uuid)
returns table (
  result_code text,
  result_inviter_user_id uuid,
  result_invitee_user_id uuid,
  inviter_credits_after int,
  invitee_credits_after int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relationship public.referral_relationships%rowtype;
  v_phone_verified boolean := false;
  v_has_matching_profile boolean := false;
  v_inviter_banned boolean := false;
  v_invitee_banned boolean := false;
  v_inviter_order_id uuid := gen_random_uuid();
  v_invitee_order_id uuid := gen_random_uuid();
  v_inviter_credits int := 0;
  v_invitee_credits int := 0;
  v_now timestamptz := now();
begin
  select rr.*
    into v_relationship
  from public.referral_relationships rr
  where rr.invitee_user_id = p_invitee_user_id
  for update;

  if not found then
    return query select 'NO_REFERRAL'::text, null::uuid, p_invitee_user_id, 0, 0;
    return;
  end if;

  if v_relationship.status = 'rewarded' or v_relationship.rewarded_at is not null then
    select coalesce(u.credits, 0)
      into v_inviter_credits
    from public.user_apply_credits u
    where u.user_id = v_relationship.inviter_user_id;

    select coalesce(u.credits, 0)
      into v_invitee_credits
    from public.user_apply_credits u
    where u.user_id = v_relationship.invitee_user_id;

    return query select
      'ALREADY_REWARDED'::text,
      v_relationship.inviter_user_id,
      v_relationship.invitee_user_id,
      greatest(coalesce(v_inviter_credits, 0), 0),
      greatest(coalesce(v_invitee_credits, 0), 0);
    return;
  end if;

  select coalesce(p.is_banned, false)
    into v_inviter_banned
  from public.profiles p
  where p.user_id = v_relationship.inviter_user_id;

  select coalesce(p.phone_verified, false), coalesce(p.is_banned, false)
    into v_phone_verified, v_invitee_banned
  from public.profiles p
  where p.user_id = v_relationship.invitee_user_id;

  if coalesce(v_inviter_banned, false) or coalesce(v_invitee_banned, false) then
    return query select
      'BANNED_USER'::text,
      v_relationship.inviter_user_id,
      v_relationship.invitee_user_id,
      0,
      0;
    return;
  end if;

  select
    exists (
      select 1
      from public.dating_cards dc
      where dc.owner_user_id = v_relationship.invitee_user_id
        and dc.status in ('pending', 'public')
    )
    or exists (
      select 1
      from public.dating_1on1_cards oc
      where oc.user_id = v_relationship.invitee_user_id
        and oc.status in ('submitted', 'reviewing', 'approved')
    )
    into v_has_matching_profile;

  if not coalesce(v_phone_verified, false) or not coalesce(v_has_matching_profile, false) then
    return query select
      'NOT_ELIGIBLE'::text,
      v_relationship.inviter_user_id,
      v_relationship.invitee_user_id,
      0,
      0;
    return;
  end if;

  insert into public.user_apply_credits (user_id, credits, updated_at)
  values
    (v_relationship.inviter_user_id, 0, v_now),
    (v_relationship.invitee_user_id, 0, v_now)
  on conflict (user_id) do nothing;

  perform u.user_id
  from public.user_apply_credits u
  where u.user_id in (v_relationship.inviter_user_id, v_relationship.invitee_user_id)
  order by u.user_id
  for update;

  update public.user_apply_credits u
  set credits = coalesce(u.credits, 0) + 5,
      updated_at = v_now
  where u.user_id in (v_relationship.inviter_user_id, v_relationship.invitee_user_id);

  insert into public.apply_credit_orders (
    id,
    user_id,
    pack_size,
    amount,
    status,
    processed_at,
    memo
  )
  values
    (
      v_inviter_order_id,
      v_relationship.inviter_user_id,
      5,
      0,
      'approved',
      v_now,
      'referral_reward role=inviter invitee=' || v_relationship.invitee_user_id::text
    ),
    (
      v_invitee_order_id,
      v_relationship.invitee_user_id,
      5,
      0,
      'approved',
      v_now,
      'referral_reward role=invitee inviter=' || v_relationship.inviter_user_id::text
    );

  update public.referral_relationships rr
  set status = 'rewarded',
      rewarded_at = v_now,
      inviter_order_id = v_inviter_order_id,
      invitee_order_id = v_invitee_order_id
  where rr.invitee_user_id = v_relationship.invitee_user_id;

  select coalesce(u.credits, 0)
    into v_inviter_credits
  from public.user_apply_credits u
  where u.user_id = v_relationship.inviter_user_id;

  select coalesce(u.credits, 0)
    into v_invitee_credits
  from public.user_apply_credits u
  where u.user_id = v_relationship.invitee_user_id;

  return query select
    'REWARDED'::text,
    v_relationship.inviter_user_id,
    v_relationship.invitee_user_id,
    greatest(coalesce(v_inviter_credits, 0), 0),
    greatest(coalesce(v_invitee_credits, 0), 0);
end;
$$;

create or replace function public.claim_referral_relationship(
  p_invitee_user_id uuid,
  p_referral_code text
)
returns table (
  result_code text,
  result_inviter_user_id uuid,
  result_invitee_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(regexp_replace(trim(coalesce(p_referral_code, '')), '[^A-Za-z0-9]', '', 'g'));
  v_inviter_user_id uuid;
  v_existing public.referral_relationships%rowtype;
  v_invitee_created_at timestamptz;
  v_inviter_created_at timestamptz;
  v_inviter_banned boolean := false;
begin
  if v_code = '' or v_code !~ '^[A-Z0-9]{8,16}$' then
    return query select 'INVALID_CODE'::text, null::uuid, p_invitee_user_id;
    return;
  end if;

  select u.created_at
    into v_invitee_created_at
  from auth.users u
  where u.id = p_invitee_user_id;

  if not found then
    return query select 'INVITEE_NOT_FOUND'::text, null::uuid, p_invitee_user_id;
    return;
  end if;

  if v_invitee_created_at < now() - interval '72 hours' then
    return query select 'CLAIM_WINDOW_EXPIRED'::text, null::uuid, p_invitee_user_id;
    return;
  end if;

  select rc.user_id, u.created_at
    into v_inviter_user_id, v_inviter_created_at
  from public.referral_codes rc
  join auth.users u on u.id = rc.user_id
  where rc.code = v_code;

  if not found then
    return query select 'INVALID_CODE'::text, null::uuid, p_invitee_user_id;
    return;
  end if;

  if v_inviter_user_id = p_invitee_user_id then
    return query select 'SELF_REFERRAL'::text, v_inviter_user_id, p_invitee_user_id;
    return;
  end if;

  if v_inviter_created_at >= v_invitee_created_at then
    return query select 'INVITER_NOT_OLDER'::text, v_inviter_user_id, p_invitee_user_id;
    return;
  end if;

  select coalesce(p.is_banned, false)
    into v_inviter_banned
  from public.profiles p
  where p.user_id = v_inviter_user_id;

  if coalesce(v_inviter_banned, false) then
    return query select 'INVITER_BANNED'::text, v_inviter_user_id, p_invitee_user_id;
    return;
  end if;

  select rr.*
    into v_existing
  from public.referral_relationships rr
  where rr.invitee_user_id = p_invitee_user_id;

  if found then
    if v_existing.inviter_user_id = v_inviter_user_id then
      return query select 'ALREADY_CLAIMED'::text, v_inviter_user_id, p_invitee_user_id;
    else
      return query select 'ALREADY_HAS_REFERRER'::text, v_existing.inviter_user_id, p_invitee_user_id;
    end if;
    return;
  end if;

  insert into public.referral_relationships (
    invitee_user_id,
    inviter_user_id,
    referral_code
  )
  values (
    p_invitee_user_id,
    v_inviter_user_id,
    v_code
  )
  on conflict (invitee_user_id) do nothing;

  select rr.*
    into v_existing
  from public.referral_relationships rr
  where rr.invitee_user_id = p_invitee_user_id;

  if v_existing.inviter_user_id <> v_inviter_user_id then
    return query select 'ALREADY_HAS_REFERRER'::text, v_existing.inviter_user_id, p_invitee_user_id;
    return;
  end if;

  perform public.try_complete_referral_reward(p_invitee_user_id);

  return query select 'CLAIMED'::text, v_inviter_user_id, p_invitee_user_id;
end;
$$;

create or replace function public.claim_signup_referral_from_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral_code text;
begin
  v_referral_code := nullif(trim(coalesce(new.raw_user_meta_data ->> 'referral_code', '')), '');
  if v_referral_code is not null then
    perform public.claim_referral_relationship(new.id, v_referral_code);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_claim_signup_referral on auth.users;
create trigger trg_claim_signup_referral
after insert on auth.users
for each row execute procedure public.claim_signup_referral_from_metadata();

create or replace function public.try_referral_reward_after_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone_verified is true and (tg_op = 'INSERT' or old.phone_verified is distinct from new.phone_verified) then
    perform public.try_complete_referral_reward(new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_try_referral_reward_after_profile_change on public.profiles;
create trigger trg_try_referral_reward_after_profile_change
after insert or update of phone_verified on public.profiles
for each row execute procedure public.try_referral_reward_after_profile_change();

create or replace function public.try_referral_reward_after_open_card_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('pending', 'public') then
    perform public.try_complete_referral_reward(new.owner_user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_try_referral_reward_after_open_card_change on public.dating_cards;
create trigger trg_try_referral_reward_after_open_card_change
after insert or update of status, owner_user_id on public.dating_cards
for each row execute procedure public.try_referral_reward_after_open_card_change();

create or replace function public.try_referral_reward_after_one_on_one_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('submitted', 'reviewing', 'approved') then
    perform public.try_complete_referral_reward(new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_try_referral_reward_after_one_on_one_change on public.dating_1on1_cards;
create trigger trg_try_referral_reward_after_one_on_one_change
after insert or update of status, user_id on public.dating_1on1_cards
for each row execute procedure public.try_referral_reward_after_one_on_one_change();

revoke all on function public.try_complete_referral_reward(uuid) from public;
revoke all on function public.claim_referral_relationship(uuid, text) from public;
grant execute on function public.try_complete_referral_reward(uuid) to service_role;
grant execute on function public.claim_referral_relationship(uuid, text) to service_role;

commit;

notify pgrst, 'reload schema';
