-- Performance indexes for dating list/apply flows.
-- NOTE:
-- - Schema uses `sex` (not `gender`) on dating_cards.
-- - Schema uses `applicant_user_id` (not `user_id`) on dating_card_applications.

create index if not exists idx_dating_cards_status_sex_created_at_desc
  on public.dating_cards (status, sex, created_at desc);

create index if not exists idx_dating_cards_expires_at
  on public.dating_cards (expires_at);

create index if not exists idx_dating_card_applications_applicant_user_id_created_at_desc
  on public.dating_card_applications (applicant_user_id, created_at desc);

create index if not exists idx_dating_card_applications_card_id
  on public.dating_card_applications (card_id);

create index if not exists idx_profiles_user_id
  on public.profiles (user_id);
