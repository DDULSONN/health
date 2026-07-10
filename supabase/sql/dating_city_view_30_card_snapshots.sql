-- Convert nearby ideal access to a fixed 30-card snapshot per province grant.
alter table public.dating_city_view_requests
  add column if not exists snapshot_card_ids uuid[] not null default '{}';

alter table public.dating_city_view_requests
  add column if not exists snapshot_seen_card_ids uuid[] not null default '{}';
