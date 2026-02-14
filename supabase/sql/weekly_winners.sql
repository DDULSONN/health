-- Weekly winners snapshot table (KST Monday-based week)
create table if not exists public.weekly_winners (
  id uuid primary key default gen_random_uuid(),
  week_start timestamptz not null,
  week_end timestamptz not null,
  male_post_id uuid null references public.posts(id) on delete set null,
  female_post_id uuid null references public.posts(id) on delete set null,
  male_score integer not null default 0,
  female_score integer not null default 0,
  created_at timestamptz not null default now(),
  unique (week_start)
);

create index if not exists idx_weekly_winners_week_start
  on public.weekly_winners (week_start desc);

create index if not exists idx_weekly_winners_male_post_id
  on public.weekly_winners (male_post_id);

create index if not exists idx_weekly_winners_female_post_id
  on public.weekly_winners (female_post_id);

alter table public.weekly_winners enable row level security;

drop policy if exists "weekly_winners_select_all" on public.weekly_winners;
create policy "weekly_winners_select_all"
  on public.weekly_winners
  for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policy for anon/authenticated:
-- write operations are intended for service-role jobs only.
