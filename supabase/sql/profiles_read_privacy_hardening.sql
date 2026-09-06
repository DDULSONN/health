-- Deploy the public-profiles compatibility code BEFORE running this migration.
-- No member rows, matching, payments or storage policies are changed.
-- A legacy self-referencing nickname UPDATE check is replaced with an equivalent
-- non-recursive check to preserve phone/settings saves under the new boundary.
-- Run as the database owner in Supabase SQL Editor.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.profiles enable row level security;

-- Private, scalar helper: it only compares the authenticated user's nickname
-- controls. It accepts no target user ID and returns no profile/contact data.
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.profile_read_privacy_nickname_unchanged(
  candidate_nickname text,
  candidate_changed_count integer,
  candidate_changed_at timestamptz,
  candidate_credits integer
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.nickname = candidate_nickname
      and p.nickname_changed_count = candidate_changed_count
      and coalesce(p.nickname_changed_at, to_timestamp(0)) = coalesce(candidate_changed_at, to_timestamp(0))
      and p.nickname_change_credits = candidate_credits
  );
$$;
revoke all on function private.profile_read_privacy_nickname_unchanged(text, integer, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function private.profile_read_privacy_nickname_unchanged(text, integer, timestamptz, integer)
  to authenticated;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_update_own_limited'
  ) then
    drop policy profiles_update_own_limited on public.profiles;
    create policy profiles_update_own_limited on public.profiles
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (
        user_id = (select auth.uid())
        and private.profile_read_privacy_nickname_unchanged(
          nickname, nickname_changed_count, nickname_changed_at, nickname_change_credits
        )
      );
  end if;
end;
$$;

-- Keep self-service reads (including phone verification and ban status).
drop policy if exists profiles_select_own_private on public.profiles;
create policy profiles_select_own_private on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- A restrictive policy also blocks any legacy permissive SELECT/ALL policy.
-- Service-role server queries still bypass RLS after application authorization.
drop policy if exists profiles_read_owner_boundary on public.profiles;
create policy profiles_read_owner_boundary on public.profiles
  as restrictive for select to anon, authenticated
  using (user_id = (select auth.uid()));

drop policy if exists profiles_select_public on public.profiles;

notify pgrst, 'reload schema';
commit;
