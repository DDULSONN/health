-- Community reactions and moderation support
-- 1) Add ban fields to profiles
-- 2) Add per-user post reactions for free/community posts
-- 3) Add indexes for faster community report moderation

begin;

alter table public.profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists banned_reason text null,
  add column if not exists banned_at timestamptz null;

create index if not exists idx_profiles_is_banned
  on public.profiles (is_banned);

create table if not exists public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index if not exists idx_post_reactions_post_id
  on public.post_reactions (post_id, created_at desc);

create index if not exists idx_post_reactions_user_id
  on public.post_reactions (user_id, created_at desc);

create or replace function public.set_post_reactions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_post_reactions_updated_at on public.post_reactions;
create trigger trg_set_post_reactions_updated_at
before update on public.post_reactions
for each row
execute function public.set_post_reactions_updated_at();

alter table public.post_reactions enable row level security;

drop policy if exists "post_reactions_select_all" on public.post_reactions;
create policy "post_reactions_select_all"
on public.post_reactions
for select
using (true);

drop policy if exists "post_reactions_insert_own" on public.post_reactions;
create policy "post_reactions_insert_own"
on public.post_reactions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "post_reactions_update_own" on public.post_reactions;
create policy "post_reactions_update_own"
on public.post_reactions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "post_reactions_delete_own" on public.post_reactions;
create policy "post_reactions_delete_own"
on public.post_reactions
for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists idx_reports_target_lookup
  on public.reports (target_type, target_id, resolved, created_at desc);

create index if not exists idx_reports_reporter_lookup
  on public.reports (reporter_id, created_at desc);

commit;
