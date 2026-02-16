-- 소개팅 커뮤니티 공개 + 댓글 기능
-- dating_applications에 새 컬럼 추가 + dating_comments 테이블 생성

begin;

-- ============================================================
-- 1) dating_applications 신규 컬럼 추가
-- ============================================================

-- 나이
alter table public.dating_applications
  add column if not exists age int null check (age between 18 and 99);

-- 블러 썸네일 (Storage path)
alter table public.dating_applications
  add column if not exists thumb_blur_path text null;

-- 관리자 공개 승인
alter table public.dating_applications
  add column if not exists approved_for_public boolean not null default false;

-- 3대 합계 (남자 필수, 여자 optional)
alter table public.dating_applications
  add column if not exists total_3lift int null;

-- 상위 % (남자 필수, 여자 optional)
alter table public.dating_applications
  add column if not exists percent_all numeric null;

-- 닉네임 (공개용)
alter table public.dating_applications
  add column if not exists display_nickname text null;

-- 인덱스
create index if not exists idx_dating_apps_public
  on public.dating_applications (approved_for_public, sex, created_at desc)
  where approved_for_public = true and thumb_blur_path is not null;

-- ============================================================
-- 2) 공개된 카드 SELECT 정책 추가 (일반 유저도 공개 카드 열람 가능)
-- ============================================================

drop policy if exists "dating_select_public" on public.dating_applications;
create policy "dating_select_public"
  on public.dating_applications for select
  to authenticated
  using (
    approved_for_public = true
    and thumb_blur_path is not null
  );

-- 기존 admin select 정책은 유지 (OR 논리로 둘 다 적용됨)

-- ============================================================
-- 3) dating_comments 테이블
-- ============================================================

create table if not exists public.dating_comments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.dating_applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dating_comments_app
  on public.dating_comments (application_id, created_at);
create index if not exists idx_dating_comments_user
  on public.dating_comments (user_id);

-- RLS
alter table public.dating_comments enable row level security;

-- SELECT: 로그인 유저 (공개된 카드의 댓글만)
drop policy if exists "dating_comments_select" on public.dating_comments;
create policy "dating_comments_select"
  on public.dating_comments for select
  to authenticated
  using (
    exists (
      select 1 from public.dating_applications da
      where da.id = application_id
        and da.approved_for_public = true
        and da.thumb_blur_path is not null
    )
  );

-- INSERT: 로그인 유저 (공개된 카드에만)
drop policy if exists "dating_comments_insert" on public.dating_comments;
create policy "dating_comments_insert"
  on public.dating_comments for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.dating_applications da
      where da.id = application_id
        and da.approved_for_public = true
        and da.thumb_blur_path is not null
    )
  );

-- UPDATE: 본인만 (soft delete용)
drop policy if exists "dating_comments_update_own" on public.dating_comments;
create policy "dating_comments_update_own"
  on public.dating_comments for update
  to authenticated
  using (auth.uid() = user_id);

-- DELETE: 관리자만
drop policy if exists "dating_comments_delete_admin" on public.dating_comments;
create policy "dating_comments_delete_admin"
  on public.dating_comments for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

commit;
