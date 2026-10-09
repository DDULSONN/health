-- Optional candidate expansion. Does not change matching, refresh, billing or contact tables.
begin;
create table if not exists public.dating_1on1_expansion_batches (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_key date not null,
  source_card_id uuid not null,
  candidate_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, day_key),
  check (cardinality(candidate_ids) <= 3 and array_position(candidate_ids, null) is null)
);
alter table public.dating_1on1_expansion_batches enable row level security;
revoke all on public.dating_1on1_expansion_batches from public, anon, authenticated, service_role;
grant select, insert, delete on public.dating_1on1_expansion_batches to service_role;

create or replace function public.claim_dating_1on1_expansion_batch(
  p_user_id uuid, p_source_card_id uuid, p_day_key date, p_candidate_ids uuid[]
) returns setof public.dating_1on1_expansion_batches
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_user_id is null or p_source_card_id is null or p_day_key is null
     or p_day_key <> (now() at time zone 'Asia/Seoul')::date
     or p_candidate_ids is null or cardinality(p_candidate_ids) > 3
     or array_position(p_candidate_ids, null) is not null
     or cardinality(p_candidate_ids) <> (select count(distinct id) from unnest(p_candidate_ids) id)
     or p_source_card_id = any(p_candidate_ids) then
    raise exception 'Invalid expansion batch';
  end if;
  if not exists (select 1 from public.dating_1on1_cards c where c.id = p_source_card_id
      and c.user_id = p_user_id and c.status in ('submitted', 'reviewing', 'approved')) then
    raise exception 'Inactive expansion source';
  end if;
  -- A competing request returns the winner. Empty batches are claimed too.
  insert into public.dating_1on1_expansion_batches(user_id, day_key, source_card_id, candidate_ids)
    values(p_user_id, p_day_key, p_source_card_id, p_candidate_ids)
    on conflict (user_id, day_key) do nothing;
  return query select b.* from public.dating_1on1_expansion_batches b
    where b.user_id = p_user_id and b.day_key = p_day_key;
end;
$$;
revoke all on function public.claim_dating_1on1_expansion_batch(uuid, uuid, date, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_dating_1on1_expansion_batch(uuid, uuid, date, uuid[]) to service_role;
commit;
