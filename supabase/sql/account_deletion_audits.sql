begin;

create table if not exists public.account_deletion_audits (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  nickname text null,
  email_masked text null,
  email_hash text null,
  ip_address text null,
  user_agent text null,
  deletion_mode text not null check (deletion_mode in ('hard', 'soft')),
  initiated_by_user_id uuid null references auth.users(id) on delete set null,
  initiated_by_role text not null default 'self' check (initiated_by_role in ('self', 'admin')),
  deleted_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '90 days')
);

alter table public.account_deletion_audits
  add column if not exists initiated_by_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists initiated_by_role text not null default 'self';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'account_deletion_audits_initiated_by_role_check'
  ) then
    alter table public.account_deletion_audits
      add constraint account_deletion_audits_initiated_by_role_check
      check (initiated_by_role in ('self', 'admin'));
  end if;
end $$;

create index if not exists idx_account_deletion_audits_deleted_at
  on public.account_deletion_audits (deleted_at desc);

create index if not exists idx_account_deletion_audits_auth_user_id
  on public.account_deletion_audits (auth_user_id, deleted_at desc);

create index if not exists idx_account_deletion_audits_retention_until
  on public.account_deletion_audits (retention_until);

alter table public.account_deletion_audits enable row level security;

drop policy if exists "account_deletion_audits_admin_select" on public.account_deletion_audits;
create policy "account_deletion_audits_admin_select"
  on public.account_deletion_audits for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
