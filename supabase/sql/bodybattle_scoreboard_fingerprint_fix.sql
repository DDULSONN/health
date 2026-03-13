-- 스코어보드 매터리얼라이즈드 뷰에서 viewer_fingerprint 제거 (개인정보 노출 방지)
-- 기존 뷰를 삭제하고 재생성합니다.

begin;

drop materialized view if exists public.bodybattle_scoreboard_all_mv cascade;

create materialized view public.bodybattle_scoreboard_all_mv as
select
  row_number() over (
    order by coalesce(vp.xp, 0) desc, coalesce(vp.total_votes, 0) desc, coalesce(vp.updated_at, vp.created_at) desc
  )::integer as rank_no,
  vp.user_id,
  -- viewer_fingerprint 제거: 익명 사용자 추적 정보 노출 방지
  coalesce(vp.level, 1)::integer as level,
  coalesce(vp.xp, 0)::integer as xp,
  coalesce(vp.total_votes, 0)::integer as total_votes,
  coalesce(vp.vote_streak_days, 0)::integer as vote_streak_days,
  vp.last_voted_at,
  coalesce(vp.updated_at, vp.created_at) as updated_at
from public.bodybattle_voter_profiles vp;

create unique index uq_bodybattle_scoreboard_all_mv_rank
  on public.bodybattle_scoreboard_all_mv (rank_no);

create index idx_bodybattle_scoreboard_all_mv_user
  on public.bodybattle_scoreboard_all_mv (user_id)
  where user_id is not null;

commit;

notify pgrst, 'reload schema';
