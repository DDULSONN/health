begin;

alter table public.profiles
  add column if not exists phone_verified boolean not null default false,
  add column if not exists phone_e164 text null,
  add column if not exists phone_verified_at timestamptz null;

create index if not exists idx_profiles_phone_verified
  on public.profiles (phone_verified);

commit;

notify pgrst, 'reload schema';

