begin;

create table if not exists public.love_fortune_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'pending_payment', 'paid', 'generated', 'refunded', 'canceled')),
  calendar_type text not null default 'solar'
    check (calendar_type in ('solar', 'lunar', 'lunar_leap')),
  birth_date date not null,
  birth_time text not null default 'unknown',
  birth_time_certainty text not null default 'unknown'
    check (birth_time_certainty in ('exact', 'about', 'unknown')),
  birth_place text null,
  gender text not null default 'other'
    check (gender in ('female', 'male', 'other')),
  love_state text null,
  relationship_goal text null,
  meeting_preference text null,
  focus text null,
  concern text null,
  partner_birth_date date null,
  partner_birth_time text null,
  partner_relation text null,
  amount integer not null default 4900,
  ai_model text null,
  preview_result jsonb not null default '{}'::jsonb,
  ai_result text null,
  ideal_face_profile jsonb not null default '{}'::jsonb,
  ideal_face_prompt text null,
  ideal_face_image_url text null,
  payment_order_id uuid null references public.toss_test_payment_orders(id) on delete set null,
  paid_at timestamptz null,
  generated_at timestamptz null,
  refunded_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_love_fortune_readings_user_created
  on public.love_fortune_readings(user_id, created_at desc);

create index if not exists idx_love_fortune_readings_status_created
  on public.love_fortune_readings(status, created_at desc);

alter table public.love_fortune_readings
  add column if not exists birth_time_certainty text not null default 'unknown';

alter table public.love_fortune_readings
  add column if not exists birth_place text null;

alter table public.love_fortune_readings
  add column if not exists relationship_goal text null;

alter table public.love_fortune_readings
  add column if not exists meeting_preference text null;

alter table public.love_fortune_readings
  add column if not exists partner_birth_time text null;

alter table public.love_fortune_readings
  add column if not exists partner_relation text null;

alter table public.love_fortune_readings
  add column if not exists ideal_face_profile jsonb not null default '{}'::jsonb;

alter table public.love_fortune_readings
  add column if not exists ideal_face_prompt text null;

alter table public.love_fortune_readings
  add column if not exists ideal_face_image_url text null;

alter table public.love_fortune_readings
  drop constraint if exists love_fortune_readings_birth_time_certainty_check;

alter table public.love_fortune_readings
  add constraint love_fortune_readings_birth_time_certainty_check
  check (birth_time_certainty in ('exact', 'about', 'unknown'));

alter table public.love_fortune_readings enable row level security;

drop policy if exists "love_fortune_select_own" on public.love_fortune_readings;
create policy "love_fortune_select_own"
  on public.love_fortune_readings
  for select
  using (auth.uid() = user_id);

drop policy if exists "love_fortune_insert_own" on public.love_fortune_readings;
create policy "love_fortune_insert_own"
  on public.love_fortune_readings
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "love_fortune_update_own_draft" on public.love_fortune_readings;
create policy "love_fortune_update_own_draft"
  on public.love_fortune_readings
  for update
  using (auth.uid() = user_id and status in ('draft', 'pending_payment'))
  with check (auth.uid() = user_id and status in ('draft', 'pending_payment'));

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
    'swipe_premium_30d',
    'love_fortune_detail'
  ));

alter table public.toss_test_payment_orders
  add column if not exists product_meta jsonb not null default '{}'::jsonb;

commit;

notify pgrst, 'reload schema';
