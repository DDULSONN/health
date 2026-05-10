begin;

create table if not exists public.gym_classes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  host_name text not null,
  host_type text not null default 'trainer'
    check (host_type in ('trainer', 'gym', 'brand', 'individual', 'other')),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'closed', 'canceled')),
  summary text null,
  description text null,
  region text null,
  venue text null,
  price_text text null,
  capacity integer null check (capacity is null or capacity > 0),
  application_deadline timestamptz null,
  contact_url text null,
  cover_image_url text null,
  preparation_note text null,
  admin_note text null,
  operator_id uuid null,
  is_featured boolean not null default false,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gym_class_operator_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  applicant_name text not null,
  email text null,
  phone text null,
  host_name text not null,
  host_type text not null default 'trainer'
    check (host_type in ('trainer', 'gym', 'brand', 'individual', 'other')),
  region text null,
  intro text null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  admin_note text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gym_class_operators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  approved_request_id uuid null unique references public.gym_class_operator_requests(id) on delete set null,
  name text not null,
  email text null,
  phone text null,
  host_name text not null,
  host_type text not null default 'trainer'
    check (host_type in ('trainer', 'gym', 'brand', 'individual', 'other')),
  region text null,
  intro text null,
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  approved_by_user_id uuid null references auth.users(id) on delete set null,
  approved_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.gym_classes
  add column if not exists operator_id uuid null references public.gym_class_operators(id) on delete set null;

do $$
begin
  alter table public.gym_classes
    add constraint gym_classes_operator_id_fkey
    foreign key (operator_id) references public.gym_class_operators(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create table if not exists public.gym_class_schedules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.gym_classes(id) on delete cascade,
  label text null,
  starts_at timestamptz not null,
  ends_at timestamptz null,
  capacity integer null check (capacity is null or capacity > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gym_class_applications (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.gym_classes(id) on delete cascade,
  schedule_id uuid null references public.gym_class_schedules(id) on delete set null,
  applicant_user_id uuid null references auth.users(id) on delete set null,
  name text not null,
  phone text null,
  email text null,
  memo text null,
  status text not null default 'submitted'
    check (status in ('submitted', 'confirmed', 'canceled', 'attended', 'no_show')),
  admin_note text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_gym_classes_status_created_at
  on public.gym_classes(status, created_at desc);

create index if not exists idx_gym_classes_featured_created_at
  on public.gym_classes(is_featured, created_at desc);

create index if not exists idx_gym_classes_operator_created_at
  on public.gym_classes(operator_id, created_at desc);

create index if not exists idx_gym_class_operator_requests_status_created_at
  on public.gym_class_operator_requests(status, created_at desc);

create index if not exists idx_gym_class_operators_status_created_at
  on public.gym_class_operators(status, created_at desc);

create index if not exists idx_gym_class_schedules_class_sort
  on public.gym_class_schedules(class_id, sort_order, starts_at);

create index if not exists idx_gym_class_applications_class_created_at
  on public.gym_class_applications(class_id, created_at desc);

create index if not exists idx_gym_class_applications_status_created_at
  on public.gym_class_applications(status, created_at desc);

alter table public.gym_classes enable row level security;
alter table public.gym_class_operator_requests enable row level security;
alter table public.gym_class_operators enable row level security;
alter table public.gym_class_schedules enable row level security;
alter table public.gym_class_applications enable row level security;

drop policy if exists gym_classes_admin_all on public.gym_classes;
create policy gym_classes_admin_all
  on public.gym_classes
  for all
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

drop policy if exists gym_class_operator_requests_admin_all on public.gym_class_operator_requests;
create policy gym_class_operator_requests_admin_all
  on public.gym_class_operator_requests
  for all
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

drop policy if exists gym_class_operators_admin_all on public.gym_class_operators;
create policy gym_class_operators_admin_all
  on public.gym_class_operators
  for all
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

drop policy if exists gym_class_schedules_admin_all on public.gym_class_schedules;
create policy gym_class_schedules_admin_all
  on public.gym_class_schedules
  for all
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

drop policy if exists gym_class_applications_admin_all on public.gym_class_applications;
create policy gym_class_applications_admin_all
  on public.gym_class_applications
  for all
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
