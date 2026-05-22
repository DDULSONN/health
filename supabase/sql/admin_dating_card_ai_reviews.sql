begin;

create table if not exists public.admin_dating_card_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  source_type text not null
    check (source_type in ('open_card', 'paid_card', 'one_on_one')),
  card_id uuid not null,
  user_id uuid null references auth.users(id) on delete set null,
  card_status text null,
  display_name text null,
  suspicion_level text not null default 'clear'
    check (suspicion_level in ('clear', 'low', 'medium', 'high')),
  flags text[] not null default '{}'::text[],
  summary text not null default '',
  photo_flags jsonb not null default '[]'::jsonb,
  text_flags jsonb not null default '[]'::jsonb,
  raw_result jsonb not null default '{}'::jsonb,
  scanned_at timestamptz not null default timezone('utc', now()),
  admin_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (source_type, card_id)
);

create index if not exists idx_admin_dating_card_ai_reviews_level_scanned
  on public.admin_dating_card_ai_reviews(suspicion_level, scanned_at desc);

create index if not exists idx_admin_dating_card_ai_reviews_source_scanned
  on public.admin_dating_card_ai_reviews(source_type, scanned_at desc);

alter table public.admin_dating_card_ai_reviews enable row level security;

drop policy if exists "admin_dating_card_ai_reviews_admin_all" on public.admin_dating_card_ai_reviews;
create policy "admin_dating_card_ai_reviews_admin_all"
  on public.admin_dating_card_ai_reviews
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
