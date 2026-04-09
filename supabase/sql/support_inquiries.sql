begin;

create table if not exists public.support_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  category text not null check (category in ('payment', 'dating', 'abuse', 'account', 'technical', 'other')),
  subject text not null check (char_length(subject) between 1 and 120),
  message text not null check (char_length(message) between 1 and 4000),
  contact_email text null check (contact_email is null or char_length(contact_email) <= 200),
  contact_phone text null check (contact_phone is null or char_length(contact_phone) <= 30),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_reply text null check (admin_reply is null or char_length(admin_reply) <= 4000),
  answered_at timestamptz null,
  answered_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_inquiries_user_created
  on public.support_inquiries (user_id, created_at desc);

create index if not exists idx_support_inquiries_status_created
  on public.support_inquiries (status, created_at desc);

alter table public.support_inquiries enable row level security;

drop policy if exists "support_inquiries_select_own" on public.support_inquiries;
create policy "support_inquiries_select_own"
  on public.support_inquiries for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "support_inquiries_insert_own" on public.support_inquiries;
create policy "support_inquiries_insert_own"
  on public.support_inquiries for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "support_inquiries_admin_all" on public.support_inquiries;
create policy "support_inquiries_admin_all"
  on public.support_inquiries for all
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
