-- Install after dating_1on1_checked_refresh.sql, BEFORE the new endpoint.
-- Additive: no member, payment, matching, phone or existing quota data is reset.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter table public.dating_1on1_recommendation_refresh_events
  add column if not exists rotation_only boolean not null default false;

create or replace function public.rotate_dating_1on1_recommendations_without_charge(
  p_card_id uuid, p_user_id uuid, p_limit integer,
  p_expected_refresh_at timestamptz, p_refresh_at timestamptz
)
returns table (allowed boolean, reason text, used_count integer, remaining_count integer,
  refreshed_at timestamptz, next_refresh_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_card public.dating_1on1_cards%rowtype;
  v_used integer := 0;
  v_oldest timestamptz;
  v_legacy boolean := false;
  v_bonus integer := 0;
  v_last_rotation timestamptz;
begin
  if p_card_id is null or p_user_id is null or p_limit is null or p_limit not in (1, 2)
    or p_refresh_at is null or p_refresh_at > v_now + interval '5 seconds'
    or p_refresh_at < v_now - interval '2 minutes' then
    raise exception 'invalid or expired rotation plan';
  end if;
  -- Same card/credit lock order as the paid-quota function, never a second write
  -- to refund a consumed use. The server, not the browser, selects this RPC.
  select * into v_card from public.dating_1on1_cards c where c.id = p_card_id for update;
  if v_card.id is null or v_card.user_id is distinct from p_user_id
    or v_card.status not in ('submitted', 'reviewing', 'approved') then
    raise exception 'source card is not eligible';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_user_id and coalesce(p.is_banned, false) = false) then
    raise exception 'account is not eligible';
  end if;
  perform 1 from public.dating_1on1_refresh_compensations b
    where b.user_id = p_user_id order by b.campaign_key for update;
  select coalesce(sum(b.granted_count - b.used_count), 0)::integer into v_bonus
    from public.dating_1on1_refresh_compensations b where b.user_id = p_user_id;
  select count(*)::integer, min(e.refreshed_at) into v_used, v_oldest
    from public.dating_1on1_recommendation_refresh_events e
    where e.card_id = p_card_id and e.refreshed_at > v_now - interval '24 hours' and e.quota_refunded_at is null;
  v_legacy := v_used = 0 and v_card.recommendation_refresh_used_at > v_now - interval '24 hours'
    and not exists (select 1 from public.dating_1on1_recommendation_refresh_events e
      where e.card_id = p_card_id and e.refreshed_at = v_card.recommendation_refresh_used_at and e.quota_refunded_at is not null);
  if v_legacy then v_used := 1; v_oldest := v_card.recommendation_refresh_used_at; end if;
  if v_used > p_limit then
    select e.refreshed_at into v_oldest from public.dating_1on1_recommendation_refresh_events e
      where e.card_id = p_card_id and e.refreshed_at > v_now - interval '24 hours' and e.quota_refunded_at is null
      order by e.refreshed_at offset (v_used - p_limit) limit 1;
  end if;
  if v_card.recommendation_refresh_used_at is distinct from p_expected_refresh_at
    or p_refresh_at <= v_card.recommendation_refresh_used_at then
    return query select false, 'stale'::text, v_used, greatest(p_limit - v_used, 0) + v_bonus, null::timestamptz,
      case when v_used >= p_limit and v_bonus = 0 then v_oldest + interval '24 hours' else null end;
    return;
  end if;
  if v_used >= p_limit and v_bonus = 0 then
    return query select false, 'limit'::text, v_used, 0, null::timestamptz, v_oldest + interval '24 hours';
    return;
  end if;
  if p_limit = 2 and not exists (select 1 from public.dating_1on1_plus_subscriptions s
    where s.user_id = p_user_id and s.expires_at > v_now) then
    raise exception 'plus membership changed';
  end if;
  select max(e.refreshed_at) into v_last_rotation from public.dating_1on1_recommendation_refresh_events e
    where e.card_id = p_card_id and e.rotation_only;
  if v_last_rotation > v_now - interval '30 seconds' then
    return query select false, 'cooldown'::text, v_used, greatest(p_limit - v_used, 0) + v_bonus,
      null::timestamptz, null::timestamptz;
    return;
  end if;
  -- Keep a legacy charge before changing the seed. Otherwise a free rotation
  -- would erase its quota footprint and grant an extra normal refresh.
  if v_legacy then
    insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
      values(p_card_id,p_user_id,v_card.recommendation_refresh_used_at);
  end if;
  insert into public.dating_1on1_recommendation_refresh_events
    (card_id,user_id,refreshed_at,quota_refunded_at,rotation_only)
    values(p_card_id,p_user_id,p_refresh_at,v_now,true);
  update public.dating_1on1_cards set recommendation_refresh_used_at = p_refresh_at, updated_at = v_now where id = p_card_id;
  delete from public.dating_1on1_recommendation_refresh_events e
    where e.card_id = p_card_id and e.refreshed_at < v_now - interval '7 days';
  -- Replay uses only the newest 32 seeds. Bound free browsing history without
  -- deleting charged/refunded/compensation records or changing the quota.
  delete from public.dating_1on1_recommendation_refresh_events e
    where e.card_id = p_card_id and e.rotation_only and e.refreshed_at not in (
      select r.refreshed_at from public.dating_1on1_recommendation_refresh_events r
        where r.card_id = p_card_id and r.rotation_only order by r.refreshed_at desc limit 64
    );
  return query select true, 'rotated'::text, v_used, greatest(p_limit - v_used, 0) + v_bonus, p_refresh_at,
    case when v_used >= p_limit and v_bonus = 0 then v_oldest + interval '24 hours' else null end;
end;
$$;
revoke all on function public.rotate_dating_1on1_recommendations_without_charge(uuid,uuid,integer,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.rotate_dating_1on1_recommendations_without_charge(uuid,uuid,integer,timestamptz,timestamptz) to service_role;
commit;
notify pgrst, 'reload schema';
