-- BodyBattle hardening bundle (re-runnable)
-- 1) anti-abuse constraints for reports
-- 2) scoreboard materialized view for faster reads
-- 3) helper refresh function + grants

begin;

create unique index if not exists uq_bodybattle_reports_entry_reporter
  on public.bodybattle_reports (entry_id, reporter_user_id)
  where reporter_user_id is not null;

create index if not exists idx_bodybattle_reports_reporter_created
  on public.bodybattle_reports (reporter_user_id, created_at desc)
  where reporter_user_id is not null;

create index if not exists idx_bodybattle_votes_season_created
  on public.bodybattle_votes (season_id, created_at desc);

create materialized view if not exists public.bodybattle_scoreboard_all_mv as
select
  row_number() over (
    order by coalesce(vp.xp, 0) desc, coalesce(vp.total_votes, 0) desc, coalesce(vp.updated_at, vp.created_at) desc
  )::integer as rank_no,
  vp.user_id,
  vp.viewer_fingerprint,
  coalesce(vp.level, 1)::integer as level,
  coalesce(vp.xp, 0)::integer as xp,
  coalesce(vp.total_votes, 0)::integer as total_votes,
  coalesce(vp.vote_streak_days, 0)::integer as vote_streak_days,
  vp.last_voted_at,
  coalesce(vp.updated_at, vp.created_at) as updated_at
from public.bodybattle_voter_profiles vp;

create unique index if not exists uq_bodybattle_scoreboard_all_mv_rank
  on public.bodybattle_scoreboard_all_mv (rank_no);

create index if not exists idx_bodybattle_scoreboard_all_mv_user
  on public.bodybattle_scoreboard_all_mv (user_id)
  where user_id is not null;

create or replace function public.refresh_bodybattle_scoreboard_mv()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view public.bodybattle_scoreboard_all_mv;
end;
$$;

grant execute on function public.refresh_bodybattle_scoreboard_mv() to service_role, authenticated;

commit;

notify pgrst, 'reload schema';

