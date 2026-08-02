-- Give a designated listing owner temporary access to reel applications.

alter table public.reels_dating_listings
  add column if not exists viewer_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists viewer_access_expires_at timestamptz null;

create index if not exists idx_reels_dating_listings_viewer_access
  on public.reels_dating_listings (viewer_user_id, viewer_access_expires_at desc)
  where viewer_user_id is not null;
