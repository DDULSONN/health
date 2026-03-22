-- Add one-time recommendation refresh support for 1:1 dating cards.
-- Safe to run multiple times.

begin;

alter table public.dating_1on1_cards
  add column if not exists recommendation_refresh_used_at timestamptz;

commit;

notify pgrst, 'reload schema';
