begin;

-- Completely separate from profiles, matching, payment and authentication data.
create table if not exists public.admin_public_reaction_runs (
  run_date date primary key,
  run_token uuid not null default gen_random_uuid(),
  status text not null check (status in ('running', 'success', 'failed')),
  attempt integer not null default 1 check (attempt between 1 and 2),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  report jsonb,
  check (status <> 'success' or (report is not null and jsonb_typeof(report) = 'object'))
);
alter table public.admin_public_reaction_runs enable row level security;
revoke all on table public.admin_public_reaction_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_public_reaction_runs to service_role;

-- Unique Korean calendar day + atomic claim: parallel cron/manual calls never
-- start duplicate searches. A failed/interrupted scan gets ONE manual retry,
-- after 10 minutes. Successful days cannot be searched again.
create or replace function public.claim_admin_public_reaction_run(p_manual_retry boolean default false)
returns setof public.admin_public_reaction_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  delete from public.admin_public_reaction_runs where run_date < v_today - 90;
  return query
  insert into public.admin_public_reaction_runs as existing (run_date, status)
  values (v_today, 'running')
  on conflict (run_date) do update
  set status = 'running', attempt = existing.attempt + 1,
      run_token = gen_random_uuid(), started_at = now(), completed_at = null, error_code = null
  where p_manual_retry
    and existing.status in ('failed', 'running')
    and existing.attempt < 2
    and existing.started_at <= now() - interval '10 minutes'
  returning existing.*;
end;
$$;
revoke all on function public.claim_admin_public_reaction_run(boolean) from public, anon, authenticated;
grant execute on function public.claim_admin_public_reaction_run(boolean) to service_role;

commit;
notify pgrst, 'reload schema';
