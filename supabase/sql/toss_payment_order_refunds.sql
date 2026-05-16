begin;

alter table public.toss_test_payment_orders
  add column if not exists canceled_at timestamptz null,
  add column if not exists cancel_reason text null,
  add column if not exists cancel_amount int null check (cancel_amount is null or cancel_amount >= 0),
  add column if not exists canceled_by_user_id uuid null references auth.users(id) on delete set null;

create index if not exists idx_toss_test_payment_orders_canceled_at
  on public.toss_test_payment_orders (canceled_at desc)
  where canceled_at is not null;

commit;

notify pgrst, 'reload schema';
