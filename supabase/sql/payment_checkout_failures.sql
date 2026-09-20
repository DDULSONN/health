begin;

-- Browser-reported diagnostics, NOT an authoritative payment ledger.
create table if not exists public.payment_checkout_failures (
  order_id uuid primary key references public.toss_test_payment_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_type text not null,
  provider_code text not null check (provider_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  outcome text not null check (outcome in ('user_canceled', 'failed')),
  source text not null default 'client_redirect' check (source = 'client_redirect'),
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_checkout_failures_created
  on public.payment_checkout_failures (created_at desc);

alter table public.payment_checkout_failures enable row level security;
revoke all on public.payment_checkout_failures from public, anon, authenticated;
grant select, insert, update, delete on public.payment_checkout_failures to service_role;

comment on table public.payment_checkout_failures is
  'Unverified client failure redirects; one row per order. Join payment orders for actual payment status. Does not identify the failing card issuer.';

commit;
notify pgrst, 'reload schema';
