-- 1:1 priority recommendation boost.
-- Run this in Supabase SQL editor before enabling purchases in production.

alter table public.dating_1on1_cards
  add column if not exists priority_boost_expires_at timestamptz;

create index if not exists idx_dating_1on1_cards_priority_boost
  on public.dating_1on1_cards (priority_boost_expires_at desc)
  where priority_boost_expires_at is not null;

alter table public.toss_test_payment_orders
  drop constraint if exists toss_test_payment_orders_product_type_check;

alter table public.toss_test_payment_orders
  add constraint toss_test_payment_orders_product_type_check
  check (
    product_type in (
      'apply_credits',
      'paid_card',
      'more_view',
      'city_view',
      'one_on_one_contact_exchange',
      'one_on_one_priority_24h',
      'swipe_premium_30d',
      'love_fortune_detail'
    )
  );
