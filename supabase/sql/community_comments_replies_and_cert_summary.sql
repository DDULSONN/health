-- Community improvements:
-- 1) comments: reply(parent_id) + soft delete(deleted_at)
-- 2) RLS: owner/admin soft-delete updates
-- 3) latest approved certification summary view for badges

begin;

-- 1) comments schema
alter table public.comments
  add column if not exists parent_id uuid null references public.comments(id) on delete set null,
  add column if not exists deleted_at timestamptz null;

alter table public.comments
  alter column content drop not null;

create index if not exists idx_comments_post_parent_created
  on public.comments (post_id, parent_id, created_at asc);

create index if not exists idx_comments_parent_id
  on public.comments (parent_id);

create index if not exists idx_comments_deleted_at
  on public.comments (deleted_at);

-- 2) comments update policy (soft delete)
drop policy if exists "comments_update_admin" on public.comments;
drop policy if exists "comments_update_own_or_admin" on public.comments;

create policy "comments_update_own_or_admin"
  on public.comments
  for update
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

-- 3) latest approved certification summary view (1 row per user)
drop view if exists public.user_cert_summary;
create view public.user_cert_summary as
with ranked as (
  select
    r.user_id,
    c.certificate_no,
    c.issued_at,
    coalesce(r.total, 0)::numeric as total,
    true as is_verified,
    row_number() over (
      partition by r.user_id
      order by c.issued_at desc, c.id desc
    ) as rn
  from public.certificates c
  join public.cert_requests r on r.id = c.request_id
  where r.status = 'approved'
)
select
  user_id,
  certificate_no,
  issued_at,
  total,
  is_verified
from ranked
where rn = 1;

grant select on public.user_cert_summary to anon, authenticated;

commit;
