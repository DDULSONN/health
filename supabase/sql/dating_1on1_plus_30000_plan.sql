-- Change 1:1 Plus to the 30,000 KRW exposure plan while preserving legacy benefits.

begin;

alter table public.dating_1on1_plus_subscriptions
  add column if not exists contact_exchange_included boolean;

-- Only rows that predate this migration are null. Re-running this migration is safe.
update public.dating_1on1_plus_subscriptions
set contact_exchange_included = true
where contact_exchange_included is null;

alter table public.dating_1on1_plus_subscriptions
  alter column contact_exchange_included set default false,
  alter column contact_exchange_included set not null;

create or replace function public.grant_dating_1on1_plus(
  p_user_id uuid,
  p_grant_key text,
  p_duration_days integer default 30
)
returns table (starts_at timestamptz, expires_at timestamptz, already_granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_existing public.dating_1on1_plus_subscriptions%rowtype;
  v_starts_at timestamptz;
  v_expires_at timestamptz;
  v_contact_exchange_included boolean := false;
begin
  if p_user_id is null or coalesce(trim(p_grant_key), '') = '' then
    raise exception 'user_id and grant_key are required';
  end if;
  if p_duration_days < 1 or p_duration_days > 365 then
    raise exception 'duration_days must be between 1 and 365';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into v_existing
  from public.dating_1on1_plus_subscriptions
  where user_id = p_user_id;

  if exists (select 1 from public.dating_1on1_plus_grants where grant_key = p_grant_key) then
    return query select v_existing.starts_at, v_existing.expires_at, true;
    return;
  end if;

  v_starts_at := case
    when v_existing.user_id is not null and v_existing.expires_at > v_now then v_existing.starts_at
    else v_now
  end;
  v_expires_at := greatest(coalesce(v_existing.expires_at, v_now), v_now)
    + make_interval(days => p_duration_days);
  v_contact_exchange_included := case
    when v_existing.user_id is not null and v_existing.expires_at > v_now
      then coalesce(v_existing.contact_exchange_included, false)
    else false
  end;

  insert into public.dating_1on1_plus_grants (grant_key, user_id, duration_days)
  values (p_grant_key, p_user_id, p_duration_days);

  insert into public.dating_1on1_plus_subscriptions (
    user_id,
    starts_at,
    expires_at,
    contact_exchange_included,
    updated_at
  )
  values (p_user_id, v_starts_at, v_expires_at, v_contact_exchange_included, v_now)
  on conflict (user_id) do update set
    starts_at = excluded.starts_at,
    expires_at = excluded.expires_at,
    contact_exchange_included = excluded.contact_exchange_included,
    updated_at = excluded.updated_at;

  return query select v_starts_at, v_expires_at, false;
end;
$$;

revoke all on function public.grant_dating_1on1_plus(uuid, text, integer) from public;
revoke all on function public.grant_dating_1on1_plus(uuid, text, integer) from anon;
revoke all on function public.grant_dating_1on1_plus(uuid, text, integer) from authenticated;
grant execute on function public.grant_dating_1on1_plus(uuid, text, integer) to service_role;

commit;

notify pgrst, 'reload schema';
