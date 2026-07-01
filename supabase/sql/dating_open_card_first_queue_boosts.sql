begin;

create table if not exists public.dating_open_card_first_queue_boosts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  card_id uuid references public.dating_cards(id) on delete set null,
  used_at timestamptz not null default now()
);

create index if not exists idx_dating_open_card_first_queue_boosts_used_at
  on public.dating_open_card_first_queue_boosts (used_at desc);

commit;

notify pgrst, 'reload schema';
