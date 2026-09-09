-- Emergency fix for self-escalation through profiles.role.
-- Intentionally leaves phone verification, payments and matching unchanged.
-- Requires profiles_read_privacy_hardening.sql. Run as the database owner.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_read_owner_boundary' and permissive = 'RESTRICTIVE'
  ) then
    raise exception 'Apply profiles_read_privacy_hardening.sql first';
  end if;
end;
$$;

create schema if not exists private;
create or replace function private.guard_profile_authority_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Check the actual DB execution role, NOT editable profile fields or metadata.
  -- Authorized service-role operations and trusted owner-run Auth triggers retain
  -- their existing access. This function itself never elevates the caller.
  if current_user in ('anon', 'authenticated') then
    if auth.uid() is null or new.user_id is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'PROFILE_OWNER_CHANGE_FORBIDDEN';
    end if;

    if tg_op = 'INSERT' then
      if coalesce(new.role::text, 'user') <> 'user' then
        raise exception using errcode = '42501', message = 'PROFILE_ROLE_CHANGE_FORBIDDEN';
      end if;
    else
      if new.role is distinct from old.role then
        raise exception using errcode = '42501', message = 'PROFILE_ROLE_CHANGE_FORBIDDEN';
      end if;
      if new.user_id is distinct from old.user_id or new.id is distinct from old.id then
        raise exception using errcode = '42501', message = 'PROFILE_OWNER_CHANGE_FORBIDDEN';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Trigger functions are not callable RPC endpoints. No new client grants.
revoke all on function private.guard_profile_authority_write() from public, anon, authenticated;
drop trigger if exists profiles_guard_authority_write on public.profiles;
create trigger profiles_guard_authority_write
  before insert or update on public.profiles
  for each row execute function private.guard_profile_authority_write();

-- No existing profile rows or existing policies are rewritten.
notify pgrst, 'reload schema';
commit;
