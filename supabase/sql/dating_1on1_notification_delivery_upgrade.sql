begin;

-- Additive notification-only migration. No matching, payment, phone or OTP rows change.
alter table public.dating_1on1_sms_deliveries
  drop constraint if exists dating_1on1_sms_deliveries_event_kind_check;
alter table public.dating_1on1_sms_deliveries
  add constraint dating_1on1_sms_deliveries_event_kind_check
  check (event_kind in ('selection_received', 'match_accepted'));

create table if not exists public.dating_1on1_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.dating_1on1_match_proposals(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_kind text not null check (event_kind in ('selection_pending_24h', 'mutual_pending_24h')),
  notification_day date not null default ((now() at time zone 'Asia/Seoul')::date),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_error text,
  constraint dating_1on1_reminder_event_unique unique (match_id, recipient_user_id, event_kind),
  constraint dating_1on1_reminder_daily_unique unique (recipient_user_id, notification_day)
);
alter table public.dating_1on1_reminder_deliveries enable row level security;
revoke all on public.dating_1on1_reminder_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.dating_1on1_reminder_deliveries to service_role;

create index if not exists idx_1on1_pending_selection_notification
  on public.dating_1on1_match_proposals (source_selected_at, id)
  where state = 'source_selected';

-- A rerun must not move the start time or notify historical/inactive accounts.
insert into public.site_settings (key, value_json)
values ('dating_1on1_reminder_delivery', jsonb_build_object('enabled', true, 'started_at', now()))
on conflict (key) do nothing;

commit;
