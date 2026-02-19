-- Add 3-lift verification snapshot for paid cards.

begin;

alter table public.dating_paid_cards
  add column if not exists is_3lift_verified boolean not null default false;

update public.dating_paid_cards c
set is_3lift_verified = exists (
  select 1
  from public.cert_requests cr
  where cr.user_id = c.user_id
    and cr.status = 'approved'
)
where c.gender = 'M';

commit;

notify pgrst, 'reload schema';
