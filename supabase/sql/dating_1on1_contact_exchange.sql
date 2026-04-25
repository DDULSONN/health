begin;

alter table public.dating_1on1_match_proposals
  add column if not exists contact_exchange_status text not null default 'none'
    check (contact_exchange_status in ('none', 'awaiting_applicant_payment', 'payment_pending_admin', 'approved', 'canceled')),
  add column if not exists contact_exchange_requested_at timestamptz,
  add column if not exists contact_exchange_paid_at timestamptz,
  add column if not exists contact_exchange_paid_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists contact_exchange_approved_at timestamptz,
  add column if not exists contact_exchange_approved_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists contact_exchange_note text,
  add column if not exists source_phone_share_consented_at timestamptz,
  add column if not exists candidate_phone_share_consented_at timestamptz;

update public.dating_1on1_match_proposals
set
  contact_exchange_status = 'none',
  contact_exchange_requested_at = null,
  contact_exchange_paid_at = null,
  contact_exchange_paid_by_user_id = null,
  contact_exchange_approved_at = null,
  contact_exchange_approved_by_user_id = null,
  contact_exchange_note = null
where state = 'mutual_accepted'
  and contact_exchange_status in ('none', 'awaiting_applicant_payment', 'payment_pending_admin')
  and coalesce(source_final_responded_at, created_at, now()) < timestamptz '2026-04-25 00:00:00+09';

update public.dating_1on1_match_proposals
set
  contact_exchange_status = 'awaiting_applicant_payment',
  contact_exchange_requested_at = coalesce(contact_exchange_requested_at, source_final_responded_at, updated_at, created_at, now()),
  source_phone_share_consented_at = null,
  candidate_phone_share_consented_at = null
where state = 'mutual_accepted'
  and contact_exchange_status = 'none'
  and coalesce(source_final_responded_at, created_at, now()) >= timestamptz '2026-04-25 00:00:00+09';

create index if not exists idx_dating_1on1_match_proposals_contact_exchange_status
  on public.dating_1on1_match_proposals (contact_exchange_status, created_at desc);

commit;

notify pgrst, 'reload schema';
