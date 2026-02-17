-- Open dating cards mode (v2)
-- - Card photos and apply photos are private
-- - Public list/detail only exposes blur thumbnail
-- - Daily apply limit (KST) is enforced in API layer

begin;

-- Storage buckets
insert into storage.buckets (id, name, public)
values ('dating-card-photos', 'dating-card-photos', false)
on conflict do nothing;

insert into storage.buckets (id, name, public)
values ('dating-apply-photos', 'dating-apply-photos', false)
on conflict do nothing;

-- dating_cards
create table if not exists public.dating_cards (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  sex text not null check (sex in ('male', 'female')),
  display_nickname text not null default '',
  age int check (age between 19 and 99),
  region text,
  height_cm int check (height_cm between 120 and 230),
  job text,
  training_years int check (training_years between 0 and 50),
  ideal_type text,
  instagram_id text not null check (instagram_id ~ '^[A-Za-z0-9._]{1,30}$'),
  photo_paths jsonb not null default '[]'::jsonb,
  blur_thumb_path text not null default '',
  total_3lift int,
  percent_all numeric,
  is_3lift_verified boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'public', 'expired', 'hidden')),
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.dating_cards add column if not exists display_nickname text;
alter table public.dating_cards add column if not exists instagram_id text;
alter table public.dating_cards add column if not exists photo_paths jsonb not null default '[]'::jsonb;
alter table public.dating_cards add column if not exists blur_thumb_path text;
alter table public.dating_cards add column if not exists published_at timestamptz;
alter table public.dating_cards add column if not exists expires_at timestamptz;

-- compatibility rename (old owner_instagram_id -> instagram_id)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='dating_cards' and column_name='owner_instagram_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='dating_cards' and column_name='instagram_id'
  ) then
    alter table public.dating_cards rename column owner_instagram_id to instagram_id;
  end if;
end $$;

-- compatibility rename (old photo_urls -> photo_paths)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='dating_cards' and column_name='photo_urls'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='dating_cards' and column_name='photo_paths'
  ) then
    alter table public.dating_cards rename column photo_urls to photo_paths;
  end if;
end $$;

alter table public.dating_cards
  alter column display_nickname set not null,
  alter column display_nickname set default '',
  alter column instagram_id set not null,
  alter column photo_paths set not null,
  alter column photo_paths set default '[]'::jsonb,
  alter column blur_thumb_path set not null,
  alter column blur_thumb_path set default '';

alter table public.dating_cards
  drop constraint if exists dating_cards_instagram_id_check;
alter table public.dating_cards
  add constraint dating_cards_instagram_id_check
  check (instagram_id ~ '^[A-Za-z0-9._]{1,30}$');

alter table public.dating_cards
  drop constraint if exists dating_cards_status_check;
alter table public.dating_cards
  add constraint dating_cards_status_check
  check (status in ('pending', 'public', 'expired', 'hidden'));

create index if not exists idx_dating_cards_public_slot
  on public.dating_cards (sex, status, expires_at);
create index if not exists idx_dating_cards_owner
  on public.dating_cards (owner_user_id, created_at desc);
create index if not exists idx_dating_cards_created
  on public.dating_cards (created_at desc);

-- dating_card_applications
create table if not exists public.dating_card_applications (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.dating_cards(id) on delete cascade,
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  applicant_display_nickname text not null default '',
  age int check (age between 19 and 99),
  height_cm int check (height_cm between 120 and 230),
  region text,
  job text,
  training_years int check (training_years between 0 and 50),
  intro_text text not null,
  instagram_id text not null check (instagram_id ~ '^[A-Za-z0-9._]{1,30}$'),
  photo_paths jsonb not null default '[]'::jsonb,
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'rejected', 'canceled')),
  created_at timestamptz not null default now(),
  unique (card_id, applicant_user_id)
);

alter table public.dating_card_applications add column if not exists applicant_display_nickname text not null default '';
alter table public.dating_card_applications add column if not exists photo_paths jsonb not null default '[]'::jsonb;

