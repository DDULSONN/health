create table if not exists public.flirting_line_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 120),
  deleted_at timestamptz null,
  deleted_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_flirting_line_ideas_visible_created
  on public.flirting_line_ideas (created_at desc)
  where deleted_at is null;

create index if not exists idx_flirting_line_ideas_user_created
  on public.flirting_line_ideas (user_id, created_at desc);

alter table public.flirting_line_ideas enable row level security;

revoke all on table public.flirting_line_ideas from anon, authenticated;
grant select, insert, update on table public.flirting_line_ideas to authenticated;

drop policy if exists "flirting_line_ideas_select_visible" on public.flirting_line_ideas;
create policy "flirting_line_ideas_select_visible"
  on public.flirting_line_ideas
  for select
  using (deleted_at is null);

drop policy if exists "flirting_line_ideas_insert_own" on public.flirting_line_ideas;
create policy "flirting_line_ideas_insert_own"
  on public.flirting_line_ideas
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "flirting_line_ideas_update_owner_or_admin" on public.flirting_line_ideas;
create policy "flirting_line_ideas_update_owner_or_admin"
  on public.flirting_line_ideas
  for update
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );
