begin;

alter table public.dating_cards
  add column if not exists applications_last_viewed_at timestamptz;

commit;

notify pgrst, 'reload schema';
