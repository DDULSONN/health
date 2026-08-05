begin;

create table if not exists public.app_purchase_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  store text not null check (store in ('app_store', 'play_store')),
  user_id uuid null references auth.users(id) on delete set null,
  product_id text not null,
  purchase_token text null,
  transaction_id text null,
  original_transaction_id text null,
  status text not null default 'processing' check (status in ('processing', 'fulfilled', 'failed', 'ignored')),
  verified boolean not null default false,
  context_json jsonb not null default '{}'::jsonb,
  verification_json jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  note text null,
  fulfilled_at timestamptz null,
  processed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_purchase_events_user_created
  on public.app_purchase_events (user_id, created_at desc);

create index if not exists idx_app_purchase_events_status_created
  on public.app_purchase_events (status, created_at desc);

create index if not exists idx_app_purchase_events_product_created
  on public.app_purchase_events (product_id, created_at desc);

alter table public.app_purchase_events enable row level security;

drop policy if exists "app_purchase_events_admin_all" on public.app_purchase_events;
create policy "app_purchase_events_admin_all"
  on public.app_purchase_events for all
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
