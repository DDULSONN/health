begin;

alter table public.dating_swipe_subscription_requests
  add column if not exists source_store text null,
  add column if not exists product_id text null,
  add column if not exists original_transaction_id text null,
  add column if not exists latest_transaction_id text null,
  add column if not exists source_event_signed_at timestamptz null;

alter table public.dating_swipe_subscription_requests
  drop constraint if exists dating_swipe_subscription_source_store_check;

alter table public.dating_swipe_subscription_requests
  add constraint dating_swipe_subscription_source_store_check
  check (source_store is null or source_store in ('app_store', 'play_store'));

create unique index if not exists uq_dating_swipe_subscription_store_original_transaction
  on public.dating_swipe_subscription_requests (source_store, original_transaction_id)
  where source_store is not null and original_transaction_id is not null;

create index if not exists idx_dating_swipe_subscription_latest_transaction
  on public.dating_swipe_subscription_requests (latest_transaction_id)
  where latest_transaction_id is not null;

commit;

notify pgrst, 'reload schema';
