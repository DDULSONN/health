-- Fix ambiguous refreshed_at references in the 1:1 recommendation refresh RPC.
-- Safe to run repeatedly after dating_1on1_plus.sql.

begin;

create or replace function public.consume_dating_1on1_recommendation_refresh(
  p_card_id uuid,
  p_user_id uuid,
  p_limit integer
)
returns table (
  allowed boolean,
  used_count integer,
  remaining_count integer,
  refreshed_at timestamptz,
  next_refresh_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz := v_now - interval '24 hours';
  v_card public.dating_1on1_cards%rowtype;
  v_used_count integer := 0;
  v_oldest_refresh timestamptz;
begin
  if p_card_id is null or p_user_id is null then
    raise exception 'card_id and user_id are required';
  end if;
  if p_limit < 1 or p_limit > 10 then
    raise exception 'refresh limit must be between 1 and 10';
  end if;

  select * into v_card
  from public.dating_1on1_cards as source_card
  where source_card.id = p_card_id
  for update;

  if v_card.id is null then
    raise exception '1:1 card not found';
  end if;
  if v_card.user_id <> p_user_id then
    raise exception 'only the card owner can refresh recommendations';
  end if;
  if v_card.status not in ('submitted', 'reviewing', 'approved') then
    raise exception '1:1 card is not active';
  end if;

  delete from public.dating_1on1_recommendation_refresh_events as refresh_event
  where refresh_event.card_id = p_card_id
    and refresh_event.refreshed_at < v_now - interval '7 days';

  select count(*)::integer, min(refresh_event.refreshed_at)
  into v_used_count, v_oldest_refresh
  from public.dating_1on1_recommendation_refresh_events as refresh_event
  where refresh_event.card_id = p_card_id
    and refresh_event.refreshed_at > v_window_start;

  if v_used_count = 0
    and v_card.recommendation_refresh_used_at is not null
    and v_card.recommendation_refresh_used_at > v_window_start then
    insert into public.dating_1on1_recommendation_refresh_events (card_id, user_id, refreshed_at)
    values (p_card_id, p_user_id, v_card.recommendation_refresh_used_at);
    v_used_count := 1;
    v_oldest_refresh := v_card.recommendation_refresh_used_at;
  end if;

  if v_used_count >= p_limit then
    return query select false, v_used_count, 0, null::timestamptz, v_oldest_refresh + interval '24 hours';
    return;
  end if;

  insert into public.dating_1on1_recommendation_refresh_events (card_id, user_id, refreshed_at)
  values (p_card_id, p_user_id, v_now);

  update public.dating_1on1_cards as source_card
  set recommendation_refresh_used_at = v_now,
      updated_at = v_now
  where source_card.id = p_card_id;

  v_used_count := v_used_count + 1;
  if v_oldest_refresh is null then
    v_oldest_refresh := v_now;
  end if;

  return query select
    true,
    v_used_count,
    greatest(p_limit - v_used_count, 0),
    v_now,
    case when v_used_count >= p_limit then v_oldest_refresh + interval '24 hours' else null end;
end;
$$;

revoke all on function public.consume_dating_1on1_recommendation_refresh(uuid, uuid, integer) from public;
revoke all on function public.consume_dating_1on1_recommendation_refresh(uuid, uuid, integer) from anon;
revoke all on function public.consume_dating_1on1_recommendation_refresh(uuid, uuid, integer) from authenticated;
grant execute on function public.consume_dating_1on1_recommendation_refresh(uuid, uuid, integer) to service_role;

commit;

notify pgrst, 'reload schema';
