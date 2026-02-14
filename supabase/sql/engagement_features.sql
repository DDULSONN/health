-- ==================================================
-- 1) Daily Missions storage
-- ==================================================
create table if not exists public.user_daily_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_kst date not null,
  viewed_bodycheck_count integer not null default 0,
  comments_count integer not null default 0,
  did_1rm_calc boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, date_kst)
);

create index if not exists idx_user_daily_stats_date
  on public.user_daily_stats (date_kst desc);

alter table public.user_daily_stats enable row level security;

drop policy if exists "user_daily_stats_select_own" on public.user_daily_stats;
create policy "user_daily_stats_select_own"
  on public.user_daily_stats
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_daily_stats_insert_own" on public.user_daily_stats;
create policy "user_daily_stats_insert_own"
  on public.user_daily_stats
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_daily_stats_update_own" on public.user_daily_stats;
create policy "user_daily_stats_update_own"
  on public.user_daily_stats
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ==================================================
-- 2) Notifications (comment only MVP)
-- ==================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid null references auth.users(id) on delete set null,
  type text not null check (type in ('comment')),
  post_id uuid not null references public.posts(id) on delete cascade,
  comment_id uuid null references public.comments(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, is_read);

create index if not exists idx_notifications_post
  on public.notifications (post_id);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- intentionally no insert/delete policy for client roles

-- ==================================================
-- 3) Trigger: create notification on comment insert
-- ==================================================
create or replace function public.create_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_owner uuid;
begin
  select p.user_id into post_owner
  from public.posts p
  where p.id = new.post_id;

  if post_owner is null then
    return new;
  end if;

  if post_owner = new.user_id then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
  values (post_owner, new.user_id, 'comment', new.post_id, new.id);

  return new;
end;
$$;

drop trigger if exists trg_comment_notification on public.comments;
create trigger trg_comment_notification
after insert on public.comments
for each row
execute function public.create_comment_notification();
