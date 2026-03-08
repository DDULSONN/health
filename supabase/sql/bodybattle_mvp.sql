-- BodyBattle MVP schema
-- Run this SQL in Supabase SQL editor.

create table if not exists public.bodybattle_seasons (
  id uuid primary key default gen_random_uuid(),
  week_id text not null unique,
  theme_slug text not null,
  theme_label text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'active' check (status in ('draft', 'active', 'closed')),
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bodybattle_seasons_status_dates
  on public.bodybattle_seasons (status, start_at desc, end_at desc);

create table if not exists public.bodybattle_entries (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.bodybattle_seasons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  gender text not null check (gender in ('male', 'female')),
  intro_text text null,
  champion_comment text null,
  image_urls text[] not null default '{}',
  rating numeric(10,2) not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  exposures integer not null default 0,
  votes_received integer not null default 0,
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  status text not null default 'inactive' check (status in ('active', 'inactive', 'hidden')),
  report_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, user_id)
);

alter table public.bodybattle_entries add column if not exists current_streak integer not null default 0;
alter table public.bodybattle_entries add column if not exists best_streak integer not null default 0;

create index if not exists idx_bodybattle_entries_season_rating
  on public.bodybattle_entries (season_id, status, moderation_status, rating desc, votes_received desc);

create index if not exists idx_bodybattle_entries_season_gender
  on public.bodybattle_entries (season_id, gender, status, moderation_status);

create table if not exists public.bodybattle_votes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.bodybattle_seasons(id) on delete cascade,
  left_entry_id uuid not null references public.bodybattle_entries(id) on delete cascade,
  right_entry_id uuid not null references public.bodybattle_entries(id) on delete cascade,
  winner_side text not null check (winner_side in ('left', 'right', 'draw')),
  matchup_key text not null,
  voter_user_id uuid null references auth.users(id) on delete set null,
  viewer_fingerprint text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bodybattle_votes_season_matchup
  on public.bodybattle_votes (season_id, matchup_key, created_at desc);

create unique index if not exists uq_bodybattle_votes_user_matchup
  on public.bodybattle_votes (season_id, matchup_key, voter_user_id)
  where voter_user_id is not null;

create unique index if not exists uq_bodybattle_votes_fingerprint_matchup
  on public.bodybattle_votes (season_id, matchup_key, viewer_fingerprint)
  where viewer_fingerprint is not null;

create table if not exists public.bodybattle_reports (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.bodybattle_seasons(id) on delete cascade,
  entry_id uuid not null references public.bodybattle_entries(id) on delete cascade,
  reporter_user_id uuid null references auth.users(id) on delete set null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_bodybattle_reports_entry_status
  on public.bodybattle_reports (entry_id, status, created_at desc);

create table if not exists public.bodybattle_season_results (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null unique references public.bodybattle_seasons(id) on delete cascade,
  champion_entry_id uuid null references public.bodybattle_entries(id) on delete set null,
  top10 jsonb not null default '[]'::jsonb,
  finalized_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.bodybattle_hall_of_fame (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null unique references public.bodybattle_seasons(id) on delete cascade,
  week_id text not null,
  theme_slug text not null,
  theme_label text not null,
  champion_entry_id uuid null references public.bodybattle_entries(id) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  nickname text null,
  image_url text null,
  rating numeric(10,2) not null default 0,
  votes_received integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  champion_comment text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bodybattle_hof_week
  on public.bodybattle_hall_of_fame (week_id desc);

create table if not exists public.bodybattle_voter_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
  viewer_fingerprint text null,
  xp integer not null default 0,
  level integer not null default 1,
  total_votes integer not null default 0,
  daily_votes integer not null default 0,
  vote_streak_days integer not null default 0,
  last_voted_date date null,
  last_voted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bodybattle_voter_profiles_identity_chk check (
    (user_id is not null) or (viewer_fingerprint is not null)
  )
);

create unique index if not exists uq_bodybattle_voter_profiles_user
  on public.bodybattle_voter_profiles (user_id)
  where user_id is not null;

create unique index if not exists uq_bodybattle_voter_profiles_viewer
  on public.bodybattle_voter_profiles (viewer_fingerprint)
  where viewer_fingerprint is not null;

create table if not exists public.bodybattle_entry_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.bodybattle_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bodybattle_entry_comments_entry_created
  on public.bodybattle_entry_comments (entry_id, created_at desc);

create index if not exists idx_bodybattle_entry_comments_user_created
  on public.bodybattle_entry_comments (user_id, created_at desc);

create table if not exists public.bodybattle_reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_code text not null,
  reward_type text not null,
  reward_amount integer not null default 0,
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, reward_code)
);

