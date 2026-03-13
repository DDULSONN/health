begin;

alter table public.profiles
  add column if not exists push_token text null;

create index if not exists idx_profiles_push_token
  on public.profiles (push_token)
  where push_token is not null;

commit;

notify pgrst, 'reload schema';
