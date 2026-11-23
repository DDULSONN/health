-- Additive, independently reversible rollout. The existing unseen-only RPC,
-- full refresh RPC, and overlay table are unchanged. Only a trusted server
-- may submit a fallback ranked from its current safety-filtered candidate pool.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.commit_dating_1on1_single_candidate_fallback_swap(
  p_user_id uuid, p_source_card_id uuid, p_generation_key text,
  p_generation_at timestamptz, p_expected_refresh_at timestamptz,
  p_from_candidate_card_id uuid, p_to_candidate_card_id uuid, p_planned_at timestamptz,
  p_source_profile_key text, p_to_profile_key text,
  p_expected_swap_count integer, p_expected_swap_latest_at timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog
set lock_timeout = '3s' set statement_timeout = '10s' as $$
declare
  v_now timestamptz;
  v_birth_cutoff int;
  v_source public.dating_1on1_cards%rowtype;
  v_from public.dating_1on1_cards%rowtype;
  v_to public.dating_1on1_cards%rowtype;
  v_previous uuid;
  v_swap_count integer;
  v_swap_latest_at timestamptz;
begin
  if p_user_id is null or p_source_card_id is null or p_generation_key is null
    or p_generation_key !~ '^[0-9a-f]{64}$' or p_generation_at is null or not isfinite(p_generation_at)
    or p_source_profile_key is null or p_source_profile_key !~ '^[0-9a-f]{32}$'
    or p_to_profile_key is null or p_to_profile_key !~ '^[0-9a-f]{32}$'
    or p_planned_at is null or not isfinite(p_planned_at) or p_generation_at > p_planned_at + interval '5 seconds'
    or p_from_candidate_card_id is null or p_to_candidate_card_id is null
    or p_from_candidate_card_id = p_to_candidate_card_id
    or p_source_card_id in (p_from_candidate_card_id, p_to_candidate_card_id)
    or p_expected_swap_count is null or p_expected_swap_count < 0
    or ((p_expected_swap_count = 0) is distinct from (p_expected_swap_latest_at is null))
    or (p_expected_swap_latest_at is not null and not isfinite(p_expected_swap_latest_at)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- Same source-row, viewer-hide, then candidate-card lock order as the
  -- unseen-only operation. Both operations share the exact overlay limit.
  select * into v_source from public.dating_1on1_cards
    where id = p_source_card_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'source_unavailable'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 17004));
  v_now := clock_timestamp();
  v_birth_cutoff := extract(year from v_now at time zone 'Asia/Seoul')::int - 19;
  if p_planned_at < v_now - interval '1 minute' or p_planned_at > v_now + interval '5 seconds'
    or v_source.recommendation_refresh_used_at is distinct from p_expected_refresh_at
    or v_source.updated_at > p_planned_at
    or md5(v_source.sex || ':' || v_source.birth_year::text || ':' || coalesce(v_source.region, '')) is distinct from p_source_profile_key then
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
      -- An exact replay returns no candidate payload and never writes again.
      return jsonb_build_object('ok', true, 'code', 'already_swapped');
    end if;
    return jsonb_build_object('ok', false, 'code', 'slot_already_swapped');
  end if;
  select count(*)::int, max(s.created_at) into v_swap_count, v_swap_latest_at
    from public.dating_1on1_single_candidate_swaps s where s.user_id = p_user_id;
  if v_swap_count is distinct from p_expected_swap_count or v_swap_latest_at is distinct from p_expected_swap_latest_at then
    return jsonb_build_object('ok', false, 'code', 'stale_generation');
  end if;
  if (select count(*) from public.dating_1on1_single_candidate_swaps
    where user_id = p_user_id and created_at > v_now - interval '24 hours') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'swap_limit');
  end if;

  perform 1 from public.dating_1on1_cards
    where id in (p_from_candidate_card_id, p_to_candidate_card_id) order by id for share nowait;
  select * into v_from from public.dating_1on1_cards where id = p_from_candidate_card_id;
  select * into v_to from public.dating_1on1_cards where id = p_to_candidate_card_id;
  if v_from.id is null or v_to.id is null or v_to.user_id in (p_user_id, v_from.user_id)
    or v_from.sex = v_source.sex or v_to.sex not in ('male', 'female') or v_to.sex = v_source.sex
    or v_to.status not in ('submitted', 'reviewing', 'approved') or v_to.updated_at > p_planned_at
    or md5(v_to.sex || ':' || v_to.birth_year::text || ':' || coalesce(v_to.region, '')) is distinct from p_to_profile_key
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
    ) or exists (
      -- A fallback recipient can have an old impression, but it is not a
      -- base donor. A replaced donor cannot reopen its slot with a reissued
      -- profile ID. The canonical renderer applies one overlay per slot.
      select 1 from public.dating_1on1_single_candidate_swaps s
      left join public.dating_1on1_cards from_card on from_card.id = s.from_candidate_card_id
      where s.user_id = p_user_id and s.source_card_id = p_source_card_id and s.generation_key = p_generation_key
        and (s.to_candidate_user_id = v_from.user_id or from_card.user_id = v_from.user_id)
    ) then
    return jsonb_build_object('ok', false, 'code', 'stale_generation');
  end if;
  if exists (
      -- Earlier generations and prior impressions do not disqualify a
      -- fallback. Within this generation forbid reintroducing a removed
      -- donor or placing the same member in a second slot, across revisions.
      select 1 from public.dating_1on1_single_candidate_swaps s
      left join public.dating_1on1_cards from_card on from_card.id = s.from_candidate_card_id
      where s.user_id = p_user_id and s.source_card_id = p_source_card_id and s.generation_key = p_generation_key
        and (s.to_candidate_user_id = v_to.user_id or from_card.user_id = v_to.user_id)
    ) or exists (
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
      -- HMAC comparisons live in the trusted planner. Any block inserted
      -- by either participant after planning invalidates the request.
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

revoke all on function public.commit_dating_1on1_single_candidate_fallback_swap(uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,timestamptz,text,text,integer,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_dating_1on1_single_candidate_fallback_swap(uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,timestamptz,text,text,integer,timestamptz)
  to service_role;
commit;
notify pgrst, 'reload schema';