create index if not exists idx_bodybattle_reward_claims_user
  on public.bodybattle_reward_claims (user_id, claimed_at desc);

create table if not exists public.bodybattle_admin_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  status text not null default 'success',
  requested_by_user_id uuid null references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_bodybattle_admin_runs_created
  on public.bodybattle_admin_runs (created_at desc);

create or replace function public.bodybattle_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_bodybattle_seasons_updated_at on public.bodybattle_seasons;
create trigger trg_bodybattle_seasons_updated_at
before update on public.bodybattle_seasons
for each row execute function public.bodybattle_set_updated_at();

drop trigger if exists trg_bodybattle_entries_updated_at on public.bodybattle_entries;
create trigger trg_bodybattle_entries_updated_at
before update on public.bodybattle_entries
for each row execute function public.bodybattle_set_updated_at();

drop trigger if exists trg_bodybattle_voter_profiles_updated_at on public.bodybattle_voter_profiles;
create trigger trg_bodybattle_voter_profiles_updated_at
before update on public.bodybattle_voter_profiles
for each row execute function public.bodybattle_set_updated_at();

alter table public.bodybattle_seasons enable row level security;
alter table public.bodybattle_entries enable row level security;
alter table public.bodybattle_votes enable row level security;
alter table public.bodybattle_reports enable row level security;
alter table public.bodybattle_season_results enable row level security;
alter table public.bodybattle_hall_of_fame enable row level security;
alter table public.bodybattle_entry_comments enable row level security;
alter table public.bodybattle_voter_profiles enable row level security;
alter table public.bodybattle_reward_claims enable row level security;

drop policy if exists "bodybattle_seasons_select_all" on public.bodybattle_seasons;
create policy "bodybattle_seasons_select_all"
  on public.bodybattle_seasons
  for select
  to anon, authenticated
  using (true);

drop policy if exists "bodybattle_entries_select_public" on public.bodybattle_entries;
create policy "bodybattle_entries_select_public"
  on public.bodybattle_entries
  for select
  to anon, authenticated
  using (moderation_status = 'approved');

drop policy if exists "bodybattle_entries_insert_own" on public.bodybattle_entries;
create policy "bodybattle_entries_insert_own"
  on public.bodybattle_entries
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bodybattle_entries_update_own_pending" on public.bodybattle_entries;
create policy "bodybattle_entries_update_own_pending"
  on public.bodybattle_entries
  for update
  to authenticated
  using (auth.uid() = user_id and moderation_status = 'pending')
  with check (auth.uid() = user_id and moderation_status = 'pending');

drop policy if exists "bodybattle_votes_insert_authenticated" on public.bodybattle_votes;
create policy "bodybattle_votes_insert_authenticated"
  on public.bodybattle_votes
  for insert
  to authenticated
  with check (voter_user_id = auth.uid());

drop policy if exists "bodybattle_votes_select_all" on public.bodybattle_votes;
create policy "bodybattle_votes_select_all"
  on public.bodybattle_votes
  for select
  to anon, authenticated
  using (true);

drop policy if exists "bodybattle_reports_insert_authenticated" on public.bodybattle_reports;
create policy "bodybattle_reports_insert_authenticated"
  on public.bodybattle_reports
  for insert
  to authenticated
  with check (reporter_user_id = auth.uid());

drop policy if exists "bodybattle_hof_select_all" on public.bodybattle_hall_of_fame;
create policy "bodybattle_hof_select_all"
  on public.bodybattle_hall_of_fame
  for select
  to anon, authenticated
  using (true);

drop policy if exists "bodybattle_results_select_all" on public.bodybattle_season_results;
create policy "bodybattle_results_select_all"
  on public.bodybattle_season_results
  for select
  to anon, authenticated
  using (true);

drop policy if exists "bodybattle_entry_comments_select_all" on public.bodybattle_entry_comments;
create policy "bodybattle_entry_comments_select_all"
  on public.bodybattle_entry_comments
  for select
  to anon, authenticated
  using (true);

