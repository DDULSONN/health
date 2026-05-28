begin;

alter table public.dating_card_applications
  add column if not exists accepted_at timestamptz;

alter table public.dating_paid_card_applications
  add column if not exists accepted_at timestamptz;

create index if not exists idx_dating_card_applications_accepted_at
  on public.dating_card_applications (accepted_at desc)
  where status = 'accepted' and accepted_at is not null;

create index if not exists idx_dating_paid_card_applications_accepted_at
  on public.dating_paid_card_applications (accepted_at desc)
  where status = 'accepted' and accepted_at is not null;

commit;

notify pgrst, 'reload schema';
