create table if not exists public.lift_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sex text not null check (sex in ('male', 'female')),
  squat numeric(6,1) not null default 0,
  bench numeric(6,1) not null default 0,
  deadlift numeric(6,1) not null default 0,
  total numeric(6,1) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_lift_records_user_created_at
  on public.lift_records (user_id, created_at asc);

alter table public.lift_records enable row level security;

drop policy if exists "lift_records_select_own" on public.lift_records;
create policy "lift_records_select_own"
  on public.lift_records
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "lift_records_insert_own" on public.lift_records;
create policy "lift_records_insert_own"
  on public.lift_records
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "lift_records_update_own" on public.lift_records;
create policy "lift_records_update_own"
  on public.lift_records
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "lift_records_delete_own" on public.lift_records;
create policy "lift_records_delete_own"
  on public.lift_records
  for delete
  to authenticated
  using (auth.uid() = user_id);

