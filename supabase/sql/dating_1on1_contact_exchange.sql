begin;

alter table public.dating_1on1_match_proposals
  add column if not exists contact_exchange_status text not null default 'none'
    check (contact_exchange_status in ('none', 'awaiting_applicant_payment', 'payment_pending_admin', 'approved', 'canceled')),
  add column if not exists contact_exchange_requested_at timestamptz,
  add column if not exists contact_exchange_paid_at timestamptz,
  add column if not exists contact_exchange_paid_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists contact_exchange_approved_at timestamptz,
  add column if not exists contact_exchange_approved_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists contact_exchange_note text;

update public.dating_1on1_match_proposals
set
  contact_exchange_status = case
    when state = 'mutual_accepted' then 'awaiting_applicant_payment'
    else 'none'
  end,
  contact_exchange_requested_at = case
    when state = 'mutual_accepted' and contact_exchange_requested_at is null then coalesce(updated_at, created_at, now())
    else contact_exchange_requested_at
  end
where contact_exchange_status = 'none'
  and state = 'mutual_accepted';

create index if not exists idx_dating_1on1_match_proposals_contact_exchange_status
  on public.dating_1on1_match_proposals (contact_exchange_status, created_at desc);

commit;

notify pgrst, 'reload schema';
