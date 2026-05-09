-- Stable admin-controlled open-card pending queue order.

begin;

alter table public.dating_cards
  add column if not exists queue_priority_at timestamptz not null default now();

update public.dating_cards
set queue_priority_at = coalesce(published_at, created_at, now())
where queue_priority_at is null;

create index if not exists idx_dating_cards_pending_queue_priority
  on public.dating_cards (sex, status, queue_priority_at, created_at, id);

create or replace function public.admin_move_dating_card_queue_position(
  p_card_id uuid,
  p_target_position int
)
returns table (
  card_id uuid,
  sex text,
  old_position int,
  new_position int,
  total_pending int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card record;
  v_ordered_ids uuid[];
  v_new_ids uuid[];
  v_old_position int;
  v_target int;
  v_total int;
  v_index int;
  v_base timestamptz := timezone('utc', now());
begin
  select dc.id, dc.sex, dc.status
    into v_card
  from public.dating_cards dc
  where dc.id = p_card_id;

  if not found then
    raise exception 'CARD_NOT_FOUND';
  end if;

  if v_card.status <> 'pending' then
    raise exception 'CARD_NOT_PENDING';
  end if;

  select array_agg(dc.id order by dc.queue_priority_at asc, dc.created_at asc, dc.id asc)
    into v_ordered_ids
  from public.dating_cards dc
  where dc.sex = v_card.sex
    and dc.status = 'pending';

  v_total := coalesce(array_length(v_ordered_ids, 1), 0);
  if v_total = 0 then
    raise exception 'EMPTY_QUEUE';
  end if;

  select ordinality::int
    into v_old_position
  from unnest(v_ordered_ids) with ordinality as item(id, ordinality)
  where item.id = p_card_id;

  v_target := least(greatest(coalesce(p_target_position, v_total), 1), v_total);
  v_new_ids := array_remove(v_ordered_ids, p_card_id);

  if v_target <= 1 then
    v_new_ids := array[p_card_id] || v_new_ids;
  elsif v_target > coalesce(array_length(v_new_ids, 1), 0) then
    v_new_ids := v_new_ids || p_card_id;
  else
    v_new_ids := v_new_ids[1:v_target - 1] || p_card_id || v_new_ids[v_target:array_length(v_new_ids, 1)];
  end if;

  for v_index in 1..array_length(v_new_ids, 1) loop
    update public.dating_cards dc
    set queue_priority_at = v_base + make_interval(secs => v_index)
    where dc.id = v_new_ids[v_index];
  end loop;

  return query select p_card_id, v_card.sex, v_old_position, v_target, v_total;
end;
$$;

revoke all on function public.admin_move_dating_card_queue_position(uuid, int) from public;
grant execute on function public.admin_move_dating_card_queue_position(uuid, int) to service_role;

commit;

notify pgrst, 'reload schema';
