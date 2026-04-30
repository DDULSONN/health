begin;

create table if not exists public.toss_test_payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_type text not null check (product_type in ('apply_credits', 'paid_card', 'more_view')),
  product_ref_id uuid null,
  product_meta jsonb not null default '{}'::jsonb,
  toss_order_id text not null unique,
  order_name text not null,
  amount int not null check (amount > 0),
  status text not null default 'ready' check (status in ('ready', 'paid', 'failed', 'canceled')),
  payment_key text null,
  approved_at timestamptz null,
  raw_response jsonb null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_toss_test_payment_orders_user_created
  on public.toss_test_payment_orders (user_id, created_at desc);

create index if not exists idx_toss_test_payment_orders_status_created
  on public.toss_test_payment_orders (status, created_at desc);

alter table public.toss_test_payment_orders enable row level security;

drop policy if exists "toss_test_payment_orders_select_own" on public.toss_test_payment_orders;
create policy "toss_test_payment_orders_select_own"
  on public.toss_test_payment_orders for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "toss_test_payment_orders_insert_own" on public.toss_test_payment_orders;
create policy "toss_test_payment_orders_insert_own"
  on public.toss_test_payment_orders for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "toss_test_payment_orders_admin_all" on public.toss_test_payment_orders;
create policy "toss_test_payment_orders_admin_all"
  on public.toss_test_payment_orders for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
