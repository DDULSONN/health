-- Reels dating listings: admin-created lightweight application posts.

create table if not exists public.reels_dating_listings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  instagram_url text not null default '',
  status text not null default 'active' check (status in ('active', 'hidden')),
  sort_order integer not null default 0,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reels_dating_applications (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.reels_dating_listings(id) on delete cascade,
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  applicant_display_nickname text not null default '',
  age integer null,
  height_cm integer null,
  region text not null default '',
  job text not null default '',
  training_years integer null,
  instagram_id text not null default '',
  intro_text text not null default '',
  photo_path text null,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed', 'archived')),
  created_at timestamptz not null default now()
);

alter table public.reels_dating_applications
  add column if not exists photo_path text null;

alter table public.reels_dating_listings
  add column if not exists instagram_url text not null default '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reels-dating-application-photos',
  'reels-dating-application-photos',
  false,
  12582912,
  array['image/webp']
)
on conflict (id) do nothing;

create index if not exists idx_reels_dating_listings_status_sort
  on public.reels_dating_listings (status, sort_order desc, created_at desc);

create index if not exists idx_reels_dating_applications_listing_created
  on public.reels_dating_applications (listing_id, created_at desc);

create index if not exists idx_reels_dating_applications_user_created
  on public.reels_dating_applications (applicant_user_id, created_at desc);

create unique index if not exists uq_reels_dating_applications_listing_user
  on public.reels_dating_applications (listing_id, applicant_user_id);

alter table public.reels_dating_listings enable row level security;
alter table public.reels_dating_applications enable row level security;

drop policy if exists reels_dating_listings_public_read_active on public.reels_dating_listings;
create policy reels_dating_listings_public_read_active
  on public.reels_dating_listings for select
  using (status = 'active');

drop policy if exists reels_dating_listings_admin_all on public.reels_dating_listings;
create policy reels_dating_listings_admin_all
  on public.reels_dating_listings for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists reels_dating_applications_insert_own on public.reels_dating_applications;
create policy reels_dating_applications_insert_own
  on public.reels_dating_applications for insert
  with check (
    applicant_user_id = auth.uid()
    and exists (
      select 1 from public.reels_dating_listings l
      where l.id = listing_id and l.status = 'active'
    )
  );

drop policy if exists reels_dating_applications_select_own on public.reels_dating_applications;
create policy reels_dating_applications_select_own
  on public.reels_dating_applications for select
  using (applicant_user_id = auth.uid());

drop policy if exists reels_dating_applications_admin_all on public.reels_dating_applications;
create policy reels_dating_applications_admin_all
  on public.reels_dating_applications for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
