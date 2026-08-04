create extension if not exists pgcrypto;

create table if not exists public.app_test_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  play_email text not null,
  platform text not null default 'android',
  status text not null default 'pending',
  consented_at timestamptz not null default now(),
  invited_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_test_applications_user_unique unique (user_id),
  constraint app_test_applications_platform_check check (platform in ('android')),
  constraint app_test_applications_status_check check (status in ('pending', 'invited', 'testing', 'completed')),
  constraint app_test_applications_email_normalized_check check (play_email = lower(btrim(play_email))),
  constraint app_test_applications_email_length_check check (char_length(play_email) between 3 and 254)
);

create unique index if not exists app_test_applications_play_email_unique
  on public.app_test_applications (lower(play_email));

create index if not exists app_test_applications_status_created_idx
  on public.app_test_applications (status, created_at desc);

create table if not exists public.app_test_feedback (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.app_test_applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'general',
  message text not null,
  device_model text,
  app_version text,
  created_at timestamptz not null default now(),
  constraint app_test_feedback_category_check check (category in ('general', 'bug', 'usability', 'payment', 'other')),
  constraint app_test_feedback_message_length_check check (char_length(message) between 5 and 2000),
  constraint app_test_feedback_device_length_check check (device_model is null or char_length(device_model) <= 100),
  constraint app_test_feedback_version_length_check check (app_version is null or char_length(app_version) <= 50)
);

create index if not exists app_test_feedback_application_created_idx
  on public.app_test_feedback (application_id, created_at desc);

create index if not exists app_test_feedback_user_created_idx
  on public.app_test_feedback (user_id, created_at desc);

alter table public.app_test_applications enable row level security;
alter table public.app_test_feedback enable row level security;

revoke all on public.app_test_applications from anon, authenticated;
revoke all on public.app_test_feedback from anon, authenticated;

