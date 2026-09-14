begin;

-- Separate from scan upserts: re-scanning must never overwrite a human decision.
create table if not exists public.admin_dating_review_confirmations (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in (
    'open_card', 'paid_card', 'one_on_one',
    'open_card_application', 'paid_card_application', 'one_on_one_application'
  )),
  card_id uuid not null,
  content_fingerprint text not null check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  findings_fingerprint text not null check (findings_fingerprint ~ '^[a-f0-9]{64}$'),
  confirmed_by uuid null references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  unique (source_type, card_id)
);

alter table public.admin_dating_review_confirmations enable row level security;
-- Admin server endpoints use service_role after requireAdminRoute. No client writes.
revoke all on table public.admin_dating_review_confirmations from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_dating_review_confirmations to service_role;

commit;
notify pgrst, 'reload schema';
