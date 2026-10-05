-- Apply BEFORE deploying the checked-refresh endpoint. Additive and repeatable.
-- Existing refresh history/quotas are preserved. Does not touch matching,
-- contact disclosure, payments, profile content or phone verification.
begin;

create or replace function public.consume_dating_1on1_recommendation_refresh_checked(
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
begin
  if p_card_id is null or p_user_id is null or p_limit is null or p_limit not in (1, 2)
    or p_refresh_at is null or p_refresh_at > v_now + interval '5 seconds'
    or p_refresh_at < v_now - interval '2 minutes' then
    raise exception 'invalid or expired refresh plan';
  end if;
  -- Same row lock as the legacy function. Concurrent old/new clients serialize.
  select * into v_card from public.dating_1on1_cards c where c.id = p_card_id for update;
  if v_card.id is null or v_card.user_id is distinct from p_user_id
    or v_card.status not in ('submitted', 'reviewing', 'approved') then
    raise exception 'source card is not eligible';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_user_id and coalesce(p.is_banned, false) = false) then
    raise exception 'account is not eligible';
  end if;

  select count(*)::integer, min(e.refreshed_at) into v_used, v_oldest
  from public.dating_1on1_recommendation_refresh_events e
  where e.card_id = p_card_id and e.refreshed_at > v_now - interval '24 hours';
  -- Count legacy usage without writing until the plan has been accepted.
  v_legacy := v_used = 0 and v_card.recommendation_refresh_used_at > v_now - interval '24 hours';
  if v_legacy then v_used := 1; v_oldest := v_card.recommendation_refresh_used_at; end if;
  if v_card.recommendation_refresh_used_at is distinct from p_expected_refresh_at
    or p_refresh_at <= v_card.recommendation_refresh_used_at then
    return query select false, 'stale'::text, v_used, greatest(p_limit - v_used, 0), null::timestamptz,
      case when v_used >= p_limit then v_oldest + interval '24 hours' else null end;
    return;
  end if;
  if v_used >= p_limit then
    return query select false, 'limit'::text, v_used, 0, null::timestamptz, v_oldest + interval '24 hours';
    return;
  end if;
  -- Validate subscription again under the transaction if the plan uses Plus quota.
  if p_limit = 2 and not exists (select 1 from public.dating_1on1_plus_subscriptions s
    where s.user_id = p_user_id and s.expires_at > v_now) then
    raise exception 'plus membership changed';
  end if;
  if v_legacy then
    insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
      values(p_card_id,p_user_id,v_card.recommendation_refresh_used_at);
  end if;
  insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
    values(p_card_id,p_user_id,p_refresh_at);
  update public.dating_1on1_cards set recommendation_refresh_used_at = p_refresh_at, updated_at = v_now where id = p_card_id;
  v_used := v_used + 1;
  v_oldest := coalesce(v_oldest, p_refresh_at);
  delete from public.dating_1on1_recommendation_refresh_events e
    where e.card_id = p_card_id and e.refreshed_at < v_now - interval '7 days';
  return query select true, 'consumed'::text, v_used, greatest(p_limit - v_used, 0), p_refresh_at,
    case when v_used >= p_limit then v_oldest + interval '24 hours' else null end;
end;
$$;
revoke all on function public.consume_dating_1on1_recommendation_refresh_checked(uuid,uuid,integer,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.consume_dating_1on1_recommendation_refresh_checked(uuid,uuid,integer,timestamptz,timestamptz) to service_role;
commit;
notify pgrst, 'reload schema';
