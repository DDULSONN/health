begin;

create table if not exists public.dating_contact_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  block_type text not null check (block_type in ('phone', 'instagram')),
  value_hash text not null,
  value_hint text null,
  label text null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, block_type, value_hash)
);

create index if not exists idx_dating_contact_blocks_user_created
  on public.dating_contact_blocks(user_id, created_at desc);

create index if not exists idx_dating_contact_blocks_user_type_hash
  on public.dating_contact_blocks(user_id, block_type, value_hash);

alter table public.dating_contact_blocks enable row level security;

drop policy if exists "dating_contact_blocks_select_own" on public.dating_contact_blocks;
create policy "dating_contact_blocks_select_own"
  on public.dating_contact_blocks
  for select
  using (auth.uid() = user_id);

drop policy if exists "dating_contact_blocks_insert_own" on public.dating_contact_blocks;
create policy "dating_contact_blocks_insert_own"
  on public.dating_contact_blocks
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "dating_contact_blocks_delete_own" on public.dating_contact_blocks;
create policy "dating_contact_blocks_delete_own"
  on public.dating_contact_blocks
  for delete
  using (auth.uid() = user_id);

create table if not exists public.dating_1on1_match_hides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.dating_1on1_match_proposals(id) on delete cascade,
  hidden_at timestamptz not null default timezone('utc', now()),
  unique (user_id, match_id)
);

create index if not exists idx_dating_1on1_match_hides_user_match
  on public.dating_1on1_match_hides(user_id, match_id);

alter table public.dating_1on1_match_hides enable row level security;

drop policy if exists "dating_1on1_match_hides_select_own" on public.dating_1on1_match_hides;
create policy "dating_1on1_match_hides_select_own"
  on public.dating_1on1_match_hides
  for select
  using (auth.uid() = user_id);

drop policy if exists "dating_1on1_match_hides_insert_own" on public.dating_1on1_match_hides;
create policy "dating_1on1_match_hides_insert_own"
  on public.dating_1on1_match_hides
  for insert
  with check (auth.uid() = user_id);

commit;

notify pgrst, 'reload schema';
