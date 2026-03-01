begin;

update public.dating_1on1_cards
set
  status = 'rejected',
  reviewed_at = now(),
  updated_at = now()
where status in ('submitted', 'reviewing', 'approved')
  and created_at < (now() - interval '30 days');

commit;

notify pgrst, 'reload schema';

