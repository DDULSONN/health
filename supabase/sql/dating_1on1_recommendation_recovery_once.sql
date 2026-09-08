-- Apply the September 8 candidate-repeat correction exactly once per account.
-- No recurring campaign, quota changes, profile updates, messages or match writes.
-- Retrying this transaction preserves the original recovery timestamp.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.dating_1on1_recommendation_recoveries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  card_id uuid unique references public.dating_1on1_cards(id) on delete set null,
  refreshed_at timestamptz not null default now(),
  reason text not null default 'candidate-repeat-fix-2026-09-08'
);
alter table public.dating_1on1_recommendation_recoveries enable row level security;
revoke all on public.dating_1on1_recommendation_recoveries from public, anon, authenticated, service_role;
grant select, insert on public.dating_1on1_recommendation_recoveries to service_role;

with latest as (
  select distinct on (user_id) id, user_id
  from public.dating_1on1_cards
  where status in ('submitted', 'reviewing', 'approved')
  order by user_id, created_at desc, id desc
), eligible as (
  select e.card_id
  from public.dating_1on1_recommendation_refresh_events e
  where e.refreshed_at >= timestamptz '2026-09-08 13:12:00+00' - interval '7 days'
    and e.refreshed_at < timestamptz '2026-09-08 13:12:00+00'
  group by e.card_id
  having count(distinct e.refreshed_at) >= 2
    and max(e.refreshed_at) >= timestamptz '2026-09-08 13:12:00+00' - interval '3 days'
    and max(e.refreshed_at) - min(e.refreshed_at) >= interval '24 hours'
), applied as (
  insert into public.dating_1on1_recommendation_recoveries (user_id, card_id)
  select l.user_id, l.id
  from latest l
  join eligible e on e.card_id = l.id
  join public.profiles p on p.user_id = l.user_id
  join auth.users u on u.id = l.user_id
  where p.is_banned is not true and u.deleted_at is null
  on conflict (user_id) do nothing
  returning user_id
)
select count(*) as newly_recovered_members from applied;

commit;
notify pgrst, 'reload schema';
