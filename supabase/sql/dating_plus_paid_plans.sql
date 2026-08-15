begin;

alter table public.toss_test_payment_orders
  drop constraint if exists toss_test_payment_orders_product_type_check;

alter table public.toss_test_payment_orders
  add constraint toss_test_payment_orders_product_type_check
  check (product_type in (
    'apply_credits',
    'paid_card',
    'more_view',
    'city_view',
    'one_on_one_contact_exchange',
    'one_on_one_priority_24h',
    'one_on_one_plus_7d',
    'one_on_one_plus_30d',
    'swipe_premium_30d',
    'dating_all_pass_30d',
    'love_fortune_detail',
    'account_unban'
  ));

commit;

notify pgrst, 'reload schema';
