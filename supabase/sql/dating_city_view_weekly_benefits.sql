begin;

create table if not exists public.dating_city_view_weekly_benefits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_id text not null check (char_length(week_id) between 6 and 16),
  province text not null check (char_length(province) between 2 and 20),
  granted_request_id uuid null references public.dating_city_view_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, week_id)
);

create index if not exists idx_city_view_weekly_benefits_user_created
  on public.dating_city_view_weekly_benefits (user_id, created_at desc);

alter table public.dating_city_view_weekly_benefits enable row level security;

drop policy if exists "city_view_weekly_benefits_select_own" on public.dating_city_view_weekly_benefits;
create policy "city_view_weekly_benefits_select_own"
  on public.dating_city_view_weekly_benefits for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "city_view_weekly_benefits_insert_own" on public.dating_city_view_weekly_benefits;
create policy "city_view_weekly_benefits_insert_own"
  on public.dating_city_view_weekly_benefits for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "city_view_weekly_benefits_admin_all" on public.dating_city_view_weekly_benefits;
create policy "city_view_weekly_benefits_admin_all"
  on public.dating_city_view_weekly_benefits for all
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

commit;
