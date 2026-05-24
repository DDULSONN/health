begin;

create table if not exists public.dating_user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null
    check (target_type in (
      'open_card_application',
      'paid_card_application',
      'one_on_one_card',
      'one_on_one_match'
    )),
  target_id uuid not null,
  target_card_id uuid null,
  reason text not null check (char_length(reason) between 1 and 1000),
  evidence_snapshot jsonb not null default '{}'::jsonb,
  evidence_preserved_at timestamptz null,
  admin_note text null,
  action_type text not null default 'none'
    check (action_type in (
      'none',
      'evidence_preserved',
      'temporarily_hidden',
      'warning',
      'banned',
      'restored'
    )),
  action_note text null,
  actioned_at timestamptz null,
  actioned_by_user_id uuid null references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default timezone('utc', now()),
  reviewed_at timestamptz null,
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  unique (reporter_user_id, target_type, target_id)
);

create index if not exists idx_dating_user_reports_status_created
  on public.dating_user_reports(status, created_at desc);

create index if not exists idx_dating_user_reports_reported_user
  on public.dating_user_reports(reported_user_id, created_at desc);

create index if not exists idx_dating_user_reports_target
  on public.dating_user_reports(target_type, target_id);

create index if not exists idx_dating_user_reports_action_type_created
  on public.dating_user_reports(action_type, created_at desc);

alter table public.dating_user_reports
  add column if not exists evidence_snapshot jsonb not null default '{}'::jsonb;

alter table public.dating_user_reports
  add column if not exists evidence_preserved_at timestamptz null;

alter table public.dating_user_reports
  add column if not exists admin_note text null;

alter table public.dating_user_reports
  add column if not exists action_type text not null default 'none';

alter table public.dating_user_reports
  add column if not exists action_note text null;

alter table public.dating_user_reports
  add column if not exists actioned_at timestamptz null;

alter table public.dating_user_reports
  add column if not exists actioned_by_user_id uuid null references auth.users(id) on delete set null;

alter table public.dating_user_reports
  drop constraint if exists dating_user_reports_action_type_check;

alter table public.dating_user_reports
  add constraint dating_user_reports_action_type_check
  check (action_type in (
    'none',
    'evidence_preserved',
    'temporarily_hidden',
    'warning',
    'banned',
    'restored'
  ));

alter table public.dating_user_reports enable row level security;

drop policy if exists "dating_user_reports_insert_own" on public.dating_user_reports;
create policy "dating_user_reports_insert_own"
  on public.dating_user_reports
  for insert
  to authenticated
  with check (auth.uid() = reporter_user_id);

drop policy if exists "dating_user_reports_select_own" on public.dating_user_reports;
create policy "dating_user_reports_select_own"
  on public.dating_user_reports
  for select
  to authenticated
  using (auth.uid() = reporter_user_id);

drop policy if exists "dating_user_reports_admin_all" on public.dating_user_reports;
create policy "dating_user_reports_admin_all"
  on public.dating_user_reports
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
