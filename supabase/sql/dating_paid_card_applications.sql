-- Paid dating card applications (support multi-accept, no card auto-hide)

begin;

create table if not exists public.dating_paid_card_applications (
  id uuid primary key default gen_random_uuid(),
  paid_card_id uuid not null references public.dating_paid_cards(id) on delete cascade,
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  applicant_display_nickname text not null default '',
  age int check (age between 19 and 99),
  height_cm int check (height_cm between 120 and 230),
  region text,
  job text,
  training_years int check (training_years between 0 and 50),
  intro_text text not null,
  instagram_id text not null check (instagram_id ~ '^[A-Za-z0-9._]{1,30}$'),
  photo_paths text[] not null default '{}',
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'rejected', 'canceled')),
  created_at timestamptz not null default now(),
  unique (paid_card_id, applicant_user_id)
);

create index if not exists idx_dating_paid_apps_card
  on public.dating_paid_card_applications (paid_card_id, created_at desc);
create index if not exists idx_dating_paid_apps_applicant
  on public.dating_paid_card_applications (applicant_user_id, created_at desc);
create index if not exists idx_dating_paid_apps_status
  on public.dating_paid_card_applications (status, created_at desc);

alter table public.dating_paid_card_applications enable row level security;

drop policy if exists "dating_paid_apps_applicant_insert" on public.dating_paid_card_applications;
create policy "dating_paid_apps_applicant_insert"
  on public.dating_paid_card_applications for insert
  to authenticated
  with check (
    auth.uid() = applicant_user_id
    and exists (
      select 1
      from public.dating_paid_cards c
      where c.id = paid_card_id
        and c.status = 'approved'
        and c.expires_at > now()
        and c.user_id <> auth.uid()
    )
  );

drop policy if exists "dating_paid_apps_applicant_select" on public.dating_paid_card_applications;
create policy "dating_paid_apps_applicant_select"
  on public.dating_paid_card_applications for select
  to authenticated
  using (auth.uid() = applicant_user_id);

drop policy if exists "dating_paid_apps_owner_select" on public.dating_paid_card_applications;
create policy "dating_paid_apps_owner_select"
  on public.dating_paid_card_applications for select
  to authenticated
  using (
    exists (
      select 1
      from public.dating_paid_cards c
      where c.id = paid_card_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "dating_paid_apps_applicant_cancel" on public.dating_paid_card_applications;
create policy "dating_paid_apps_applicant_cancel"
  on public.dating_paid_card_applications for update
  to authenticated
  using (auth.uid() = applicant_user_id)
  with check (auth.uid() = applicant_user_id and status = 'canceled');

drop policy if exists "dating_paid_apps_owner_update" on public.dating_paid_card_applications;
create policy "dating_paid_apps_owner_update"
  on public.dating_paid_card_applications for update
  to authenticated
  using (
    exists (
      select 1
      from public.dating_paid_cards c
      where c.id = paid_card_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.dating_paid_cards c
      where c.id = paid_card_id
        and c.user_id = auth.uid()
    )
    and status in ('accepted', 'rejected')
  );

drop policy if exists "dating_paid_apps_admin_all" on public.dating_paid_card_applications;
create policy "dating_paid_apps_admin_all"
  on public.dating_paid_card_applications for all
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
