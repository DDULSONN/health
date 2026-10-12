-- Additive. No quota, payment, match, phone or profile changes.
begin;
create table if not exists public.dating_1on1_candidate_impressions (
  viewer_user_id uuid not null references auth.users(id) on delete cascade,
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  seen_day date not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  primary key(viewer_user_id, candidate_user_id, seen_day),
  check(viewer_user_id <> candidate_user_id)
);
create index if not exists dating_1on1_impressions_viewer_time_idx
  on public.dating_1on1_candidate_impressions(viewer_user_id,first_seen_at,candidate_user_id);
alter table public.dating_1on1_candidate_impressions enable row level security;
revoke all on public.dating_1on1_candidate_impressions from public, anon, authenticated;
grant select, insert, delete on public.dating_1on1_candidate_impressions to service_role;

create or replace function public.record_dating_1on1_candidate_impressions(
  p_user_id uuid, p_source_card_id uuid, p_candidate_card_ids uuid[]
) returns void language plpgsql security definer set search_path=public as $$
declare v_now timestamptz:=clock_timestamp(); v_sex text;
begin
  if p_user_id is null or p_source_card_id is null or cardinality(p_candidate_card_ids) is null
    or cardinality(p_candidate_card_ids) not between 1 and 32 then raise exception 'invalid acknowledgement'; end if;
  select c.sex into v_sex from public.dating_1on1_cards c
    join public.profiles p on p.user_id=c.user_id
    where c.id=p_source_card_id and c.user_id=p_user_id and c.status in ('submitted','reviewing','approved')
      and coalesce(p.is_banned,false)=false;
  if v_sex is null then raise exception 'source unavailable'; end if;
  -- A daily unique acknowledgement preserves the first timestamp on retries.
  -- Later observations cannot rewrite the history used to create an earlier page.
  insert into public.dating_1on1_candidate_impressions(viewer_user_id,candidate_user_id,seen_day,first_seen_at)
    select distinct p_user_id,c.user_id,(v_now at time zone 'Asia/Seoul')::date,v_now
    from public.dating_1on1_cards c join public.profiles p on p.user_id=c.user_id
    where c.id=any(p_candidate_card_ids) and c.user_id<>p_user_id and c.sex<>v_sex
      and c.status in ('submitted','reviewing','approved') and coalesce(p.is_banned,false)=false
    on conflict(viewer_user_id,candidate_user_id,seen_day) do nothing;
  -- Indexed, viewer-local cleanup only; no hourly site-wide job.
  delete from public.dating_1on1_candidate_impressions
    where viewer_user_id=p_user_id and first_seen_at<v_now-interval '38 days';
end;
$$;
revoke all on function public.record_dating_1on1_candidate_impressions(uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.record_dating_1on1_candidate_impressions(uuid,uuid,uuid[]) to service_role;
commit;
notify pgrst,'reload schema';
