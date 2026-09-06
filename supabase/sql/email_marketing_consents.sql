-- Apply before deploying the optional signup consent UI. No existing members are opted in.
begin;
create table if not exists public.email_marketing_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consented boolean not null default false,
  selected_at timestamptz not null,
  consented_at timestamptz,
  wording_version text not null,
  wording text not null,
  source text not null,
  recorded_at timestamptz not null default now(),
  check ((consented and consented_at is not null) or (not consented and consented_at is null))
);
alter table public.email_marketing_consents enable row level security;
revoke all on public.email_marketing_consents from anon, authenticated;
grant select, insert, update, delete on public.email_marketing_consents to service_role;
commit;
notify pgrst, 'reload schema';
