begin;

create table if not exists public.dating_swipe_subscription_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  amount int not null default 10000 check (amount = 10000),
  daily_limit int not null default 15 check (daily_limit between 1 and 100),
  duration_days int not null default 15 check (duration_days between 1 and 365),
  note text null,
  requested_at timestamptz not null default now(),
  approved_at timestamptz null,
  expires_at timestamptz null,
  reviewed_at timestamptz null,
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dating_swipe_subscription_requests_user_created_at
  on public.dating_swipe_subscription_requests (user_id, created_at desc);

create index if not exists idx_dating_swipe_subscription_requests_status_created_at
  on public.dating_swipe_subscription_requests (status, created_at desc);

create unique index if not exists uq_dating_swipe_subscription_requests_pending_per_user
  on public.dating_swipe_subscription_requests (user_id)
  where status = 'pending';

alter table public.dating_swipe_subscription_requests enable row level security;

drop policy if exists "dating_swipe_subscription_select_own" on public.dating_swipe_subscription_requests;
create policy "dating_swipe_subscription_select_own"
  on public.dating_swipe_subscription_requests for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "dating_swipe_subscription_insert_own" on public.dating_swipe_subscription_requests;
create policy "dating_swipe_subscription_insert_own"
  on public.dating_swipe_subscription_requests for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "dating_swipe_subscription_admin_select" on public.dating_swipe_subscription_requests;
create policy "dating_swipe_subscription_admin_select"
  on public.dating_swipe_subscription_requests for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "dating_swipe_subscription_admin_update" on public.dating_swipe_subscription_requests;
create policy "dating_swipe_subscription_admin_update"
  on public.dating_swipe_subscription_requests for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
