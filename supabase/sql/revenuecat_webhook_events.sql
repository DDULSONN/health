begin;

create table if not exists public.revenuecat_webhook_events (
  event_id text primary key,
  event_type text not null,
  app_user_id text null,
  product_id text null,
  status text not null default 'processing' check (status in ('processing', 'fulfilled', 'ignored', 'failed')),
  raw_payload jsonb null,
  note text null,
  created_at timestamptz not null default now(),
  processed_at timestamptz null
);

create index if not exists idx_revenuecat_webhook_events_created
  on public.revenuecat_webhook_events (created_at desc);

create index if not exists idx_revenuecat_webhook_events_status_created
  on public.revenuecat_webhook_events (status, created_at desc);

alter table public.revenuecat_webhook_events enable row level security;

drop policy if exists "revenuecat_webhook_events_admin_all" on public.revenuecat_webhook_events;
create policy "revenuecat_webhook_events_admin_all"
  on public.revenuecat_webhook_events for all
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
