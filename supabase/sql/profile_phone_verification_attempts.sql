begin;

create table if not exists public.profile_phone_verification_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
  phone_e164 text null,
  phone_hash text null,
  action text not null check (action in ('send', 'verify', 'sync', 'manual')),
  status text not null check (status in ('queued', 'success', 'fail', 'blocked')),
  provider text not null default 'supabase_auth',
  provider_error text null,
  request_id text null,
  ip_hash text null,
  retry_after_sec integer null,
  created_at timestamptz not null default timezone('utc', now()),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_profile_phone_verification_attempts_user_created_at
  on public.profile_phone_verification_attempts(user_id, created_at desc);

create index if not exists idx_profile_phone_verification_attempts_phone_hash_created_at
  on public.profile_phone_verification_attempts(phone_hash, created_at desc);

create index if not exists idx_profile_phone_verification_attempts_action_status_created_at
  on public.profile_phone_verification_attempts(action, status, created_at desc);

commit;

notify pgrst, 'reload schema';