-- compatibility rename (old photo_urls -> photo_paths)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='dating_card_applications' and column_name='photo_urls'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='dating_card_applications' and column_name='photo_paths'
  ) then
    alter table public.dating_card_applications rename column photo_urls to photo_paths;
  end if;
end $$;

alter table public.dating_card_applications
  alter column applicant_display_nickname set not null,
  alter column applicant_display_nickname set default '',
  alter column intro_text set not null,
  alter column photo_paths set not null,
  alter column photo_paths set default '[]'::jsonb;

create index if not exists idx_dating_card_apps_card
  on public.dating_card_applications (card_id, created_at desc);
create index if not exists idx_dating_card_apps_applicant
  on public.dating_card_applications (applicant_user_id, created_at desc);
create index if not exists idx_dating_card_apps_status
  on public.dating_card_applications (status, created_at desc);

-- reports
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

-- cards policies
DROP POLICY if exists "dating_cards_public_select" on public.dating_cards;
create policy "dating_cards_public_select"
  on public.dating_cards for select
  to anon, authenticated
  using (status = 'public' and expires_at > now());

DROP POLICY if exists "dating_cards_owner_select" on public.dating_cards;
create policy "dating_cards_owner_select"
  on public.dating_cards for select
  to authenticated
  using (auth.uid() = owner_user_id);

DROP POLICY if exists "dating_cards_owner_insert" on public.dating_cards;
create policy "dating_cards_owner_insert"
  on public.dating_cards for insert
  to authenticated
  with check (auth.uid() = owner_user_id);

DROP POLICY if exists "dating_cards_owner_update" on public.dating_cards;
create policy "dating_cards_owner_update"
  on public.dating_cards for update
  to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

DROP POLICY if exists "dating_cards_admin_all" on public.dating_cards;
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

-- application policies
DROP POLICY if exists "dating_card_apps_applicant_select" on public.dating_card_applications;
create policy "dating_card_apps_applicant_select"
  on public.dating_card_applications for select
  to authenticated
  using (auth.uid() = applicant_user_id);

DROP POLICY if exists "dating_card_apps_owner_select" on public.dating_card_applications;
create policy "dating_card_apps_owner_select"
  on public.dating_card_applications for select
  to authenticated
  using (
    exists (
      select 1 from public.dating_cards c
      where c.id = card_id and c.owner_user_id = auth.uid()
    )
  );

DROP POLICY if exists "dating_card_apps_applicant_insert" on public.dating_card_applications;
create policy "dating_card_apps_applicant_insert"
  on public.dating_card_applications for insert
  to authenticated
  with check (
    auth.uid() = applicant_user_id
    and exists (
      select 1 from public.dating_cards c
      where c.id = card_id
        and c.status = 'public'
        and c.expires_at > now()
        and c.owner_user_id <> auth.uid()
    )
  );

DROP POLICY if exists "dating_card_apps_applicant_cancel" on public.dating_card_applications;
create policy "dating_card_apps_applicant_cancel"
  on public.dating_card_applications for update
  to authenticated
  using (auth.uid() = applicant_user_id)
  with check (auth.uid() = applicant_user_id and status = 'canceled');

DROP POLICY if exists "dating_card_apps_owner_update" on public.dating_card_applications;
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

DROP POLICY if exists "dating_card_apps_admin_all" on public.dating_card_applications;
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

-- report policies
DROP POLICY if exists "dating_card_reports_insert_own" on public.dating_card_reports;
create policy "dating_card_reports_insert_own"
  on public.dating_card_reports for insert
  to authenticated
  with check (
    auth.uid() = reporter_user_id
    and exists (
      select 1 from public.dating_cards c
      where c.id = card_id and c.status = 'public' and c.expires_at > now()
    )
  );

DROP POLICY if exists "dating_card_reports_select_admin" on public.dating_card_reports;
create policy "dating_card_reports_select_admin"
  on public.dating_card_reports for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

DROP POLICY if exists "dating_card_reports_update_admin" on public.dating_card_reports;
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
