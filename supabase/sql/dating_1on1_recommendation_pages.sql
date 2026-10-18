-- Apply after dating_1on1_checked_refresh.sql and dating_1on1_repeat_rotation.sql.
-- Additive, repeatable. No backfill, quota grant, match, payment or contact changes.
begin;
create table if not exists public.dating_1on1_recommendation_pages (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source_card_id uuid not null references public.dating_1on1_cards(id) on delete cascade,
  refreshed_at timestamptz not null,
  source_profile_key text not null,
  main_candidate_ids uuid[] not null,
  extra_candidate_ids uuid[] not null,
  constraint recommendation_page_main_bound check (cardinality(main_candidate_ids) <= 10),
  constraint recommendation_page_extra_bound check (cardinality(extra_candidate_ids) <= 3)
);
alter table public.dating_1on1_recommendation_pages enable row level security;
revoke all on public.dating_1on1_recommendation_pages from public, anon, authenticated;
grant select, insert, update, delete on public.dating_1on1_recommendation_pages to service_role;

create or replace function public.commit_dating_1on1_recommendation_page(
  p_card_id uuid, p_user_id uuid, p_limit integer,
  p_expected_refresh_at timestamptz, p_refresh_at timestamptz,
  p_main_candidate_ids uuid[], p_extra_candidate_ids uuid[], p_repeat_only boolean, p_source_profile_key text
)
returns table(allowed boolean, reason text, used_count integer, remaining_count integer,
  refreshed_at timestamptz, next_refresh_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_result record;
  v_ids uuid[];
  v_source public.dating_1on1_cards%rowtype;
begin
  if p_main_candidate_ids is null or p_extra_candidate_ids is null or p_repeat_only is null
    or cardinality(p_main_candidate_ids) > 10 or cardinality(p_extra_candidate_ids) > 3
    or coalesce(array_ndims(p_main_candidate_ids), 1) <> 1 or coalesce(array_ndims(p_extra_candidate_ids), 1) <> 1 then
    raise exception 'invalid recommendation page';
  end if;
  v_ids := p_main_candidate_ids || p_extra_candidate_ids;
  if cardinality(v_ids) = 0 or p_card_id = any(v_ids)
    or cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) id) then
    raise exception 'invalid recommendation identities';
  end if;
  -- Reuse the existing source/bonus locks, stale-seed CAS, Plus validation and
  -- quota accounting. A later snapshot failure rolls the ENTIRE transaction back.
  if p_repeat_only then
    select * into v_result from public.rotate_dating_1on1_recommendations_without_charge(
      p_card_id, p_user_id, p_limit, p_expected_refresh_at, p_refresh_at);
  else
    select * into v_result from public.consume_dating_1on1_recommendation_refresh_checked(
      p_card_id, p_user_id, p_limit, p_expected_refresh_at, p_refresh_at);
  end if;
  if v_result.allowed then
    select * into v_source from public.dating_1on1_cards where id = p_card_id;
    if md5(v_source.sex || ':' || v_source.birth_year::text || ':' || coalesce(v_source.region, '')) is distinct from p_source_profile_key then
      raise exception 'source profile settings changed';
    end if;
    -- Catch withdrawals, bans and gender changes between planning and commit.
    -- The GET/selection services still apply all pair and phone-block safeguards.
    if cardinality(v_ids) <> (
      select count(distinct c.user_id) from public.dating_1on1_cards c
      join public.profiles p on p.user_id = c.user_id
      where c.id = any(v_ids) and c.user_id <> p_user_id and c.sex <> v_source.sex
        and c.status in ('submitted', 'reviewing', 'approved') and coalesce(p.is_banned, false) = false
    ) then
      raise exception 'recommendation identities changed';
    end if;
    insert into public.dating_1on1_recommendation_pages(user_id, source_card_id, refreshed_at, source_profile_key, main_candidate_ids, extra_candidate_ids)
      values(p_user_id, p_card_id, v_result.refreshed_at, p_source_profile_key, p_main_candidate_ids, p_extra_candidate_ids)
      on conflict (user_id) do update set source_card_id = excluded.source_card_id,
        refreshed_at = excluded.refreshed_at, source_profile_key = excluded.source_profile_key, main_candidate_ids = excluded.main_candidate_ids,
        extra_candidate_ids = excluded.extra_candidate_ids;
  end if;
  return query select v_result.allowed, v_result.reason, v_result.used_count, v_result.remaining_count,
    v_result.refreshed_at, v_result.next_refresh_at;
end;
$$;
revoke all on function public.commit_dating_1on1_recommendation_page(uuid,uuid,integer,timestamptz,timestamptz,uuid[],uuid[],boolean,text)
  from public, anon, authenticated;
grant execute on function public.commit_dating_1on1_recommendation_page(uuid,uuid,integer,timestamptz,timestamptz,uuid[],uuid[],boolean,text)
  to service_role;
commit;
notify pgrst, 'reload schema';
