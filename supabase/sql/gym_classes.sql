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
  target_audience text null,
  service_process text null,
  curriculum text null,
  available_days text null,
  included_items text null,
  faq text null,
  expert_profile text null,
  purpose_tags text[] not null default '{}'::text[],
  region text null,
  venue text null,
  price_amount_krw integer null check (price_amount_krw is null or price_amount_krw >= 0),
  price_text text null,
  capacity integer null check (capacity is null or capacity > 0),
  male_capacity integer null check (male_capacity is null or male_capacity >= 0),
  female_capacity integer null check (female_capacity is null or female_capacity >= 0),
  min_participants integer null check (min_participants is null or min_participants > 0),
  application_deadline timestamptz null,
  contact_url text null,
  cover_image_url text null,
  preparation_note text null,
  refund_policy_text text null,
  refund_full_until_days integer not null default 3 check (refund_full_until_days >= 0),
  refund_half_until_days integer not null default 2 check (refund_half_until_days >= 0),
  no_refund_within_days integer not null default 1 check (no_refund_within_days >= 0),
  platform_fee_percent numeric(5,2) not null default 10 check (platform_fee_percent >= 0 and platform_fee_percent <= 100),
  settlement_status text not null default 'unsettled'
    check (settlement_status in ('unsettled', 'pending', 'settled', 'hold')),
  settlement_total_paid_krw integer not null default 0 check (settlement_total_paid_krw >= 0),
  settlement_platform_fee_krw integer not null default 0 check (settlement_platform_fee_krw >= 0),
  settlement_operator_amount_krw integer not null default 0 check (settlement_operator_amount_krw >= 0),
  settlement_note text null,
  settled_at timestamptz null,
  photo_consent_required boolean not null default false,
  safety_notice text null,
  admin_note text null,
  auto_closed_at timestamptz null,
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
  website_url text null,
  intro text null,
  desired_class_summary text null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  terms_version text null,
  terms_accepted_at timestamptz null,
  terms_accepted_ip text null,
  terms_accepted_user_agent text null,
  terms_payload jsonb not null default '{}'::jsonb,
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
  contact_url text null,
  intro text null,
  admin_note text null,
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  approved_by_user_id uuid null references auth.users(id) on delete set null,
  approved_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.gym_classes
  add column if not exists operator_id uuid null references public.gym_class_operators(id) on delete set null;

alter table public.gym_classes
  add column if not exists male_capacity integer null check (male_capacity is null or male_capacity >= 0),
  add column if not exists female_capacity integer null check (female_capacity is null or female_capacity >= 0),
  add column if not exists min_participants integer null check (min_participants is null or min_participants > 0),
  add column if not exists target_audience text null,
  add column if not exists service_process text null,
  add column if not exists curriculum text null,
  add column if not exists available_days text null,
  add column if not exists included_items text null,
  add column if not exists faq text null,
  add column if not exists expert_profile text null,
  add column if not exists purpose_tags text[] not null default '{}'::text[],
  add column if not exists price_amount_krw integer null check (price_amount_krw is null or price_amount_krw >= 0),
  add column if not exists refund_policy_text text null,
  add column if not exists refund_full_until_days integer not null default 3 check (refund_full_until_days >= 0),
  add column if not exists refund_half_until_days integer not null default 2 check (refund_half_until_days >= 0),
  add column if not exists no_refund_within_days integer not null default 1 check (no_refund_within_days >= 0),
  add column if not exists platform_fee_percent numeric(5,2) not null default 10 check (platform_fee_percent >= 0 and platform_fee_percent <= 100),
  add column if not exists settlement_status text not null default 'unsettled'
    check (settlement_status in ('unsettled', 'pending', 'settled', 'hold')),
  add column if not exists settlement_total_paid_krw integer not null default 0 check (settlement_total_paid_krw >= 0),
  add column if not exists settlement_platform_fee_krw integer not null default 0 check (settlement_platform_fee_krw >= 0),
  add column if not exists settlement_operator_amount_krw integer not null default 0 check (settlement_operator_amount_krw >= 0),
  add column if not exists settlement_note text null,
  add column if not exists settled_at timestamptz null,
  add column if not exists photo_consent_required boolean not null default false,
  add column if not exists safety_notice text null,
  add column if not exists auto_closed_at timestamptz null;

