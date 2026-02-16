-- Dating community policy hotfix (safe version)
-- 1) 신청자 본인 row SELECT 허용 (마이페이지용)
-- 2) 공개 카드 SELECT 조건에서 thumb_blur_path 강제 제거
-- 3) 댓글 SELECT/INSERT 조건을 공개 승인 여부 기준으로 통일
-- 4) 댓글 DELETE 본인 허용 + 관리자 허용
-- 5) dating_comments 테이블이 없으면 생성

begin;

do $$
begin
  if to_regclass('public.dating_applications') is null then
    raise exception 'public.dating_applications does not exist. Run supabase/sql/dating_applications.sql first.';
  end if;
end $$;

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

alter table public.dating_comments enable row level security;

drop policy if exists "dating_select_public" on public.dating_applications;
create policy "dating_select_public"
  on public.dating_applications for select
  to authenticated
  using (
    approved_for_public = true
    or auth.uid() = user_id
  );

drop policy if exists "dating_comments_select" on public.dating_comments;
create policy "dating_comments_select"
  on public.dating_comments for select
  to authenticated
  using (
    exists (
      select 1 from public.dating_applications da
      where da.id = application_id
        and da.approved_for_public = true
    )
  );

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
    )
  );

drop policy if exists "dating_comments_delete_own" on public.dating_comments;
create policy "dating_comments_delete_own"
  on public.dating_comments for delete
  to authenticated
  using (auth.uid() = user_id);

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
