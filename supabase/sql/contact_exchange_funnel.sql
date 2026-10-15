-- Diagnostic schema only: no writes/triggers/functions on orders or matches.
-- Existing generic product events remain compatible with match_id = NULL.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

alter table public.payment_funnel_events add column if not exists match_id uuid;
-- No FK to matching: measuring must not introduce a dependency on match deletion.
create unique index if not exists idx_payment_funnel_contact_session
  on public.payment_funnel_events(user_id,session_id,match_id,event_name,placement);
create index if not exists idx_payment_funnel_contact_match
  on public.payment_funnel_events(match_id,created_at desc) where match_id is not null;
grant select,insert on public.payment_funnel_events to service_role;
grant usage on sequence public.payment_funnel_events_id_seq to service_role;
comment on column public.payment_funnel_events.match_id is
  'Server-validated participant match ID for internal diagnostics only. Client view/click and displayed amount do not prove intent, payment or contact disclosure.';

commit;
notify pgrst, 'reload schema';
