-- Restore the missing account-pair block store. No backfill, match cleanup,
-- payment changes or member bans. All writes continue through authenticated APIs.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
create table if not exists public.dating_user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  constraint dating_user_blocks_not_self check (blocker_user_id <> blocked_user_id),
  constraint dating_user_blocks_unique unique (blocker_user_id, blocked_user_id)
);
create index if not exists idx_dating_user_blocks_blocker
  on public.dating_user_blocks(blocker_user_id, created_at desc);
create index if not exists idx_dating_user_blocks_blocked
  on public.dating_user_blocks(blocked_user_id, created_at desc);
alter table public.dating_user_blocks enable row level security;
-- The application uses the service client after authenticating the caller.
-- Do not rely on broad Supabase default grants or expose the block graph.
revoke all on public.dating_user_blocks from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.dating_user_blocks to service_role;
commit;
notify pgrst, 'reload schema';
