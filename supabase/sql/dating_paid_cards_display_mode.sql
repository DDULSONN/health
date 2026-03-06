-- Paid dating cards display mode
-- - priority_24h: existing "24h top fixed" behavior
-- - instant_public: immediate publish without top-fixed ordering

begin;

alter table public.dating_paid_cards
  add column if not exists display_mode text not null default 'priority_24h'
  check (display_mode in ('priority_24h', 'instant_public'));

create index if not exists idx_dating_paid_cards_display_mode
  on public.dating_paid_cards (display_mode, paid_at asc nulls last, created_at desc);

commit;

notify pgrst, 'reload schema';
