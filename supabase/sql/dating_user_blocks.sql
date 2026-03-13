begin;

create table if not exists public.dating_user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  reason text null,
  created_at timestamptz not null default now(),
  constraint dating_user_blocks_not_self check (blocker_user_id <> blocked_user_id),
  constraint dating_user_blocks_unique unique (blocker_user_id, blocked_user_id)
);

create index if not exists idx_dating_user_blocks_blocker
  on public.dating_user_blocks (blocker_user_id, created_at desc);

create index if not exists idx_dating_user_blocks_blocked
  on public.dating_user_blocks (blocked_user_id, created_at desc);

alter table public.dating_user_blocks enable row level security;

drop policy if exists "dating_user_blocks_select_own" on public.dating_user_blocks;
create policy "dating_user_blocks_select_own"
  on public.dating_user_blocks
  for select
  using (auth.uid() = blocker_user_id);

drop policy if exists "dating_user_blocks_insert_own" on public.dating_user_blocks;
create policy "dating_user_blocks_insert_own"
  on public.dating_user_blocks
  for insert
  with check (auth.uid() = blocker_user_id);

drop policy if exists "dating_user_blocks_delete_own" on public.dating_user_blocks;
create policy "dating_user_blocks_delete_own"
  on public.dating_user_blocks
  for delete
  using (auth.uid() = blocker_user_id);

commit;

notify pgrst, 'reload schema';
