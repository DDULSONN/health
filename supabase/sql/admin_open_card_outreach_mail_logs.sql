begin;

create table if not exists public.admin_open_card_outreach_mail_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null default 'open_card_outreach',
  user_id uuid not null references auth.users(id) on delete cascade,
  email text null,
  subject text not null,
  success boolean not null default false,
  provider text not null default 'resend',
  provider_status integer null,
  provider_error text null,
  sent_at timestamptz not null default timezone('utc', now()),
  admin_user_id uuid null references auth.users(id) on delete set null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_admin_open_card_outreach_mail_logs_user_sent_at
  on public.admin_open_card_outreach_mail_logs(user_id, sent_at desc);

create index if not exists idx_admin_open_card_outreach_mail_logs_success_sent_at
  on public.admin_open_card_outreach_mail_logs(success, sent_at desc);

create index if not exists idx_admin_open_card_outreach_mail_logs_campaign_sent_at
  on public.admin_open_card_outreach_mail_logs(campaign_key, sent_at desc);

commit;

notify pgrst, 'reload schema';
