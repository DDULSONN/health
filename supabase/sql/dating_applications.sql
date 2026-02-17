-- 소개팅 신청 테이블 + RLS
-- 스토리지 버킷 dating-photos는 Supabase 대시보드에서 수동 생성 (private)

begin;

-- 테이블
create table if not exists public.dating_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sex text not null check (sex in ('male','female')),
  name text not null,
  phone text not null check (length(phone) between 9 and 15),
  region text not null,
  height_cm int not null check (height_cm between 120 and 220),
  job text not null,
  instagram_id text not null check (instagram_id ~ '^[A-Za-z0-9._]{1,30}$'),
  ideal_type text not null check (length(ideal_type) <= 1000),
  photo_urls jsonb not null default '[]'::jsonb,
  consent_privacy boolean not null default false,
  consent_content boolean not null default false,
  status text not null default 'submitted'
    check (status in ('submitted','reviewing','matched','rejected')),
  created_at timestamptz not null default now()
);

-- 인덱스
create index if not exists idx_dating_apps_created
  on public.dating_applications (created_at desc);
create index if not exists idx_dating_apps_status
  on public.dating_applications (status);
create index if not exists idx_dating_apps_user
  on public.dating_applications (user_id);

-- RLS 활성화
alter table public.dating_applications enable row level security;

-- INSERT: 로그인 유저만 (임시 정책: 남자 + 3대인증 approved만 허용)
drop policy if exists "dating_insert_own" on public.dating_applications;
create policy "dating_insert_own"
  on public.dating_applications for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and sex = 'male'
    and exists (
      select 1 from public.cert_requests cr
      where cr.user_id = auth.uid() and cr.status = 'approved'
    )
  );

-- SELECT: 관리자만
drop policy if exists "dating_select_admin" on public.dating_applications;
create policy "dating_select_admin"
  on public.dating_applications for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- UPDATE: 관리자만
drop policy if exists "dating_update_admin" on public.dating_applications;
create policy "dating_update_admin"
  on public.dating_applications for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

-- DELETE: 관리자만
drop policy if exists "dating_delete_admin" on public.dating_applications;
create policy "dating_delete_admin"
  on public.dating_applications for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

commit;
