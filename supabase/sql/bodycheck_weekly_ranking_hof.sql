-- Bodycheck weekly ranking + hall of fame automation (KST Monday-based)
-- Run in Supabase SQL editor.

-- 1) Week utilities
create or replace function public.kst_week_id(ts timestamptz default now())
returns text
language sql
stable
as $$
  select to_char(timezone('Asia/Seoul', ts), 'IYYY-"W"IW');
$$;

create or replace function public.kst_week_bounds(ref_ts timestamptz default now())
returns table (
  week_id text,
  start_utc timestamptz,
  end_utc timestamptz
)
language plpgsql
stable
as $$
declare
  start_kst timestamp;
begin
  start_kst := date_trunc('week', timezone('Asia/Seoul', ref_ts));
  week_id := to_char(start_kst, 'IYYY-"W"IW');
  start_utc := start_kst at time zone 'Asia/Seoul';
  end_utc := (start_kst + interval '1 week') at time zone 'Asia/Seoul';
  return next;
end;
$$;

-- 2) Votes table (post_id + voter_id unique)
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  rating text not null check (rating in ('great', 'good', 'normal', 'rookie')),
  value smallint not null check (value between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, voter_id)
);

create index if not exists idx_votes_post_id on public.votes(post_id);
create index if not exists idx_votes_voter_id on public.votes(voter_id);

create or replace function public.set_votes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_votes_updated_at on public.votes;
create trigger trg_set_votes_updated_at
before update on public.votes
for each row execute function public.set_votes_updated_at();

-- 3) Weekly score aggregation table
create table if not exists public.post_score_weekly (
  id uuid primary key default gen_random_uuid(),
  week_id text not null,
  post_id uuid not null references public.posts(id) on delete cascade,
  gender text not null check (gender in ('male', 'female')),
  score_sum integer not null default 0,
  vote_count integer not null default 0,
  score_avg numeric(10,4) not null default 0,
  updated_at timestamptz not null default now(),
  unique (week_id, post_id)
);

create index if not exists idx_post_score_weekly_rank
  on public.post_score_weekly (week_id, gender, score_avg desc, vote_count desc, updated_at asc);

create or replace function public.apply_post_score_weekly_delta(
  p_week_id text,
  p_post_id uuid,
  p_gender text,
  p_score_delta integer,
  p_vote_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
begin
  insert into public.post_score_weekly (week_id, post_id, gender, score_sum, vote_count, score_avg, updated_at)
  values (p_week_id, p_post_id, p_gender, greatest(p_score_delta, 0), greatest(p_vote_delta, 0), 0, now())
  on conflict (week_id, post_id)
  do update set
    score_sum = greatest(public.post_score_weekly.score_sum + p_score_delta, 0),
    vote_count = greatest(public.post_score_weekly.vote_count + p_vote_delta, 0),
    updated_at = now();

  update public.post_score_weekly
  set score_avg = case when vote_count > 0 then (score_sum::numeric / vote_count::numeric) else 0 end,
      updated_at = now()
  where week_id = p_week_id and post_id = p_post_id;
end;
$$;

-- 4) Hall of fame table
create table if not exists public.hall_of_fame (
  id uuid primary key default gen_random_uuid(),
  week_id text not null,
  gender text not null check (gender in ('male', 'female')),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text,
  image_url text,
  score_avg numeric(10,4) not null,
  vote_count integer not null,
  created_at timestamptz not null default now(),
  unique (week_id, gender)
);

create index if not exists idx_hall_of_fame_week_id on public.hall_of_fame(week_id desc);

-- 5) Trigger: votes -> posts + weekly table (current week only)
create or replace function public.handle_votes_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts%rowtype;
  v_week_id text;
  v_start timestamptz;
  v_end timestamptz;
  v_target_post_id uuid;
  v_score_delta integer := 0;
  v_vote_delta integer := 0;
  v_old_post public.posts%rowtype;
