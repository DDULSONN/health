-- More-view request flow for open cards (male/female split)
-- - Admin approval grants a 3-hour access window
-- - First list call stores a fixed random snapshot (up to 15 card IDs)

create table if not exists public.dating_more_view_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sex text not null check (sex in ('male', 'female')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text,
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  access_expires_at timestamptz null,
  snapshot_card_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null
);

alter table public.dating_more_view_requests
  add column if not exists access_expires_at timestamptz null;

alter table public.dating_more_view_requests
  add column if not exists snapshot_card_ids jsonb not null default '[]'::jsonb;

create index if not exists idx_dating_more_view_requests_user_created
  on public.dating_more_view_requests (user_id, created_at desc);

create index if not exists idx_dating_more_view_requests_status_created
  on public.dating_more_view_requests (status, created_at desc);

create index if not exists idx_dating_more_view_requests_user_sex_status_expires
  on public.dating_more_view_requests (user_id, sex, status, access_expires_at desc);

create unique index if not exists uq_dating_more_view_requests_pending
  on public.dating_more_view_requests (user_id, sex)
  where status = 'pending';

alter table public.dating_more_view_requests enable row level security;

drop policy if exists "dating_more_view_requests_select_own" on public.dating_more_view_requests;
create policy "dating_more_view_requests_select_own"
  on public.dating_more_view_requests for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "dating_more_view_requests_insert_own" on public.dating_more_view_requests;
create policy "dating_more_view_requests_insert_own"
  on public.dating_more_view_requests for insert
  to authenticated
  with check (auth.uid() = user_id and status = 'pending');

drop policy if exists "dating_more_view_requests_admin_all" on public.dating_more_view_requests;
create policy "dating_more_view_requests_admin_all"
  on public.dating_more_view_requests for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );
