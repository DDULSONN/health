-- Additive rollout: install before the history-aware ranking deployment.
-- No quota resets, member changes, matches, contact details or payment changes.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create table if not exists public.dating_1on1_recommendation_page_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  refreshed_at timestamptz not null,
  main_candidate_ids uuid[] not null check (cardinality(main_candidate_ids) <= 10),
  extra_candidate_ids uuid[] not null check (cardinality(extra_candidate_ids) <= 3),
  primary key (user_id, refreshed_at)
);
alter table public.dating_1on1_recommendation_page_history enable row level security;
revoke all on public.dating_1on1_recommendation_page_history from public, anon, authenticated, service_role;
grant select on public.dating_1on1_recommendation_page_history to service_role;

create or replace function public.capture_dating_1on1_recommendation_page()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    insert into public.dating_1on1_recommendation_page_history(user_id,refreshed_at,main_candidate_ids,extra_candidate_ids)
      values(old.user_id,old.refreshed_at,old.main_candidate_ids,old.extra_candidate_ids)
      on conflict(user_id,refreshed_at) do nothing;
  end if;
  insert into public.dating_1on1_recommendation_page_history(user_id,refreshed_at,main_candidate_ids,extra_candidate_ids)
    values(new.user_id,new.refreshed_at,new.main_candidate_ids,new.extra_candidate_ids)
    on conflict(user_id,refreshed_at) do nothing;
  -- Indexed, member-local, max 64 small rows. No site-wide scheduled scans.
  delete from public.dating_1on1_recommendation_page_history h
    where h.user_id = new.user_id and (h.refreshed_at < clock_timestamp() - interval '30 days'
      or h.refreshed_at in (select older.refreshed_at from public.dating_1on1_recommendation_page_history older
        where older.user_id = new.user_id order by older.refreshed_at desc offset 64));
  return new;
end;
$$;
revoke all on function public.capture_dating_1on1_recommendation_page() from public, anon, authenticated;
drop trigger if exists capture_dating_1on1_recommendation_page on public.dating_1on1_recommendation_pages;
create trigger capture_dating_1on1_recommendation_page
  after insert or update on public.dating_1on1_recommendation_pages
  for each row execute function public.capture_dating_1on1_recommendation_page();
-- The trigger is inside the EXISTING atomic page/quota transaction. A failed
-- history write rolls back the page, seed and quota together, not just the log.
commit;
notify pgrst, 'reload schema';
