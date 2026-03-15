begin;

alter table public.dating_cards
  add column if not exists auto_requeue_count integer not null default 0;

create index if not exists idx_dating_cards_auto_requeue_count
  on public.dating_cards (auto_requeue_count, status, expires_at);

commit;

notify pgrst, 'reload schema';
