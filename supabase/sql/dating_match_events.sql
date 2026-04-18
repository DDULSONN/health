begin;

create table if not exists public.dating_match_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  kind text not null check (kind in ('open_card', 'swipe')),
  source_key text not null,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dating_match_events_kind_created
  on public.dating_match_events (kind, created_at desc);

create index if not exists idx_dating_match_events_source_key
  on public.dating_match_events (source_key);

alter table public.dating_match_events enable row level security;

drop policy if exists "dating_match_events_admin_all" on public.dating_match_events;
create policy "dating_match_events_admin_all"
  on public.dating_match_events for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

insert into public.dating_match_events (event_key, kind, source_key, meta_json, created_at)
select
  'open_card:' || a.id::text as event_key,
  'open_card' as kind,
  a.id::text as source_key,
  jsonb_build_object(
    'application_id', a.id::text,
    'card_id', a.card_id::text,
    'applicant_user_id', a.applicant_user_id::text,
    'source', 'dating_card_applications'
  ) as meta_json,
  coalesce(a.created_at, now()) as created_at
from public.dating_card_applications a
where a.status = 'accepted'
on conflict (event_key) do nothing;

insert into public.dating_match_events (event_key, kind, source_key, meta_json, created_at)
select
  'open_card:' || trim(n.meta_json ->> 'application_id') as event_key,
  'open_card' as kind,
  trim(n.meta_json ->> 'application_id') as source_key,
  jsonb_build_object(
    'application_id', trim(n.meta_json ->> 'application_id'),
    'card_id', n.meta_json ->> 'card_id',
    'source', 'notifications'
  ) as meta_json,
  coalesce(n.created_at, now()) as created_at
from public.notifications n
where n.type = 'dating_application_accepted'
  and coalesce(trim(n.meta_json ->> 'application_id'), '') <> ''
on conflict (event_key) do nothing;

insert into public.dating_match_events (event_key, kind, source_key, meta_json, created_at)
select
  'swipe:' || m.pair_key as event_key,
  'swipe' as kind,
  m.pair_key as source_key,
  jsonb_build_object(
    'pair_key', m.pair_key,
    'user_a_id', m.user_a_id::text,
    'user_b_id', m.user_b_id::text,
    'source', 'dating_card_swipe_matches'
  ) as meta_json,
  coalesce(m.created_at, now()) as created_at
from public.dating_card_swipe_matches m
where coalesce(m.pair_key, '') <> ''
on conflict (event_key) do nothing;

commit;

notify pgrst, 'reload schema';
