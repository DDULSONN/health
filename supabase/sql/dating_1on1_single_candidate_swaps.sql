-- Additive, independently reversible rollout. Requires the 1:1 profile,
-- impressions, recommendation pages and candidate hide/block migrations.
-- The overlay is scoped to an exact server-computed generation. Do not write
-- the normal page seed, refresh events, compensation, matches or payments.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table if not exists public.dating_1on1_single_candidate_swaps (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_card_id uuid not null references public.dating_1on1_cards(id) on delete cascade,
  generation_key text not null check (generation_key ~ '^[0-9a-f]{64}$'),
  from_candidate_card_id uuid not null,
  to_candidate_card_id uuid not null,
  to_candidate_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, source_card_id, generation_key, from_candidate_card_id),
  check (from_candidate_card_id <> to_candidate_card_id and user_id <> to_candidate_user_id)
);
create index if not exists dating_1on1_single_swap_recent
  on public.dating_1on1_single_candidate_swaps(user_id, created_at desc);
create index if not exists dating_1on1_single_swap_recent_user
  on public.dating_1on1_single_candidate_swaps(user_id, to_candidate_user_id, created_at desc);
alter table public.dating_1on1_single_candidate_swaps enable row level security;
revoke all on public.dating_1on1_single_candidate_swaps from public, anon, authenticated, service_role;
grant select on public.dating_1on1_single_candidate_swaps to service_role;

