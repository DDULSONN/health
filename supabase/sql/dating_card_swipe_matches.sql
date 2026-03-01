begin;

create table if not exists public.dating_card_swipes (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_card_id uuid not null references public.dating_cards(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  target_card_id uuid not null references public.dating_cards(id) on delete cascade,
  target_sex text not null check (target_sex in ('male', 'female')),
  action text not null check (action in ('like', 'pass')),
  created_at timestamptz not null default now(),
  unique (actor_user_id, target_user_id, target_sex)
);

create index if not exists idx_dating_card_swipes_actor_created
  on public.dating_card_swipes (actor_user_id, created_at desc);

create index if not exists idx_dating_card_swipes_target_created
  on public.dating_card_swipes (target_user_id, created_at desc);

create table if not exists public.dating_card_swipe_matches (
  id uuid primary key default gen_random_uuid(),
  pair_key text not null unique,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  user_a_card_id uuid not null references public.dating_cards(id) on delete cascade,
  user_b_card_id uuid not null references public.dating_cards(id) on delete cascade,
  user_a_instagram_id text not null,
  user_b_instagram_id text not null,
  created_at timestamptz not null default now(),
  check (user_a_id <> user_b_id)
);

create index if not exists idx_dating_card_swipe_matches_user_a
  on public.dating_card_swipe_matches (user_a_id, created_at desc);

create index if not exists idx_dating_card_swipe_matches_user_b
  on public.dating_card_swipe_matches (user_b_id, created_at desc);

alter table public.dating_card_swipes enable row level security;
alter table public.dating_card_swipe_matches enable row level security;

drop policy if exists "dating_card_swipes_select_own" on public.dating_card_swipes;
create policy "dating_card_swipes_select_own"
  on public.dating_card_swipes for select
  to authenticated
  using (auth.uid() = actor_user_id or auth.uid() = target_user_id);

drop policy if exists "dating_card_swipes_insert_own" on public.dating_card_swipes;
create policy "dating_card_swipes_insert_own"
  on public.dating_card_swipes for insert
  to authenticated
  with check (auth.uid() = actor_user_id);

drop policy if exists "dating_card_swipe_matches_select_own" on public.dating_card_swipe_matches;
create policy "dating_card_swipe_matches_select_own"
  on public.dating_card_swipe_matches for select
  to authenticated
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

commit;