drop policy if exists "bodybattle_entry_comments_insert_own" on public.bodybattle_entry_comments;
create policy "bodybattle_entry_comments_insert_own"
  on public.bodybattle_entry_comments
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bodybattle_voter_profiles_select_own" on public.bodybattle_voter_profiles;
create policy "bodybattle_voter_profiles_select_own"
  on public.bodybattle_voter_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bodybattle_reward_claims_select_own" on public.bodybattle_reward_claims;
create policy "bodybattle_reward_claims_select_own"
  on public.bodybattle_reward_claims
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.increment_bodybattle_exposures_safe(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bodybattle_entries
  set exposures = greatest(0, coalesce(exposures, 0)) + 1
  where id = p_entry_id;
end;
$$;

grant execute on function public.increment_bodybattle_exposures_safe(uuid) to anon, authenticated, service_role;

drop function if exists public.bodybattle_cast_vote(uuid, uuid, uuid, text, text, uuid, text);
create or replace function public.bodybattle_cast_vote(
  p_season_id uuid,
  p_left_entry_id uuid,
  p_right_entry_id uuid,
  p_winner_side text,
  p_matchup_key text,
  p_voter_user_id uuid default null,
  p_viewer_fingerprint text default null
)
returns table (
  left_entry_id uuid,
  right_entry_id uuid,
  winner_side text,
  left_rating numeric,
  right_rating numeric,
  left_wins integer,
  left_losses integer,
  left_draws integer,
  right_wins integer,
  right_losses integer,
  right_draws integer,
  left_votes_received integer,
  right_votes_received integer,
  matchup_vote_count bigint,
  left_current_streak integer,
  right_current_streak integer,
  left_best_streak integer,
  right_best_streak integer,
  voter_total_votes integer,
  voter_level integer,
  voter_xp integer,
  voter_vote_streak_days integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season public.bodybattle_seasons%rowtype;
  v_left public.bodybattle_entries%rowtype;
  v_right public.bodybattle_entries%rowtype;
  v_left_expected numeric;
  v_right_expected numeric;
  v_left_score numeric;
  v_right_score numeric;
  v_left_new_rating numeric;
  v_right_new_rating numeric;
  v_matchup_votes bigint;
  v_left_next_current_streak integer;
  v_right_next_current_streak integer;
  v_left_next_best_streak integer;
  v_right_next_best_streak integer;
  v_today_kst date;
  v_profile public.bodybattle_voter_profiles%rowtype;
  v_next_daily_votes integer;
  v_next_vote_streak_days integer;
  v_next_total_votes integer;
  v_next_xp integer;
  v_next_level integer;
begin
  select *
  into v_season
  from public.bodybattle_seasons
  where id = p_season_id
  for update;

  if not found then
    raise exception 'SEASON_NOT_FOUND';
  end if;

  if v_season.status <> 'active' or v_season.start_at > now() or v_season.end_at <= now() then
    raise exception 'SEASON_NOT_ACTIVE';
  end if;

  if p_left_entry_id = p_right_entry_id then
    raise exception 'SAME_ENTRY_NOT_ALLOWED';
  end if;

  if p_matchup_key <> (case when p_left_entry_id::text < p_right_entry_id::text then p_left_entry_id::text || ':' || p_right_entry_id::text else p_right_entry_id::text || ':' || p_left_entry_id::text end) then
    raise exception 'INVALID_MATCHUP_KEY';
  end if;

  if p_winner_side not in ('left', 'right', 'draw') then
    raise exception 'INVALID_WINNER_SIDE';
  end if;

  if p_voter_user_id is null and (p_viewer_fingerprint is null or length(trim(p_viewer_fingerprint)) = 0) then
    raise exception 'VOTER_REQUIRED';
  end if;

  select *
  into v_left
  from public.bodybattle_entries
  where id = p_left_entry_id and season_id = p_season_id
  for update;

  if not found then
    raise exception 'LEFT_ENTRY_NOT_FOUND';
  end if;

  select *
  into v_right
  from public.bodybattle_entries
  where id = p_right_entry_id and season_id = p_season_id
  for update;

  if not found then
    raise exception 'RIGHT_ENTRY_NOT_FOUND';
  end if;

  if v_left.moderation_status <> 'approved' or v_right.moderation_status <> 'approved'
     or v_left.status <> 'active' or v_right.status <> 'active' then
    raise exception 'ENTRY_NOT_VOTABLE';
  end if;

  if v_left.gender <> v_right.gender then
    raise exception 'CROSS_GENDER_MATCH_NOT_ALLOWED';
  end if;

  if p_voter_user_id is not null and (v_left.user_id = p_voter_user_id or v_right.user_id = p_voter_user_id) then
    raise exception 'SELF_VOTE_NOT_ALLOWED';
  end if;

  if p_voter_user_id is not null then
    if exists (
      select 1
      from public.bodybattle_votes
      where season_id = p_season_id
        and matchup_key = p_matchup_key
        and voter_user_id = p_voter_user_id
    ) then
      raise exception 'DUPLICATE_VOTE';
    end if;
  end if;

  if p_viewer_fingerprint is not null and length(trim(p_viewer_fingerprint)) > 0 then
    if exists (
      select 1
      from public.bodybattle_votes
      where season_id = p_season_id
        and matchup_key = p_matchup_key
        and viewer_fingerprint = p_viewer_fingerprint
    ) then
      raise exception 'DUPLICATE_VOTE';
    end if;
  end if;

  insert into public.bodybattle_votes (
    season_id,
    left_entry_id,
    right_entry_id,
    winner_side,
    matchup_key,
    voter_user_id,
    viewer_fingerprint
  ) values (
    p_season_id,
    p_left_entry_id,
    p_right_entry_id,
    p_winner_side,
    p_matchup_key,
    p_voter_user_id,
    p_viewer_fingerprint
  );

  if p_winner_side = 'left' then
    v_left_score := 1;
    v_right_score := 0;
  elsif p_winner_side = 'right' then
    v_left_score := 0;
    v_right_score := 1;
  else
    v_left_score := 0.5;
    v_right_score := 0.5;
  end if;

  v_left_expected := 1 / (1 + power(10, ((coalesce(v_right.rating, 1000) - coalesce(v_left.rating, 1000)) / 400)));
  v_right_expected := 1 / (1 + power(10, ((coalesce(v_left.rating, 1000) - coalesce(v_right.rating, 1000)) / 400)));

  v_left_new_rating := round((coalesce(v_left.rating, 1000) + (32 * (v_left_score - v_left_expected)))::numeric, 2);
  v_right_new_rating := round((coalesce(v_right.rating, 1000) + (32 * (v_right_score - v_right_expected)))::numeric, 2);

  if p_winner_side = 'left' then
    v_left_next_current_streak := coalesce(v_left.current_streak, 0) + 1;
    v_right_next_current_streak := 0;
  elsif p_winner_side = 'right' then
    v_left_next_current_streak := 0;
    v_right_next_current_streak := coalesce(v_right.current_streak, 0) + 1;
  else
    v_left_next_current_streak := coalesce(v_left.current_streak, 0);
    v_right_next_current_streak := coalesce(v_right.current_streak, 0);
  end if;

  v_left_next_best_streak := greatest(coalesce(v_left.best_streak, 0), v_left_next_current_streak);
  v_right_next_best_streak := greatest(coalesce(v_right.best_streak, 0), v_right_next_current_streak);

  update public.bodybattle_entries
  set
    rating = v_left_new_rating,
    wins = wins + case when p_winner_side = 'left' then 1 else 0 end,
    losses = losses + case when p_winner_side = 'right' then 1 else 0 end,
    draws = draws + case when p_winner_side = 'draw' then 1 else 0 end,
    current_streak = v_left_next_current_streak,
    best_streak = v_left_next_best_streak,
    votes_received = votes_received + 1
  where id = p_left_entry_id;

  update public.bodybattle_entries
  set
    rating = v_right_new_rating,
    wins = wins + case when p_winner_side = 'right' then 1 else 0 end,
    losses = losses + case when p_winner_side = 'left' then 1 else 0 end,
    draws = draws + case when p_winner_side = 'draw' then 1 else 0 end,
    current_streak = v_right_next_current_streak,
    best_streak = v_right_next_best_streak,
    votes_received = votes_received + 1
  where id = p_right_entry_id;

  select count(*)
  into v_matchup_votes
  from public.bodybattle_votes
  where season_id = p_season_id and matchup_key = p_matchup_key;

  v_today_kst := (now() at time zone 'Asia/Seoul')::date;
  v_next_total_votes := 0;
  v_next_level := 1;
  v_next_xp := 0;
  v_next_vote_streak_days := 0;

  if p_voter_user_id is not null or (p_viewer_fingerprint is not null and length(trim(p_viewer_fingerprint)) > 0) then
    if p_voter_user_id is not null then
      select *
      into v_profile
      from public.bodybattle_voter_profiles
      where user_id = p_voter_user_id
      for update;
    else
      select *
      into v_profile
      from public.bodybattle_voter_profiles
      where viewer_fingerprint = p_viewer_fingerprint
      for update;
    end if;

    if not found then
      v_next_daily_votes := 1;
      v_next_vote_streak_days := 1;
      v_next_total_votes := 1;
      v_next_xp := 10;
      v_next_level := greatest(1, floor(v_next_xp / 100) + 1);

      if p_voter_user_id is not null and v_next_daily_votes > 500 then
        raise exception 'DAILY_VOTE_LIMIT_EXCEEDED';
      elsif p_voter_user_id is null and v_next_daily_votes > 200 then
        raise exception 'DAILY_VOTE_LIMIT_EXCEEDED';
      end if;

      insert into public.bodybattle_voter_profiles (
        user_id,
        viewer_fingerprint,
        xp,
        level,
        total_votes,
        daily_votes,
        vote_streak_days,
        last_voted_date,
        last_voted_at
      ) values (
        p_voter_user_id,
        p_viewer_fingerprint,
        v_next_xp,
        v_next_level,
        v_next_total_votes,
        v_next_daily_votes,
        v_next_vote_streak_days,
        v_today_kst,
        now()
      );
    else
      if v_profile.last_voted_date = v_today_kst then
        v_next_daily_votes := coalesce(v_profile.daily_votes, 0) + 1;
        v_next_vote_streak_days := greatest(1, coalesce(v_profile.vote_streak_days, 0));
      elsif v_profile.last_voted_date = (v_today_kst - interval '1 day')::date then
        v_next_daily_votes := 1;
        v_next_vote_streak_days := greatest(1, coalesce(v_profile.vote_streak_days, 0) + 1);
      else
        v_next_daily_votes := 1;
        v_next_vote_streak_days := 1;
      end if;

      if p_voter_user_id is not null and v_next_daily_votes > 500 then
        raise exception 'DAILY_VOTE_LIMIT_EXCEEDED';
      elsif p_voter_user_id is null and v_next_daily_votes > 200 then
        raise exception 'DAILY_VOTE_LIMIT_EXCEEDED';
      end if;

      v_next_total_votes := coalesce(v_profile.total_votes, 0) + 1;
      v_next_xp := coalesce(v_profile.xp, 0) + 10;
      v_next_level := greatest(1, floor(v_next_xp / 100) + 1);

      update public.bodybattle_voter_profiles
      set
        xp = v_next_xp,
        level = v_next_level,
        total_votes = v_next_total_votes,
        daily_votes = v_next_daily_votes,
        vote_streak_days = v_next_vote_streak_days,
        last_voted_date = v_today_kst,
        last_voted_at = now(),
        updated_at = now()
      where id = v_profile.id;
    end if;
  end if;

  return query
  select
    p_left_entry_id,
    p_right_entry_id,
    p_winner_side,
    v_left_new_rating,
    v_right_new_rating,
    v_left.wins + case when p_winner_side = 'left' then 1 else 0 end,
    v_left.losses + case when p_winner_side = 'right' then 1 else 0 end,
    v_left.draws + case when p_winner_side = 'draw' then 1 else 0 end,
    v_right.wins + case when p_winner_side = 'right' then 1 else 0 end,
    v_right.losses + case when p_winner_side = 'left' then 1 else 0 end,
    v_right.draws + case when p_winner_side = 'draw' then 1 else 0 end,
    v_left.votes_received + 1,
    v_right.votes_received + 1,
    v_matchup_votes,
    v_left_next_current_streak,
    v_right_next_current_streak,
    v_left_next_best_streak,
    v_right_next_best_streak,
    v_next_total_votes,
    v_next_level,
    v_next_xp,
    v_next_vote_streak_days;
end;
$$;

grant execute on function public.bodybattle_cast_vote(uuid, uuid, uuid, text, text, uuid, text) to anon, authenticated, service_role;

create or replace function public.bodybattle_finalize_season(p_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season public.bodybattle_seasons%rowtype;
  v_top10 jsonb;
  v_champion public.bodybattle_entries%rowtype;
begin
  select *
  into v_season
  from public.bodybattle_seasons
  where id = p_season_id
  for update;

  if not found then
    raise exception 'SEASON_NOT_FOUND';
  end if;

  with eligible as (
    select e.*
    from public.bodybattle_entries e
    where e.season_id = p_season_id
      and e.status = 'active'
      and e.moderation_status = 'approved'
      and e.exposures >= 20
      and e.votes_received >= 30
      and coalesce(e.report_count, 0) < 5
  ),
  ranked as (
    select
      e.*,
      row_number() over (
        order by e.rating desc, (case when (e.wins + e.losses + e.draws) > 0 then e.wins::numeric / (e.wins + e.losses + e.draws) else 0 end) desc, e.votes_received desc, e.created_at asc
      ) as rank_no
    from eligible e
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank', rank_no,
        'entry_id', id,
        'user_id', user_id,
        'nickname', nickname,
        'rating', rating,
        'votes_received', votes_received,
        'wins', wins,
        'losses', losses,
        'draws', draws,
        'image_url', coalesce(image_urls[1], null),
        'champion_comment', champion_comment
      )
      order by rank_no
    ),
    '[]'::jsonb
  )
  into v_top10
  from ranked
  where rank_no <= 10;

  select e.*
  into v_champion
  from public.bodybattle_entries e
  where e.id = (v_top10->0->>'entry_id')::uuid;

  insert into public.bodybattle_season_results (season_id, champion_entry_id, top10, finalized_at)
  values (p_season_id, v_champion.id, v_top10, now())
  on conflict (season_id)
  do update
  set champion_entry_id = excluded.champion_entry_id,
      top10 = excluded.top10,
      finalized_at = now();

  if v_champion.id is not null then
    insert into public.bodybattle_hall_of_fame (
      season_id,
      week_id,
      theme_slug,
      theme_label,
      champion_entry_id,
      user_id,
      nickname,
      image_url,
      rating,
      votes_received,
      wins,
      losses,
      draws,
      champion_comment,
      created_at
    ) values (
      p_season_id,
      v_season.week_id,
      v_season.theme_slug,
      v_season.theme_label,
      v_champion.id,
      v_champion.user_id,
      v_champion.nickname,
      coalesce(v_champion.image_urls[1], null),
      v_champion.rating,
      v_champion.votes_received,
      v_champion.wins,
      v_champion.losses,
      v_champion.draws,
      v_champion.champion_comment,
      now()
    )
    on conflict (season_id)
    do update
    set champion_entry_id = excluded.champion_entry_id,
        user_id = excluded.user_id,
        nickname = excluded.nickname,
        image_url = excluded.image_url,
        rating = excluded.rating,
        votes_received = excluded.votes_received,
        wins = excluded.wins,
        losses = excluded.losses,
        draws = excluded.draws,
        champion_comment = excluded.champion_comment,
        created_at = now();
  end if;

  update public.bodybattle_seasons
  set status = case when end_at <= now() then 'closed' else status end
  where id = p_season_id;

  return jsonb_build_object(
    'ok', true,
    'season_id', p_season_id,
    'champion_entry_id', v_champion.id,
    'top10_count', jsonb_array_length(v_top10)
  );
end;
$$;

grant execute on function public.bodybattle_finalize_season(uuid) to authenticated, service_role;

drop function if exists public.bodybattle_ensure_current_season();
create or replace function public.bodybattle_ensure_current_season()
returns table (
  season_id uuid,
  week_id text,
  created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_kst timestamp := now() at time zone 'Asia/Seoul';
  v_week_start_kst timestamp;
  v_week_end_kst timestamp;
  v_week_id text;
  v_existing public.bodybattle_seasons%rowtype;
  v_theme_slugs text[] := array['shoulders','back','legs','arms','full_balance'];
  v_theme_labels text[] := array['어깨 챔피언전','등 챔피언전','하체 챔피언전','팔 챔피언전','전신 밸런스 챔피언전'];
  v_theme_idx integer;
begin
  v_week_start_kst := date_trunc('week', v_now_kst);
  v_week_end_kst := v_week_start_kst + interval '7 day';
  v_week_id := to_char(v_week_start_kst, 'IYYY-"W"IW');

  select *
  into v_existing
  from public.bodybattle_seasons
  where week_id = v_week_id
  limit 1;

  if found then
    if v_existing.status <> 'active' then
      update public.bodybattle_seasons
      set status = case when end_at > now() then 'active' else 'closed' end
      where id = v_existing.id;
      select * into v_existing from public.bodybattle_seasons where id = v_existing.id;
    end if;
    return query select v_existing.id, v_existing.week_id, false;
    return;
  end if;

  v_theme_idx := (extract(week from v_week_start_kst)::integer % array_length(v_theme_slugs, 1)) + 1;
  insert into public.bodybattle_seasons (
    week_id,
    theme_slug,
    theme_label,
    start_at,
    end_at,
    status
  ) values (
    v_week_id,
    v_theme_slugs[v_theme_idx],
    v_theme_labels[v_theme_idx],
    v_week_start_kst at time zone 'Asia/Seoul',
    v_week_end_kst at time zone 'Asia/Seoul',
    'active'
  )
  returning id, week_id
  into v_existing.id, v_existing.week_id;

  return query select v_existing.id, v_existing.week_id, true;
end;
$$;

grant execute on function public.bodybattle_ensure_current_season() to authenticated, service_role;

create or replace function public.bodybattle_finalize_due_seasons()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_done integer := 0;
begin
  for v_row in
    select id
    from public.bodybattle_seasons
    where end_at <= now()
      and status <> 'closed'
    order by end_at asc
  loop
    perform public.bodybattle_finalize_season(v_row.id);
    update public.bodybattle_seasons
    set status = 'closed'
    where id = v_row.id;
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'finalized_count', v_done
  );
end;
$$;

grant execute on function public.bodybattle_finalize_due_seasons() to authenticated, service_role;

drop function if exists public.bodybattle_claim_reward(uuid, text);
create or replace function public.bodybattle_claim_reward(
  p_user_id uuid,
  p_reward_code text
)
returns table (
  ok boolean,
  reward_code text,
  reward_type text,
  reward_amount integer,
  credits_after integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.bodybattle_voter_profiles%rowtype;
  v_reward_type text;
  v_reward_amount integer;
  v_credits integer;
begin
  if auth.uid() is distinct from p_user_id and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id is null then
    raise exception 'USER_REQUIRED';
  end if;

  select *
  into v_profile
  from public.bodybattle_voter_profiles
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if p_reward_code = 'level_3_credit' then
    if coalesce(v_profile.level, 1) < 3 then raise exception 'REWARD_CONDITION_NOT_MET'; end if;
    v_reward_type := 'apply_credit';
    v_reward_amount := 1;
  elsif p_reward_code = 'level_5_credit' then
    if coalesce(v_profile.level, 1) < 5 then raise exception 'REWARD_CONDITION_NOT_MET'; end if;
    v_reward_type := 'apply_credit';
    v_reward_amount := 1;
  elsif p_reward_code = 'level_10_credit_pack' then
    if coalesce(v_profile.level, 1) < 10 then raise exception 'REWARD_CONDITION_NOT_MET'; end if;
    v_reward_type := 'apply_credit';
    v_reward_amount := 3;
  elsif p_reward_code = 'votes_200_credit_pack' then
    if coalesce(v_profile.total_votes, 0) < 200 then raise exception 'REWARD_CONDITION_NOT_MET'; end if;
    v_reward_type := 'apply_credit';
    v_reward_amount := 2;
  else
    raise exception 'INVALID_REWARD_CODE';
  end if;

  insert into public.bodybattle_reward_claims (user_id, reward_code, reward_type, reward_amount)
  values (p_user_id, p_reward_code, v_reward_type, v_reward_amount);

  if v_reward_type = 'apply_credit' then
    insert into public.user_apply_credits (user_id, credits, updated_at)
    values (p_user_id, v_reward_amount, now())
    on conflict (user_id)
    do update
      set credits = public.user_apply_credits.credits + excluded.credits,
          updated_at = now();
  end if;

  select coalesce(credits, 0)
  into v_credits
  from public.user_apply_credits
  where user_id = p_user_id;

  return query select true, p_reward_code, v_reward_type, v_reward_amount, coalesce(v_credits, 0);
exception
  when unique_violation then
    raise exception 'REWARD_ALREADY_CLAIMED';
end;
$$;

grant execute on function public.bodybattle_claim_reward(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
