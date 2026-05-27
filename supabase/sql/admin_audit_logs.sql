create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid null,
  admin_email text null,
  action text not null,
  target_type text null,
  target_id text null,
  request_id text null,
  ip_hash text null,
  user_agent_hash text null,
  status text not null default 'success',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_logs_status_check check (status in ('success', 'failure'))
);

create index if not exists idx_admin_audit_logs_created_at
  on public.admin_audit_logs (created_at desc);

create index if not exists idx_admin_audit_logs_admin_created_at
  on public.admin_audit_logs (admin_user_id, created_at desc);

create index if not exists idx_admin_audit_logs_action_created_at
  on public.admin_audit_logs (action, created_at desc);

alter table public.admin_audit_logs enable row level security;

drop policy if exists "admin_audit_logs_admin_select" on public.admin_audit_logs;
create policy "admin_audit_logs_admin_select"
  on public.admin_audit_logs for select
  using (
    auth.uid() in (
      select p.user_id
      from public.profiles p
      where p.role = 'admin'
    )
  );

