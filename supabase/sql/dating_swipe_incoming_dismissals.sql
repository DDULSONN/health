-- Received-like cleanup is private list state, NOT a swipe/match cancellation.
begin;

create table if not exists public.dating_swipe_incoming_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  swipe_id uuid not null references public.dating_card_swipes(id) on delete cascade,
  swipe_created_at timestamptz not null,
  primary key (user_id, swipe_id, swipe_created_at)
);

alter table public.dating_swipe_incoming_dismissals enable row level security;
revoke all on public.dating_swipe_incoming_dismissals from public, anon, authenticated, service_role;
grant select, insert on public.dating_swipe_incoming_dismissals to service_role;

comment on table public.dating_swipe_incoming_dismissals is
  'Recipient-only dismissal of one received-like version. Does not cancel matches or restore swipe usage.';

commit;
notify pgrst, 'reload schema';
