begin;

create table if not exists public.profile_phone_verification_solapi_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text null,
  phone_hash text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  request_id text null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_profile_phone_verification_solapi_otps_user_phone_created
  on public.profile_phone_verification_solapi_otps(user_id, phone_hash, created_at desc);

create index if not exists idx_profile_phone_verification_solapi_otps_expires
  on public.profile_phone_verification_solapi_otps(expires_at);

alter table public.profile_phone_verification_solapi_otps enable row level security;
revoke all on public.profile_phone_verification_solapi_otps from anon, authenticated;

commit;

notify pgrst, 'reload schema';