create or replace function public.commit_dating_1on1_single_candidate_swap(
  p_user_id uuid, p_source_card_id uuid, p_generation_key text,
  p_generation_at timestamptz, p_expected_refresh_at timestamptz,
  p_from_candidate_card_id uuid, p_to_candidate_card_id uuid, p_planned_at timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog
set lock_timeout = '3s' set statement_timeout = '10s' as $$
declare
  v_now timestamptz;
  v_birth_cutoff int;
  v_source public.dating_1on1_cards%rowtype;
  v_from public.dating_1on1_cards%rowtype;
  v_to public.dating_1on1_cards%rowtype;
  v_previous uuid;
begin
  if p_user_id is null or p_source_card_id is null or p_generation_key is null
    or p_generation_key !~ '^[0-9a-f]{64}$' or p_generation_at is null or not isfinite(p_generation_at)
    or p_planned_at is null or not isfinite(p_planned_at) or p_generation_at > p_planned_at + interval '5 seconds'
    or p_from_candidate_card_id is null or p_to_candidate_card_id is null
    or p_from_candidate_card_id = p_to_candidate_card_id
    or p_source_card_id in (p_from_candidate_card_id, p_to_candidate_card_id) then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- Check/lock the own source first, in the same order as checked refresh and
  -- partial repair. The hide lock is viewer-scoped and also serializes the
  -- rolling swap bound across all source cards belonging to this member.
  select * into v_source from public.dating_1on1_cards
    where id = p_source_card_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'source_unavailable'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 17004));
  v_now := clock_timestamp();
  v_birth_cutoff := extract(year from v_now at time zone 'Asia/Seoul')::int - 19;
  if p_planned_at < v_now - interval '1 minute' or p_planned_at > v_now + interval '5 seconds'
    or v_source.recommendation_refresh_used_at is distinct from p_expected_refresh_at
    or v_source.updated_at > p_planned_at then
    return jsonb_build_object('ok', false, 'code', 'stale_generation');
  end if;
  if v_source.status not in ('submitted', 'reviewing', 'approved') or v_source.sex not in ('male', 'female')
    or v_source.birth_year not between 1960 and v_birth_cutoff
    or not exists (
      select 1 from auth.users u join public.profiles p on p.user_id = u.id
      where u.id = p_user_id and u.deleted_at is null and not coalesce(p.is_banned, false)
        and (u.banned_until is null or u.banned_until <= v_now)
    )
    or exists (
      select 1 from public.dating_1on1_cards c where c.user_id = p_user_id
        and c.status in ('submitted', 'reviewing', 'approved') and (c.created_at, c.id) > (v_source.created_at, v_source.id)
    ) then
    return jsonb_build_object('ok', false, 'code', 'source_unavailable');
  end if;

  select to_candidate_card_id into v_previous from public.dating_1on1_single_candidate_swaps
    where user_id = p_user_id and source_card_id = p_source_card_id and generation_key = p_generation_key
      and from_candidate_card_id = p_from_candidate_card_id;
  if found then
    if v_previous = p_to_candidate_card_id then
      -- Do not issue a candidate payload; the next read still filters it.
      return jsonb_build_object('ok', true, 'code', 'already_swapped');
    end if;
    return jsonb_build_object('ok', false, 'code', 'slot_already_swapped');
  end if;
  if (select count(*) from public.dating_1on1_single_candidate_swaps
    where user_id = p_user_id and created_at > v_now - interval '24 hours') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'swap_limit');
  end if;

  -- Do not wait on reciprocal swaps that already hold the other source lock.
  perform 1 from public.dating_1on1_cards
    where id in (p_from_candidate_card_id, p_to_candidate_card_id) order by id for share nowait;
  select * into v_from from public.dating_1on1_cards where id = p_from_candidate_card_id;
  select * into v_to from public.dating_1on1_cards where id = p_to_candidate_card_id;
  if v_from.id is null or v_to.id is null or v_to.user_id in (p_user_id, v_from.user_id)
    or v_from.sex = v_source.sex or v_to.sex not in ('male', 'female') or v_to.sex = v_source.sex
    or v_to.status not in ('submitted', 'reviewing', 'approved') or v_to.updated_at > p_planned_at
    or v_to.birth_year not between 1960 and v_birth_cutoff
    or not exists (
      select 1 from auth.users u join public.profiles p on p.user_id = u.id
      where u.id = v_to.user_id and u.deleted_at is null and not coalesce(p.is_banned, false)
        and (u.banned_until is null or u.banned_until <= v_now)
    )
    or exists (
      select 1 from public.dating_1on1_cards c where c.user_id = v_to.user_id
        and c.status in ('submitted', 'reviewing', 'approved') and (c.created_at, c.id) > (v_to.created_at, v_to.id)
    ) then
    return jsonb_build_object('ok', false, 'code', 'candidate_unavailable');
  end if;
  if not exists (
      select 1 from public.dating_1on1_candidate_impressions i
      where i.viewer_user_id = p_user_id and i.candidate_user_id = v_from.user_id
        and i.first_seen_at >= v_now - interval '30 days'
        and i.first_seen_at < p_generation_at
    ) then
    return jsonb_build_object('ok', false, 'code', 'stale_generation');
  end if;
  if exists (
      select 1 from public.dating_1on1_candidate_impressions i
      where i.viewer_user_id = p_user_id and i.candidate_user_id = v_to.user_id
        and i.first_seen_at >= v_now - interval '30 days' and i.first_seen_at <= v_now
    ) or exists (
      select 1 from public.dating_1on1_single_candidate_swaps prior where prior.user_id = p_user_id
        and prior.to_candidate_user_id = v_to.user_id and (prior.created_at >= v_now - interval '30 days'
          or (prior.source_card_id = p_source_card_id and prior.generation_key = p_generation_key))
    ) then
    return jsonb_build_object('ok', false, 'code', 'already_seen');
  end if;
  if exists (
      select 1 from public.dating_1on1_candidate_hides h where h.user_id = p_user_id and h.candidate_user_id in (v_from.user_id, v_to.user_id)
    ) or exists (
      select 1 from public.dating_1on1_candidate_favorites f join public.dating_1on1_cards c on c.id = f.candidate_card_id
      where f.user_id = p_user_id and c.user_id = v_to.user_id
    ) or exists (
      select 1 from public.dating_1on1_match_proposals m where
        (m.source_user_id = p_user_id and m.candidate_user_id = v_to.user_id) or
        (m.source_user_id = v_to.user_id and m.candidate_user_id = p_user_id)
    ) or exists (
      select 1 from public.dating_user_blocks b where
        (b.blocker_user_id = p_user_id and b.blocked_user_id = v_to.user_id) or
        (b.blocker_user_id = v_to.user_id and b.blocked_user_id = p_user_id)
    ) or exists (
      select 1 from public.dating_1on1_admin_user_blocks b where
        (b.user_a_id = p_user_id and b.user_b_id = v_to.user_id) or
        (b.user_a_id = v_to.user_id and b.user_b_id = p_user_id)
    ) or exists (
      -- Exact contact HMAC checks live in the trusted planner; reject any new
      -- pair-side block since that read without exposing the hashing secrets.
      select 1 from public.dating_1on1_phone_blocks b where b.user_id in (p_user_id, v_to.user_id) and b.created_at >= p_planned_at
    ) or exists (
      select 1 from public.dating_contact_blocks b where b.user_id in (p_user_id, v_to.user_id) and b.created_at >= p_planned_at
    ) or exists (
      select 1 from public.dating_1on1_recommendation_pages s join public.dating_1on1_cards c
        on c.id = any(s.main_candidate_ids || s.extra_candidate_ids)
      where s.user_id = p_user_id and s.source_card_id = p_source_card_id and s.refreshed_at = p_generation_at
        and c.user_id = v_to.user_id
    ) then
    return jsonb_build_object('ok', false, 'code', 'candidate_excluded');
  end if;

  insert into public.dating_1on1_single_candidate_swaps
    (user_id, source_card_id, generation_key, from_candidate_card_id, to_candidate_card_id, to_candidate_user_id, created_at)
    values (p_user_id, p_source_card_id, p_generation_key, p_from_candidate_card_id, p_to_candidate_card_id, v_to.user_id, v_now);
  delete from public.dating_1on1_single_candidate_swaps
    where user_id = p_user_id and created_at < v_now - interval '40 days'
      and (source_card_id, generation_key) is distinct from (p_source_card_id, p_generation_key);
  return jsonb_build_object('ok', true, 'code', 'swapped');
exception when lock_not_available or deadlock_detected then
  return jsonb_build_object('ok', false, 'code', 'stale_generation');
end;
$$;

revoke all on function public.commit_dating_1on1_single_candidate_swap(uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_dating_1on1_single_candidate_swap(uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,timestamptz)
  to service_role;
commit;
notify pgrst, 'reload schema';