alter table public.gym_class_operator_requests
  add column if not exists website_url text null,
  add column if not exists desired_class_summary text null,
  add column if not exists terms_version text null,
  add column if not exists terms_accepted_at timestamptz null,
  add column if not exists terms_accepted_ip text null,
  add column if not exists terms_accepted_user_agent text null,
  add column if not exists terms_payload jsonb not null default '{}'::jsonb;

alter table public.gym_class_operators
  add column if not exists contact_url text null,
  add column if not exists admin_note text null;

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
  gender text null check (gender in ('male', 'female', 'other')),
  memo text null,
  status text not null default 'submitted'
    check (status in ('submitted', 'confirmed', 'canceled', 'attended', 'no_show')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'manual_paid', 'refunded', 'partial_refunded')),
  paid_amount_krw integer null check (paid_amount_krw is null or paid_amount_krw >= 0),
  paid_at timestamptz null,
  refund_status text not null default 'none'
    check (refund_status in ('none', 'requested', 'approved', 'rejected', 'refunded')),
  refund_requested_at timestamptz null,
  refund_reason text null,
  refund_amount_krw integer null check (refund_amount_krw is null or refund_amount_krw >= 0),
  refund_processed_at timestamptz null,
  refund_processed_by_user_id uuid null references auth.users(id) on delete set null,
  admin_note text null,
  operator_note text null,
  confirmed_at timestamptz null,
  canceled_at timestamptz null,
  terms_version text null,
  privacy_accepted_at timestamptz null,
  broker_notice_accepted_at timestamptz null,
  accepted_ip text null,
  accepted_user_agent text null,
  terms_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gym_class_refund_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.gym_class_applications(id) on delete cascade,
  class_id uuid not null references public.gym_classes(id) on delete cascade,
  requester_user_id uuid null references auth.users(id) on delete set null,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'refunded', 'canceled')),
  reason text null,
  calculated_refund_percent integer not null default 0 check (calculated_refund_percent >= 0 and calculated_refund_percent <= 100),
  requested_amount_krw integer null check (requested_amount_krw is null or requested_amount_krw >= 0),
  approved_amount_krw integer null check (approved_amount_krw is null or approved_amount_krw >= 0),
  admin_note text null,
  processed_by_user_id uuid null references auth.users(id) on delete set null,
  processed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gym_class_reviews (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.gym_classes(id) on delete cascade,
  application_id uuid null references public.gym_class_applications(id) on delete set null,
  reviewer_user_id uuid null references auth.users(id) on delete set null,
  rating integer not null check (rating >= 1 and rating <= 5),
  content text null,
  status text not null default 'visible'
    check (status in ('visible', 'hidden', 'reported')),
  admin_note text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gym_class_reports (
  id uuid primary key default gen_random_uuid(),
  class_id uuid null references public.gym_classes(id) on delete cascade,
  application_id uuid null references public.gym_class_applications(id) on delete set null,
  reporter_user_id uuid null references auth.users(id) on delete set null,
  category text not null default 'general'
    check (category in ('general', 'payment', 'refund', 'safety', 'host', 'participant', 'content')),
  content text not null,
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'resolved', 'rejected')),
  admin_note text null,
  resolved_by_user_id uuid null references auth.users(id) on delete set null,
  resolved_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gym_class_inquiries (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.gym_classes(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  name text null,
  email text null,
  phone text null,
  question text not null,
  answer text null,
  status text not null default 'open'
    check (status in ('open', 'answered', 'closed')),
  answered_by_user_id uuid null references auth.users(id) on delete set null,
  answered_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gym_class_waitlist (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.gym_classes(id) on delete cascade,
  schedule_id uuid null references public.gym_class_schedules(id) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  name text not null,
  phone text null,
  email text null,
  gender text null check (gender in ('male', 'female', 'other')),
  memo text null,
  status text not null default 'waiting'
    check (status in ('waiting', 'notified', 'converted', 'canceled')),
  notified_at timestamptz null,
  converted_application_id uuid null references public.gym_class_applications(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gym_class_notifications (
  id uuid primary key default gen_random_uuid(),
  class_id uuid null references public.gym_classes(id) on delete cascade,
  application_id uuid null references public.gym_class_applications(id) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  email text null,
  phone text null,
  kind text not null default 'class_notice'
    check (kind in ('application_submitted', 'payment_confirmed', 'refund_requested', 'refund_processed', 'waitlist_available', 'class_notice')),
  title text not null,
  body text null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'skipped', 'failed')),
  provider text null,
  provider_status integer null,
  provider_error text null,
  sent_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_gym_classes_status_created_at
  on public.gym_classes(status, created_at desc);

create index if not exists idx_gym_classes_featured_created_at
  on public.gym_classes(is_featured, created_at desc);

create index if not exists idx_gym_classes_operator_created_at
  on public.gym_classes(operator_id, created_at desc);

create index if not exists idx_gym_classes_region_price_status
  on public.gym_classes(status, region, price_amount_krw);

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

create index if not exists idx_gym_class_applications_class_gender_status
  on public.gym_class_applications(class_id, gender, status);

create index if not exists idx_gym_class_applications_refund_status_created_at
  on public.gym_class_applications(refund_status, created_at desc);

create index if not exists idx_gym_class_refund_requests_status_created_at
  on public.gym_class_refund_requests(status, created_at desc);

create index if not exists idx_gym_class_refund_requests_application_created_at
  on public.gym_class_refund_requests(application_id, created_at desc);

create index if not exists idx_gym_class_reviews_class_created_at
  on public.gym_class_reviews(class_id, created_at desc);

create index if not exists idx_gym_class_reports_status_created_at
  on public.gym_class_reports(status, created_at desc);

create index if not exists idx_gym_class_inquiries_class_status_created_at
  on public.gym_class_inquiries(class_id, status, created_at desc);

create index if not exists idx_gym_class_waitlist_class_status_created_at
  on public.gym_class_waitlist(class_id, status, created_at desc);

create index if not exists idx_gym_class_notifications_status_created_at
  on public.gym_class_notifications(status, created_at desc);

alter table public.gym_class_applications
  add column if not exists gender text null check (gender in ('male', 'female', 'other')),
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'manual_paid', 'refunded', 'partial_refunded')),
  add column if not exists paid_amount_krw integer null check (paid_amount_krw is null or paid_amount_krw >= 0),
  add column if not exists paid_at timestamptz null,
  add column if not exists refund_status text not null default 'none'
    check (refund_status in ('none', 'requested', 'approved', 'rejected', 'refunded')),
  add column if not exists refund_requested_at timestamptz null,
  add column if not exists refund_reason text null,
  add column if not exists refund_amount_krw integer null check (refund_amount_krw is null or refund_amount_krw >= 0),
  add column if not exists refund_processed_at timestamptz null,
  add column if not exists refund_processed_by_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists operator_note text null,
  add column if not exists confirmed_at timestamptz null,
  add column if not exists canceled_at timestamptz null,
  add column if not exists terms_version text null,
  add column if not exists privacy_accepted_at timestamptz null,
  add column if not exists broker_notice_accepted_at timestamptz null,
  add column if not exists accepted_ip text null,
  add column if not exists accepted_user_agent text null,
  add column if not exists terms_payload jsonb not null default '{}'::jsonb;

alter table public.gym_classes enable row level security;
alter table public.gym_class_operator_requests enable row level security;
alter table public.gym_class_operators enable row level security;
alter table public.gym_class_schedules enable row level security;
alter table public.gym_class_applications enable row level security;
alter table public.gym_class_refund_requests enable row level security;
alter table public.gym_class_reviews enable row level security;
alter table public.gym_class_reports enable row level security;
alter table public.gym_class_inquiries enable row level security;
alter table public.gym_class_waitlist enable row level security;
alter table public.gym_class_notifications enable row level security;

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

drop policy if exists gym_class_operators_owner_read on public.gym_class_operators;
create policy gym_class_operators_owner_read
  on public.gym_class_operators
  for select
  using (user_id = auth.uid() and status = 'active');

drop policy if exists gym_class_operator_requests_owner_insert on public.gym_class_operator_requests;
create policy gym_class_operator_requests_owner_insert
  on public.gym_class_operator_requests
  for insert
  with check (auth.uid() is not null and (user_id is null or user_id = auth.uid()));

drop policy if exists gym_class_operator_requests_owner_read on public.gym_class_operator_requests;
create policy gym_class_operator_requests_owner_read
  on public.gym_class_operator_requests
  for select
  using (user_id = auth.uid());

drop policy if exists gym_classes_operator_all on public.gym_classes;
create policy gym_classes_operator_all
  on public.gym_classes
  for all
  using (
    exists (
      select 1
      from public.gym_class_operators o
      where o.id = gym_classes.operator_id
        and o.user_id = auth.uid()
        and o.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.gym_class_operators o
      where o.id = gym_classes.operator_id
        and o.user_id = auth.uid()
        and o.status = 'active'
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

drop policy if exists gym_class_schedules_operator_all on public.gym_class_schedules;
create policy gym_class_schedules_operator_all
  on public.gym_class_schedules
  for all
  using (
    exists (
      select 1
      from public.gym_classes c
      join public.gym_class_operators o on o.id = c.operator_id
      where c.id = gym_class_schedules.class_id
        and o.user_id = auth.uid()
        and o.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.gym_classes c
      join public.gym_class_operators o on o.id = c.operator_id
      where c.id = gym_class_schedules.class_id
        and o.user_id = auth.uid()
        and o.status = 'active'
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

drop policy if exists gym_class_applications_operator_read_update on public.gym_class_applications;
create policy gym_class_applications_operator_read_update
  on public.gym_class_applications
  for all
  using (
    exists (
      select 1
      from public.gym_classes c
      join public.gym_class_operators o on o.id = c.operator_id
      where c.id = gym_class_applications.class_id
        and o.user_id = auth.uid()
        and o.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.gym_classes c
      join public.gym_class_operators o on o.id = c.operator_id
      where c.id = gym_class_applications.class_id
        and o.user_id = auth.uid()
        and o.status = 'active'
    )
  );

drop policy if exists gym_class_refund_requests_admin_all on public.gym_class_refund_requests;
create policy gym_class_refund_requests_admin_all
  on public.gym_class_refund_requests
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

drop policy if exists gym_class_refund_requests_operator_read on public.gym_class_refund_requests;
create policy gym_class_refund_requests_operator_read
  on public.gym_class_refund_requests
  for select
  using (
    exists (
      select 1
      from public.gym_classes c
      join public.gym_class_operators o on o.id = c.operator_id
      where c.id = gym_class_refund_requests.class_id
        and o.user_id = auth.uid()
        and o.status = 'active'
    )
  );

drop policy if exists gym_class_reviews_admin_all on public.gym_class_reviews;
create policy gym_class_reviews_admin_all
  on public.gym_class_reviews
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

drop policy if exists gym_class_reports_admin_all on public.gym_class_reports;
create policy gym_class_reports_admin_all
  on public.gym_class_reports
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

drop policy if exists gym_class_inquiries_admin_all on public.gym_class_inquiries;
create policy gym_class_inquiries_admin_all
  on public.gym_class_inquiries
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

drop policy if exists gym_class_waitlist_admin_all on public.gym_class_waitlist;
create policy gym_class_waitlist_admin_all
  on public.gym_class_waitlist
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

drop policy if exists gym_class_notifications_admin_all on public.gym_class_notifications;
create policy gym_class_notifications_admin_all
  on public.gym_class_notifications
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.role, '') = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
