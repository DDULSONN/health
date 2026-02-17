-- Public dating cards mode:
-- - cards are public after admin approval
-- - users apply to a card with private photos + instagram
-- - card owner accepts/rejects, and instagram IDs are revealed only after acceptance

begin;

create table if not exists public.dating_cards (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  sex text not null check (sex in ('male', 'female')),
  age int check (age between 19 and 99),
  region text,
  height_cm int check (height_cm between 120 and 230),
  job text,
  training_years int check (training_years between 0 and 50),
  ideal_type text,
  owner_instagram_id text check (owner_instagram_id is null or owner_instagram_id ~ '^[A-Za-z0-9._]{1,30}$'),
  total_3lift int,
  percent_all numeric,
  is_3lift_verified boolean not null default false,
  blur_thumb_path text,
  status text not null default 'pending' check (status in ('pending', 'public', 'hidden')),
  created_at timestamptz not null default now()
);

create index if not exists idx_dating_cards_status_created
  on public.dating_cards (status, created_at desc);
create index if not exists idx_dating_cards_owner
  on public.dating_cards (owner_user_id, created_at desc);

create table if not exists public.dating_card_applications (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.dating_cards(id) on delete cascade,
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  age int check (age between 19 and 99),
  height_cm int check (height_cm between 120 and 230),
  region text,
  job text,
  training_years int check (training_years between 0 and 50),
  intro_text text,
  instagram_id text not null check (instagram_id ~ '^[A-Za-z0-9._]{1,30}$'),
  photo_urls jsonb not null default '[]'::jsonb,
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'rejected', 'canceled')),
  created_at timestamptz not null default now(),
  unique (card_id, applicant_user_id)
);

create index if not exists idx_dating_card_apps_card
  on public.dating_card_applications (card_id, created_at desc);
create index if not exists idx_dating_card_apps_applicant
  on public.dating_card_applications (applicant_user_id, created_at desc);
create index if not exists idx_dating_card_apps_status
  on public.dating_card_applications (status, created_at desc);

create table if not exists public.dating_card_reports (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.dating_cards(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (length(reason) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (card_id, reporter_user_id)
);

create index if not exists idx_dating_card_reports_status
  on public.dating_card_reports (status, created_at desc);

alter table public.dating_cards enable row level security;
alter table public.dating_card_applications enable row level security;
alter table public.dating_card_reports enable row level security;

-- dating_cards policies
drop policy if exists "dating_cards_public_select" on public.dating_cards;
create policy "dating_cards_public_select"
  on public.dating_cards for select
  to authenticated
  using (status = 'public');

drop policy if exists "dating_cards_owner_select" on public.dating_cards;
create policy "dating_cards_owner_select"
  on public.dating_cards for select
  to authenticated
  using (auth.uid() = owner_user_id);

drop policy if exists "dating_cards_owner_insert" on public.dating_cards;
create policy "dating_cards_owner_insert"
  on public.dating_cards for insert
  to authenticated
  with check (auth.uid() = owner_user_id);

drop policy if exists "dating_cards_owner_update" on public.dating_cards;
create policy "dating_cards_owner_update"
  on public.dating_cards for update
  to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists "dating_cards_admin_all" on public.dating_cards;
create policy "dating_cards_admin_all"
  on public.dating_cards for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- dating_card_applications policies
drop policy if exists "dating_card_apps_applicant_select" on public.dating_card_applications;
create policy "dating_card_apps_applicant_select"
  on public.dating_card_applications for select
  to authenticated
  using (auth.uid() = applicant_user_id);

drop policy if exists "dating_card_apps_owner_select" on public.dating_card_applications;
create policy "dating_card_apps_owner_select"
  on public.dating_card_applications for select
  to authenticated
  using (
    exists (
      select 1 from public.dating_cards c
      where c.id = card_id and c.owner_user_id = auth.uid()
    )
  );

drop policy if exists "dating_card_apps_applicant_insert" on public.dating_card_applications;
create policy "dating_card_apps_applicant_insert"
  on public.dating_card_applications for insert
  to authenticated
  with check (
    auth.uid() = applicant_user_id
    and exists (
      select 1 from public.dating_cards c
      where c.id = card_id
        and c.status = 'public'
        and c.owner_user_id <> auth.uid()
    )
  );

drop policy if exists "dating_card_apps_applicant_cancel" on public.dating_card_applications;
create policy "dating_card_apps_applicant_cancel"
  on public.dating_card_applications for update
  to authenticated
  using (auth.uid() = applicant_user_id)
  with check (auth.uid() = applicant_user_id and status = 'canceled');

drop policy if exists "dating_card_apps_owner_update" on public.dating_card_applications;
create policy "dating_card_apps_owner_update"
  on public.dating_card_applications for update
  to authenticated
  using (
    exists (
      select 1 from public.dating_cards c
      where c.id = card_id and c.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.dating_cards c
      where c.id = card_id and c.owner_user_id = auth.uid()
    )
    and status in ('accepted', 'rejected')
  );

drop policy if exists "dating_card_apps_admin_all" on public.dating_card_applications;
create policy "dating_card_apps_admin_all"
  on public.dating_card_applications for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- dating_card_reports policies
drop policy if exists "dating_card_reports_insert_own" on public.dating_card_reports;
create policy "dating_card_reports_insert_own"
  on public.dating_card_reports for insert
  to authenticated
  with check (
    auth.uid() = reporter_user_id
    and exists (
      select 1 from public.dating_cards c
      where c.id = card_id and c.status = 'public'
    )
  );

drop policy if exists "dating_card_reports_select_admin" on public.dating_card_reports;
create policy "dating_card_reports_select_admin"
  on public.dating_card_reports for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "dating_card_reports_update_admin" on public.dating_card_reports;
create policy "dating_card_reports_update_admin"
  on public.dating_card_reports for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

commit;
