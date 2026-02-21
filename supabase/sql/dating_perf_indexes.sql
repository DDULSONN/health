-- Performance indexes for dating list/apply flows.
-- Safe-only: index additions only (no schema/RLS/policy changes).
-- Run during low-traffic time.
-- NOTE:
-- - This file is transaction-safe (no CONCURRENTLY) for environments that wrap SQL in a transaction.
-- - If you run directly outside a transaction (psql/autocommit), you may switch to CONCURRENTLY manually.

create index if not exists idx_dating_cards_sex_status_created_id_desc
  on public.dating_cards (sex, status, created_at desc, id desc);

create index if not exists idx_dating_cards_expires_at
  on public.dating_cards (expires_at);

create index if not exists idx_dating_card_apps_applicant_user_created_desc
  on public.dating_card_applications (applicant_user_id, created_at desc);

create index if not exists idx_dating_card_apps_card_created_desc
  on public.dating_card_applications (card_id, created_at desc);

-- `profiles.user_id` already has a UNIQUE constraint in this schema.
-- Skip extra index to avoid duplicate btree maintenance cost.