begin
  if tg_op = 'DELETE' then
    select * into v_post from public.posts where id = old.post_id;
  else
    select * into v_post from public.posts where id = new.post_id;
  end if;

  if v_post.id is null or v_post.type <> 'photo_bodycheck' then
    return coalesce(new, old);
  end if;

  select b.week_id, b.start_utc, b.end_utc
    into v_week_id, v_start, v_end
  from public.kst_week_bounds(now()) b;

  -- Only aggregate posts created in the current KST week window.
  if v_post.created_at < v_start or v_post.created_at >= v_end then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_target_post_id := new.post_id;
    v_score_delta := new.value;
    v_vote_delta := 1;

    update public.posts
    set score_sum = greatest(score_sum + new.value, 0),
        vote_count = greatest(vote_count + 1, 0),
        great_count = great_count + case when new.rating = 'great' then 1 else 0 end,
        good_count = good_count + case when new.rating = 'good' then 1 else 0 end,
        normal_count = normal_count + case when new.rating = 'normal' then 1 else 0 end,
        rookie_count = rookie_count + case when new.rating = 'rookie' then 1 else 0 end
    where id = new.post_id;

  elsif tg_op = 'UPDATE' then
    v_target_post_id := new.post_id;
    if old.post_id <> new.post_id then
      select * into v_old_post from public.posts where id = old.post_id;
      if v_old_post.id is not null and v_old_post.type = 'photo_bodycheck'
         and v_old_post.created_at >= v_start and v_old_post.created_at < v_end then
        perform public.apply_post_score_weekly_delta(
          v_week_id,
          old.post_id,
          coalesce(v_old_post.gender, 'male'),
          -old.value,
          -1
        );

        update public.posts
        set score_sum = greatest(score_sum - old.value, 0),
            vote_count = greatest(vote_count - 1, 0),
            great_count = greatest(great_count - case when old.rating = 'great' then 1 else 0 end, 0),
            good_count = greatest(good_count - case when old.rating = 'good' then 1 else 0 end, 0),
            normal_count = greatest(normal_count - case when old.rating = 'normal' then 1 else 0 end, 0),
            rookie_count = greatest(rookie_count - case when old.rating = 'rookie' then 1 else 0 end, 0)
        where id = old.post_id;
      end if;

      v_score_delta := new.value;
      v_vote_delta := 1;
    else
      v_score_delta := new.value - old.value;
      v_vote_delta := 0;
    end if;

    update public.posts
    set score_sum = greatest(score_sum + (new.value - old.value), 0),
        great_count = greatest(great_count + case when new.rating = 'great' then 1 else 0 end - case when old.rating = 'great' then 1 else 0 end, 0),
        good_count = greatest(good_count + case when new.rating = 'good' then 1 else 0 end - case when old.rating = 'good' then 1 else 0 end, 0),
        normal_count = greatest(normal_count + case when new.rating = 'normal' then 1 else 0 end - case when old.rating = 'normal' then 1 else 0 end, 0),
        rookie_count = greatest(rookie_count + case when new.rating = 'rookie' then 1 else 0 end - case when old.rating = 'rookie' then 1 else 0 end, 0)
    where id = new.post_id;

  elsif tg_op = 'DELETE' then
    v_target_post_id := old.post_id;
    v_score_delta := -old.value;
    v_vote_delta := -1;

    update public.posts
    set score_sum = greatest(score_sum - old.value, 0),
        vote_count = greatest(vote_count - 1, 0),
        great_count = greatest(great_count - case when old.rating = 'great' then 1 else 0 end, 0),
        good_count = greatest(good_count - case when old.rating = 'good' then 1 else 0 end, 0),
        normal_count = greatest(normal_count - case when old.rating = 'normal' then 1 else 0 end, 0),
        rookie_count = greatest(rookie_count - case when old.rating = 'rookie' then 1 else 0 end, 0)
    where id = old.post_id;
  end if;

  perform public.apply_post_score_weekly_delta(
    v_week_id,
    v_target_post_id,
    coalesce(v_post.gender, 'male'),
    v_score_delta,
    v_vote_delta
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_handle_votes_change on public.votes;
create trigger trg_handle_votes_change
after insert or update or delete on public.votes
for each row execute function public.handle_votes_change();

-- 6) RLS
alter table public.votes enable row level security;
alter table public.post_score_weekly enable row level security;
alter table public.hall_of_fame enable row level security;

drop policy if exists "votes_select_all" on public.votes;
create policy "votes_select_all" on public.votes
for select to anon, authenticated using (true);

drop policy if exists "votes_insert_own" on public.votes;
create policy "votes_insert_own" on public.votes
for insert to authenticated with check (auth.uid() = voter_id);

drop policy if exists "votes_update_own" on public.votes;
create policy "votes_update_own" on public.votes
for update to authenticated using (auth.uid() = voter_id) with check (auth.uid() = voter_id);

drop policy if exists "votes_delete_own" on public.votes;
create policy "votes_delete_own" on public.votes
for delete to authenticated using (auth.uid() = voter_id);

drop policy if exists "post_score_weekly_select_all" on public.post_score_weekly;
create policy "post_score_weekly_select_all" on public.post_score_weekly
for select to anon, authenticated using (true);

drop policy if exists "hall_of_fame_select_all" on public.hall_of_fame;
create policy "hall_of_fame_select_all" on public.hall_of_fame
for select to anon, authenticated using (true);
