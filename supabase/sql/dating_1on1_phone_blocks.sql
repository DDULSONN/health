begin;

create table if not exists public.dating_1on1_phone_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_hash text not null,
  phone_last4 text null,
  label text null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, phone_hash)
);

create index if not exists idx_dating_1on1_phone_blocks_user_created
  on public.dating_1on1_phone_blocks(user_id, created_at desc);

create index if not exists idx_dating_1on1_phone_blocks_hash
  on public.dating_1on1_phone_blocks(phone_hash);

alter table public.dating_1on1_phone_blocks enable row level security;

drop policy if exists "dating_1on1_phone_blocks_select_own" on public.dating_1on1_phone_blocks;
create policy "dating_1on1_phone_blocks_select_own"
  on public.dating_1on1_phone_blocks
  for select
  using (auth.uid() = user_id);

drop policy if exists "dating_1on1_phone_blocks_insert_own" on public.dating_1on1_phone_blocks;
create policy "dating_1on1_phone_blocks_insert_own"
  on public.dating_1on1_phone_blocks
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "dating_1on1_phone_blocks_delete_own" on public.dating_1on1_phone_blocks;
create policy "dating_1on1_phone_blocks_delete_own"
  on public.dating_1on1_phone_blocks
  for delete
  using (auth.uid() = user_id);

commit;

notify pgrst, 'reload schema';
