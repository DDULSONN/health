begin;

create table if not exists public.admin_outreach_mail_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  subject text not null,
  body text not null,
  filters jsonb not null default '{}'::jsonb,
  recipients jsonb not null default '[]'::jsonb,
  total_count integer not null default 0,
  processed_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  failure_summary jsonb not null default '[]'::jsonb,
  first_failure text null,
  last_error text null,
  locked_at timestamptz null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  admin_user_id uuid null references auth.users(id) on delete set null
);

create index if not exists idx_admin_outreach_mail_jobs_status_created
  on public.admin_outreach_mail_jobs(status, created_at);

create index if not exists idx_admin_outreach_mail_jobs_campaign_created
  on public.admin_outreach_mail_jobs(campaign_key, created_at desc);

commit;

notify pgrst, 'reload schema';
