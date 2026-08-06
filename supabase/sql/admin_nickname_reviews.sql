begin;

create table if not exists public.admin_nickname_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  suspicion_level text not null check (suspicion_level in ('medium', 'high')),
  flags text[] not null default '{}'::text[],
  status text not null default 'pending' check (status in ('pending', 'dismissed', 'actioned', 'cleared')),
  first_detected_at timestamptz not null default timezone('utc', now()),
  last_detected_at timestamptz not null default timezone('utc', now()),
  reviewed_at timestamptz null,
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  resolution_note text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id)
);

create index if not exists idx_admin_nickname_reviews_status_detected
  on public.admin_nickname_reviews(status, last_detected_at desc);

alter table public.admin_nickname_reviews enable row level security;

drop policy if exists "admin_nickname_reviews_admin_all" on public.admin_nickname_reviews;
create policy "admin_nickname_reviews_admin_all"
  on public.admin_nickname_reviews
  for all
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
