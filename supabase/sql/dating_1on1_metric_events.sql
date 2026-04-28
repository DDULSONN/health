begin;

create table if not exists public.dating_1on1_metric_events (
  id uuid primary key default gen_random_uuid(),
  event_kind text not null check (event_kind in ('application_created', 'mutual_match_created')),
  card_id uuid,
  match_id uuid,
  user_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_dating_1on1_metric_application_card
  on public.dating_1on1_metric_events (event_kind, card_id)
  where event_kind = 'application_created' and card_id is not null;

create unique index if not exists uq_dating_1on1_metric_match
  on public.dating_1on1_metric_events (event_kind, match_id)
  where event_kind = 'mutual_match_created' and match_id is not null;

create index if not exists idx_dating_1on1_metric_events_kind_created
  on public.dating_1on1_metric_events (event_kind, created_at desc);

insert into public.dating_1on1_metric_events (event_kind, card_id, user_id, occurred_at, created_at)
select
  'application_created',
  c.id,
  c.user_id,
  coalesce(c.created_at, now()),
  coalesce(c.created_at, now())
from public.dating_1on1_cards c
on conflict do nothing;

insert into public.dating_1on1_metric_events (event_kind, match_id, card_id, user_id, occurred_at, created_at)
select
  'mutual_match_created',
  m.id,
  m.source_card_id,
  m.source_user_id,
  coalesce(m.source_final_responded_at, m.updated_at, m.created_at, now()),
  coalesce(m.source_final_responded_at, m.updated_at, m.created_at, now())
from public.dating_1on1_match_proposals m
where m.state = 'mutual_accepted'
on conflict do nothing;

commit;

notify pgrst, 'reload schema';
