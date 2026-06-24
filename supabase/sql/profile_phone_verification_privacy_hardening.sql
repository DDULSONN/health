begin;

alter table if exists public.profile_phone_verification_attempts
  alter column phone_e164 drop not null;

alter table if exists public.profile_phone_verification_solapi_otps
  alter column phone_e164 drop not null;

update public.profile_phone_verification_attempts
set phone_e164 = null
where phone_e164 is not null;

update public.profile_phone_verification_solapi_otps
set phone_e164 = null
where phone_e164 is not null;

alter table public.profile_phone_verification_attempts enable row level security;
alter table public.profile_phone_verification_solapi_otps enable row level security;

revoke all on public.profile_phone_verification_attempts from anon, authenticated;
revoke all on public.profile_phone_verification_solapi_otps from anon, authenticated;

create index if not exists idx_profiles_phone_e164_verified
  on public.profiles(phone_e164)
  where phone_verified is true and phone_e164 is not null;

commit;

notify pgrst, 'reload schema';
