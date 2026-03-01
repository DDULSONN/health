alter table public.profiles
  add column if not exists swipe_profile_visible boolean not null default true;

create index if not exists idx_profiles_swipe_profile_visible
  on public.profiles (swipe_profile_visible);
