-- Apply BEFORE deploying the checked-refresh endpoint. Additive and repeatable.
-- Existing refresh history/quotas are preserved. Does not touch matching,
-- contact disclosure, payments, profile content or phone verification.
begin;

-- Support refunds retain recommendation history and only release charged quota.
-- Client roles still cannot write this server-only table (existing RLS applies).
alter table public.dating_1on1_recommendation_refresh_events
  add column if not exists quota_refunded_at timestamptz;

-- Durable, account-scoped incident credits. No expiry and no reset on profile edits.
-- Evidence belongs to the grant, not to the short-lived recommendation seed log.
create table if not exists public.dating_1on1_refresh_compensations (
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_key text not null,
  granted_count integer not null check (granted_count between 1 and 20),
  used_count integer not null default 0 check (used_count >= 0 and used_count <= granted_count),
  granted_at timestamptz not null default now(),
  last_used_at timestamptz,
  evidence jsonb not null,
  primary key (user_id, campaign_key)
);
alter table public.dating_1on1_refresh_compensations enable row level security;
revoke all on public.dating_1on1_refresh_compensations from public, anon, authenticated;
grant select, insert, update on public.dating_1on1_refresh_compensations to service_role;
alter table public.dating_1on1_recommendation_refresh_events
  add column if not exists compensation_campaign text;

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
  v_bonus integer := 0;
  v_campaign text;
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
  -- Lock credits, not profiles: avoid adding a lock-order dependency to account deletion.
  -- Ordered account rows serialize bonus usage even across different source cards.
  perform 1 from public.dating_1on1_refresh_compensations b
    where b.user_id = p_user_id order by b.campaign_key for update;
  select coalesce(sum(b.granted_count - b.used_count), 0)::integer into v_bonus
    from public.dating_1on1_refresh_compensations b where b.user_id = p_user_id;

  select count(*)::integer, min(e.refreshed_at) into v_used, v_oldest
  from public.dating_1on1_recommendation_refresh_events e
  where e.card_id = p_card_id and e.refreshed_at > v_now - interval '24 hours'
    and e.quota_refunded_at is null;
  -- Count legacy usage without writing until the plan has been accepted.
  v_legacy := v_used = 0 and v_card.recommendation_refresh_used_at > v_now - interval '24 hours'
    and not exists (select 1 from public.dating_1on1_recommendation_refresh_events e
      where e.card_id = p_card_id and e.refreshed_at = v_card.recommendation_refresh_used_at
        and e.quota_refunded_at is not null);
  if v_legacy then v_used := 1; v_oldest := v_card.recommendation_refresh_used_at; end if;
  -- Plus expiry can reduce the limit below recent usage. The next free slot
  -- appears only when enough normal charges expire, not just the oldest one.
  if v_used > p_limit then
    select e.refreshed_at into v_oldest
      from public.dating_1on1_recommendation_refresh_events e
      where e.card_id = p_card_id and e.refreshed_at > v_now - interval '24 hours'
        and e.quota_refunded_at is null
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
  -- Validate subscription again under the transaction if the plan uses Plus quota.
  if p_limit = 2 and not exists (select 1 from public.dating_1on1_plus_subscriptions s
    where s.user_id = p_user_id and s.expires_at > v_now) then
    raise exception 'plus membership changed';
  end if;
  if v_legacy then
    insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
      values(p_card_id,p_user_id,v_card.recommendation_refresh_used_at);
  end if;
  -- Normal rolling quota is used first; incident credits remain until needed.
  if v_used >= p_limit then
    select b.campaign_key into v_campaign from public.dating_1on1_refresh_compensations b
      where b.user_id = p_user_id and b.used_count < b.granted_count
      order by b.granted_at, b.campaign_key limit 1;
    update public.dating_1on1_refresh_compensations b
      set used_count = b.used_count + 1, last_used_at = v_now
      where b.user_id = p_user_id and b.campaign_key = v_campaign and b.used_count < b.granted_count;
    if not found then raise exception 'compensation balance changed'; end if;
    v_bonus := v_bonus - 1;
  else
    v_used := v_used + 1;
    v_oldest := coalesce(v_oldest, p_refresh_at);
  end if;
  insert into public.dating_1on1_recommendation_refresh_events
    (card_id,user_id,refreshed_at,quota_refunded_at,compensation_campaign)
    values(p_card_id,p_user_id,p_refresh_at,case when v_campaign is not null then v_now else null end,v_campaign);
  update public.dating_1on1_cards set recommendation_refresh_used_at = p_refresh_at, updated_at = v_now where id = p_card_id;
  delete from public.dating_1on1_recommendation_refresh_events e
    where e.card_id = p_card_id and e.refreshed_at < v_now - interval '7 days';
  return query select true, 'consumed'::text, v_used, greatest(p_limit - v_used, 0) + v_bonus, p_refresh_at,
    case when v_used >= p_limit and v_bonus = 0 then v_oldest + interval '24 hours' else null end;
end;
$$;
revoke all on function public.consume_dating_1on1_recommendation_refresh_checked(uuid,uuid,integer,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.consume_dating_1on1_recommendation_refresh_checked(uuid,uuid,integer,timestamptz,timestamptz) to service_role;
commit;
notify pgrst, 'reload schema';
