begin;
set local lock_timeout = '2s';

-- Apply after dating_love_pass.sql and the existing dating_card_swipe_matches.sql.
-- The record survives a later swipe withdrawal/expiry. It never grants contact access.
create table if not exists public.dating_love_pass_swipe_likes (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  target_user_id uuid references auth.users(id) on delete set null,
  sent_at timestamptz not null default now(),
  unique (actor_user_id, usage_day, target_user_id)
);
alter table public.dating_love_pass_swipe_likes enable row level security;
revoke all on public.dating_love_pass_swipe_likes from public, anon, authenticated;

create or replace function public.dating_love_pass_swipe_likes_left(p_user_id uuid, p_now timestamptz)
returns integer
language sql stable security definer set search_path = ''
as $$
  select greatest(0, 50 - (
    select count(*)::integer
    from public.dating_love_pass_swipe_likes l
    where l.actor_user_id = p_user_id and l.usage_day = (p_now at time zone 'Asia/Seoul')::date
  ) - (
    select count(distinct s.target_user_id)::integer
    from public.dating_card_swipes s
    where s.actor_user_id = p_user_id and s.action = 'like'
      and s.created_at >= (date_trunc('day', p_now at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
      and s.created_at < ((date_trunc('day', p_now at time zone 'Asia/Seoul') + interval '1 day') at time zone 'Asia/Seoul')
      and not exists (
        select 1 from public.dating_love_pass_swipe_likes l where l.actor_user_id = s.actor_user_id
          and l.target_user_id = s.target_user_id and l.usage_day = (p_now at time zone 'Asia/Seoul')::date
      )
  ));
$$;

create or replace function public.get_dating_love_pass_swipe_status(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when public.get_active_dating_love_pass(p_user_id) is null then null::jsonb
    else jsonb_build_object('remaining', public.dating_love_pass_swipe_likes_left(p_user_id, now())) end;
$$;

create or replace function public.get_dating_love_pass_swipe_users(p_user_ids uuid[])
returns table(user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select distinct candidate.id from unnest(p_user_ids) candidate(id)
  join public.profiles p on p.user_id = candidate.id
  join auth.users u on u.id = candidate.id
  where p.phone_verified is true and p.is_banned is not true and p.swipe_profile_visible is distinct from false
    and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
    and public.get_active_dating_love_pass(candidate.id) is not null;
$$;

-- Old clients may insert directly for legacy service levels. For Love Pass users,
-- requiring the checked API prevents an unaccounted write through a legacy policy.
create or replace function public.guard_dating_love_pass_swipe_direct()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated')
    and public.get_active_dating_love_pass(new.actor_user_id) is not null then
    raise exception using errcode = '42501', message = 'Love Pass swipes must use the server route';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_dating_love_pass_swipe_direct on public.dating_card_swipes;
create trigger trg_dating_love_pass_swipe_direct
  before insert or update of action, actor_user_id on public.dating_card_swipes
  for each row execute function public.guard_dating_love_pass_swipe_direct();

create or replace function public.record_dating_love_pass_swipe(
  p_user_id uuid, p_actor_card_id uuid, p_target_user_id uuid,
  p_target_card_id uuid, p_target_sex text, p_action text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_pass_id uuid;
  v_existing public.dating_card_swipes%rowtype;
  v_remaining integer;
  v_now timestamptz;
  v_day date;
  v_stale boolean := false;
  v_pair_key text;
begin
  if p_user_id is null or p_target_user_id is null or p_user_id = p_target_user_id
    or p_actor_card_id is null or p_target_card_id is null
    or p_action is null or p_action not in ('like', 'pass')
    or p_target_sex is null or p_target_sex not in ('male', 'female') then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Per-actor serialization covers both competing inserts and conversions of old passes.
  perform pg_advisory_xact_lock(hashtextextended('dating-love-pass:' || p_user_id::text, 0));
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Seoul')::date;
  v_pass_id := public.get_active_dating_love_pass(p_user_id);
  perform 1 from public.dating_love_passes ent
    where ent.id = v_pass_id and ent.starts_at <= v_now and ent.expires_at > v_now and ent.revoked_at is null
    for share;
  if not found then
    return jsonb_build_object('outcome', 'inactive');
  end if;

  if not exists (
    select 1 from public.dating_cards c join public.profiles p on p.user_id = c.owner_user_id
      join auth.users u on u.id = c.owner_user_id
    where c.id = p_actor_card_id and c.owner_user_id = p_user_id
      and c.status in ('pending', 'public', 'expired') and length(btrim(c.instagram_id)) > 0
      and c.age between 19 and 99 and p.phone_verified is true and p.is_banned is not true
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= v_now)
  ) or not exists (
    select 1 from public.dating_cards c join public.profiles p on p.user_id = c.owner_user_id
      join auth.users u on u.id = c.owner_user_id
    where c.id = p_target_card_id and c.owner_user_id = p_target_user_id and c.sex = p_target_sex
      and c.status in ('pending', 'public', 'expired') and length(btrim(c.instagram_id)) > 0
      and c.age between 19 and 99 and p.is_banned is not true and p.swipe_profile_visible is distinct from false
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= v_now)
  ) then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  v_pair_key := least(p_user_id::text, p_target_user_id::text) || ':' || greatest(p_user_id::text, p_target_user_id::text);
  if exists (select 1 from public.dating_card_swipe_matches m where m.pair_key = v_pair_key) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  select s.* into v_existing from public.dating_card_swipes s
    where s.actor_user_id = p_user_id and s.target_user_id = p_target_user_id and s.target_sex = p_target_sex
    for update;
  if found and v_existing.action = 'like' then
    v_stale := v_existing.created_at >= timestamptz '2026-04-16 13:14:34.410Z'
      and v_existing.created_at <= v_now - interval '30 hours';
    if not v_stale then
      return jsonb_build_object('outcome', 'duplicate');
    end if;
  elsif found and p_action = 'pass' and (v_existing.created_at at time zone 'Asia/Seoul')::date >= v_day then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  v_remaining := public.dating_love_pass_swipe_likes_left(p_user_id, v_now);
  if p_action = 'like' then
    if exists (select 1 from public.dating_love_pass_swipe_likes s
      where s.actor_user_id = p_user_id and s.target_user_id = p_target_user_id and s.usage_day = v_day) then
      return jsonb_build_object('outcome', 'duplicate');
    end if;
    if v_remaining <= 0 then
      return jsonb_build_object('outcome', 'limited', 'remaining', 0);
    end if;
  end if;

  if v_stale then
    delete from public.dating_card_swipes where id = v_existing.id;
    v_existing.id := null;
  end if;
  if v_existing.id is not null then
    update public.dating_card_swipes set
      actor_card_id = p_actor_card_id, target_card_id = p_target_card_id, action = p_action, created_at = v_now
      where id = v_existing.id;
  else
    insert into public.dating_card_swipes (actor_user_id, actor_card_id, target_user_id, target_card_id, target_sex, action, created_at)
      values (p_user_id, p_actor_card_id, p_target_user_id, p_target_card_id, p_target_sex, p_action, v_now);
  end if;
  if p_action = 'like' then
    insert into public.dating_love_pass_swipe_likes (actor_user_id, usage_day, target_user_id, sent_at)
      values (p_user_id, v_day, p_target_user_id, v_now);
  end if;
  return jsonb_build_object('outcome', 'saved', 'remaining', public.dating_love_pass_swipe_likes_left(p_user_id, v_now));
end;
$$;

revoke all on function public.dating_love_pass_swipe_likes_left(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.guard_dating_love_pass_swipe_direct() from public, anon, authenticated;
revoke all on function public.get_dating_love_pass_swipe_status(uuid) from public, anon, authenticated;
revoke all on function public.get_dating_love_pass_swipe_users(uuid[]) from public, anon, authenticated;
revoke all on function public.record_dating_love_pass_swipe(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_dating_love_pass_swipe_status(uuid) to service_role;
grant execute on function public.get_dating_love_pass_swipe_users(uuid[]) to service_role;
grant execute on function public.record_dating_love_pass_swipe(uuid, uuid, uuid, uuid, text, text) to service_role;

commit;
