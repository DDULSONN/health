begin;

create table if not exists public.dating_1on1_admin_user_blocks (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  note text null,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint dating_1on1_admin_user_blocks_not_self check (user_a_id <> user_b_id),
  unique (user_a_id, user_b_id)
);

create index if not exists idx_dating_1on1_admin_user_blocks_user_a
  on public.dating_1on1_admin_user_blocks(user_a_id, created_at desc);

create index if not exists idx_dating_1on1_admin_user_blocks_user_b
  on public.dating_1on1_admin_user_blocks(user_b_id, created_at desc);

alter table public.dating_1on1_admin_user_blocks enable row level security;

commit;

notify pgrst, 'reload schema';
