-- Optional server-confirm diagnostics, separate from the financial ledger and
-- untrusted checkout redirects. An event does not mean a payment was unpaid:
-- always join the current order status before investigating a failed payment.
begin;
create table if not exists public.payment_confirmation_failures (
  order_id uuid primary key references public.toss_test_payment_orders(id) on delete cascade,
  product_type text not null,
  provider_code text not null check (provider_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  created_at timestamptz not null default now()
);
create index if not exists payment_confirmation_failures_created_at_idx
  on public.payment_confirmation_failures (created_at desc);
alter table public.payment_confirmation_failures enable row level security;
revoke all on public.payment_confirmation_failures from public, anon, authenticated;
grant select, insert, update, delete on public.payment_confirmation_failures to service_role;
comment on table public.payment_confirmation_failures is
  'First unresolved server confirmation error per order; diagnostic only, not payment status. No contacts, payment keys or provider text.';
commit;
