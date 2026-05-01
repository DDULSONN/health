begin;

alter table public.toss_test_payment_orders
  drop constraint if exists toss_test_payment_orders_product_type_check;

alter table public.toss_test_payment_orders
  add constraint toss_test_payment_orders_product_type_check
  check (product_type in ('apply_credits', 'paid_card', 'more_view', 'one_on_one_contact_exchange'));

alter table public.toss_test_payment_orders
  add column if not exists product_meta jsonb not null default '{}'::jsonb;

commit;

notify pgrst, 'reload schema';
