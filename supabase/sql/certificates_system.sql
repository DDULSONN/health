create table if not exists public.cert_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text null,
  email text null,
  sex text not null check (sex in ('male', 'female')),
  bodyweight numeric null,
  squat numeric not null,
  bench numeric not null,
  deadlift numeric not null,
  total numeric not null default 0,
  submit_code text not null unique,
  status text not null check (status in ('pending', 'needs_info', 'rejected', 'approved')) default 'pending',
  note text null,
  admin_note text null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null
);

create index if not exists idx_cert_requests_user_created_at
  on public.cert_requests (user_id, created_at desc);

create index if not exists idx_cert_requests_status_created_at
  on public.cert_requests (status, created_at desc);

create index if not exists idx_cert_requests_submit_code
  on public.cert_requests (submit_code);

create or replace function public.set_cert_request_total()
returns trigger
language plpgsql
as $$
begin
  new.total := coalesce(new.squat, 0) + coalesce(new.bench, 0) + coalesce(new.deadlift, 0);
  return new;
end;
$$;

drop trigger if exists trg_set_cert_request_total on public.cert_requests;
create trigger trg_set_cert_request_total
before insert or update on public.cert_requests
for each row
execute function public.set_cert_request_total();

create table if not exists public.cert_sequences (
  year integer primary key,
  current integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.next_certificate_no(p_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
begin
  insert into public.cert_sequences (year, current)
  values (p_year, 1)
  on conflict (year)
  do update set
    current = public.cert_sequences.current + 1,
    updated_at = now()
  returning current into v_current;

  return format('GT-%s-%s', p_year, lpad(v_current::text, 6, '0'));
end;
$$;

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.cert_requests(id) on delete cascade,
  certificate_no text not null unique,
  slug text not null unique,
  qr_url text not null,
  pdf_path text not null,
  pdf_url text not null,
  issued_at timestamptz not null default now(),
  is_public boolean not null default true
);

create index if not exists idx_certificates_slug
  on public.certificates (slug);

create index if not exists idx_certificates_issued_at
  on public.certificates (issued_at desc);

alter table public.cert_requests enable row level security;
alter table public.certificates enable row level security;

drop policy if exists "cert_requests_select_own" on public.cert_requests;
create policy "cert_requests_select_own"
  on public.cert_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "cert_requests_insert_own" on public.cert_requests;
create policy "cert_requests_insert_own"
  on public.cert_requests
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "certificates_select_public_or_owner" on public.certificates;
create policy "certificates_select_public_or_owner"
  on public.certificates
  for select
  to anon, authenticated
  using (
    is_public = true
    or exists (
      select 1
      from public.cert_requests r
      where r.id = request_id
        and r.user_id = auth.uid()
    )
  );

drop view if exists public.certificates_public;
create view public.certificates_public as
select
  c.certificate_no,
  c.slug,
  c.qr_url,
  c.issued_at,
  r.nickname,
  r.sex,
  r.bodyweight,
  r.squat,
  r.bench,
  r.deadlift,
  r.total
from public.certificates c
join public.cert_requests r on r.id = c.request_id
where c.is_public = true and r.status = 'approved';

grant select on public.certificates_public to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('certificates', 'certificates', true)
on conflict (id) do nothing;

drop policy if exists "certificates_bucket_public_read" on storage.objects;
create policy "certificates_bucket_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'certificates');

drop policy if exists "certificates_bucket_service_insert" on storage.objects;
create policy "certificates_bucket_service_insert"
  on storage.objects
  for insert
  to service_role
  with check (bucket_id = 'certificates');

drop policy if exists "certificates_bucket_service_update" on storage.objects;
create policy "certificates_bucket_service_update"
  on storage.objects
  for update
  to service_role
  using (bucket_id = 'certificates')
  with check (bucket_id = 'certificates');
