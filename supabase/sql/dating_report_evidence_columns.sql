-- Deploy the sanitized evidence-writing code before running this additive migration.
-- No profile, payment, phone-verification, match, or RLS changes.
begin;
alter table public.dating_user_reports
  add column if not exists evidence_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists evidence_preserved_at timestamptz,
  add column if not exists admin_note text,
  add column if not exists action_type text not null default 'none',
  add column if not exists action_note text,
  add column if not exists actioned_at timestamptz,
  add column if not exists actioned_by_user_id uuid references auth.users(id) on delete set null;
commit;
notify pgrst, 'reload schema';
