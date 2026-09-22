-- Optional diagnostics only. No triggers or changes to matching/OTP/payment tables.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table if not exists public.onboarding_funnel_config (
  id boolean primary key default true check (id),
  tracking_since timestamptz not null default now()
);
insert into public.onboarding_funnel_config(id) values(true) on conflict do nothing;

create table if not exists public.onboarding_funnel_events (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  event_name text not null check (event_name in (
    'phone_view','phone_send_failed','phone_verify_failed','phone_duplicate',
    'profile_basic','profile_intro','profile_lifestyle','profile_photos','profile_review',
    'validation_basic','validation_intro','validation_lifestyle','validation_photos','validation_review',
    'photo_rejected','submit_started','upload_failed','submit_failed'
  )),
  first_seen_at timestamptz not null default now(),
  primary key(user_id, event_name)
);
alter table public.onboarding_funnel_events enable row level security;
alter table public.onboarding_funnel_config enable row level security;
revoke all on public.onboarding_funnel_events, public.onboarding_funnel_config from public, anon, authenticated;
grant select, insert on public.onboarding_funnel_events to service_role;
grant select on public.onboarding_funnel_config to service_role;

create or replace function public.admin_onboarding_funnel_summary(p_days integer default 7)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog
set statement_timeout = '8s'
as $$
declare
  v_start timestamptz;
  v_end timestamptz := now();
  v_result jsonb;
begin
  if p_days is null or p_days not in (1, 7, 30) then
    raise exception 'unsupported period' using errcode = '22023';
  end if;
  -- Today / last 7 or 30 calendar days, Korean time, through the current instant.
  v_start := (date_trunc('day', v_end at time zone 'Asia/Seoul') - make_interval(days => p_days - 1)) at time zone 'Asia/Seoul';
  with cohort as materialized (
    select p.user_id, coalesce(p.phone_verified, false) as verified,
      exists(select 1 from public.dating_cards c where c.owner_user_id = p.user_id) as open_card,
      exists(select 1 from public.dating_1on1_cards c where c.user_id = p.user_id) as one_card,
      exists(select 1 from public.dating_1on1_match_proposals m
        where (m.source_user_id = p.user_id or m.candidate_user_id = p.user_id)
          and m.state = 'mutual_accepted') as mutual,
      exists(select 1 from public.dating_1on1_match_proposals m
        where (m.source_user_id = p.user_id or m.candidate_user_id = p.user_id)
          and m.state = 'mutual_accepted' and m.contact_exchange_status = 'approved') as exchanged
    from public.profiles p join auth.users u on u.id = p.user_id
    where u.created_at >= v_start and u.created_at <= v_end
      and u.deleted_at is null and p.role <> 'admin'
  ), event_counts as (
    select e.event_name, count(*) as members,
      count(*) filter(where not c.open_card and not c.one_card) as unregistered
    from public.onboarding_funnel_events e join cohort c on c.user_id = e.user_id
    where e.first_seen_at <= v_end
    group by e.event_name
  )
  select jsonb_build_object(
    'cohort_start', v_start, 'measured_at', v_end,
    'tracking_since', (select tracking_since from public.onboarding_funnel_config where id),
    'counts', jsonb_build_object(
      'joined', count(*),
      'verified', count(*) filter(where verified),
      'profile', count(*) filter(where verified and (open_card or one_card)),
      'one_on_one', count(*) filter(where verified and one_card),
      'mutual', count(*) filter(where verified and one_card and mutual),
      'exchanged', count(*) filter(where verified and one_card and mutual and exchanged)
    ),
    'events', coalesce((select jsonb_object_agg(event_name, members) from event_counts), '{}'::jsonb),
    'unregistered', coalesce((select jsonb_object_agg(event_name, unregistered) from event_counts), '{}'::jsonb)
  ) into v_result from cohort;
  return v_result;
end;
$$;
revoke all on function public.admin_onboarding_funnel_summary(integer) from public, anon, authenticated;
grant execute on function public.admin_onboarding_funnel_summary(integer) to service_role;
comment on table public.onboarding_funnel_events is
  'First occurrence per member and fixed diagnostic code. No form contents/contacts/URLs. Deleted with profile; client telemetry is not proof of a failure cause.';
commit;
notify pgrst, 'reload schema';
