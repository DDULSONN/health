-- ============================================
-- GymTools Community - Supabase Migration
-- ============================================

-- 1. Profiles
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique not null,
  nickname text unique not null,
  role text default 'user' check (role in ('user', 'admin')),
  created_at timestamptz default now()
);

-- 2. Posts
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null check (type in ('1rm', 'lifts', 'helltest', 'bodycheck', 'free')),
  title text not null,
  content text,
  payload_json jsonb,
  is_hidden boolean default false,
  created_at timestamptz default now()
);

-- 3. Comments
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  content text not null,
  is_hidden boolean default false,
  created_at timestamptz default now()
);

-- 4. Reports
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  reporter_id uuid references auth.users(id) on delete cascade not null,
  reason text not null,
  resolved boolean default false,
  created_at timestamptz default now()
);

-- ============================================
-- Indexes
-- ============================================
create index if not exists idx_posts_user_id on posts(user_id);
create index if not exists idx_posts_type on posts(type);
create index if not exists idx_posts_created_at on posts(created_at desc);
create index if not exists idx_posts_hidden on posts(is_hidden);
create index if not exists idx_comments_post_id on comments(post_id);
create index if not exists idx_comments_created_at on comments(created_at desc);
create index if not exists idx_reports_resolved on reports(resolved);

-- ============================================
-- RLS (Row Level Security)
-- ============================================
alter table profiles enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table reports enable row level security;

-- profiles
create policy "profiles_select_public" on profiles
  for select using (true);
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = user_id);

-- posts: 일반 사용자는 is_hidden=false만 조회
create policy "posts_select_visible" on posts
  for select using (
    is_hidden = false
    or exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );
create policy "posts_insert_own" on posts
  for insert with check (auth.uid() = user_id);
create policy "posts_update_admin" on posts
  for update using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );

-- comments
create policy "comments_select_visible" on comments
  for select using (
    is_hidden = false
    or exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );
create policy "comments_insert_own" on comments
  for insert with check (auth.uid() = user_id);
create policy "comments_update_admin" on comments
  for update using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );

-- reports
create policy "reports_insert_own" on reports
  for insert with check (auth.uid() = reporter_id);
create policy "reports_select_admin" on reports
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );
create policy "reports_update_admin" on reports
  for update using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );
