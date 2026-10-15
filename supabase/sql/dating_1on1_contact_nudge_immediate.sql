-- Optional preset message immediately after mutual acceptance. No automatic sends.
-- Existing per-sender/per-match unique constraint and message history are retained.
-- The policy RPC and trigger change together; old application code still waits 24h.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.dating_1on1_contact_nudges'::regclass
    and tgname = 'trg_validate_dating_1on1_contact_nudge' and tgenabled in ('O', 'A')) then
    raise exception 'Install the existing contact-nudge table and enabled validation trigger first';
  end if;
end $$;

create or replace function public.validate_dating_1on1_contact_nudge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.dating_1on1_match_proposals%rowtype;
  mutual_at timestamptz;
begin
  select * into match_row
  from public.dating_1on1_match_proposals
  where id = new.match_id
  for update;

  if not found then
    raise exception 'NUDGE_MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (
    (match_row.source_user_id = new.sender_user_id and match_row.candidate_user_id = new.recipient_user_id) or
    (match_row.candidate_user_id = new.sender_user_id and match_row.source_user_id = new.recipient_user_id)
  ) then
    raise exception 'NUDGE_PARTICIPANT_MISMATCH' using errcode = '23514';
  end if;

  mutual_at := coalesce(match_row.source_final_responded_at, match_row.updated_at, match_row.created_at);
  if match_row.state is distinct from 'mutual_accepted'
    or match_row.contact_exchange_status is distinct from 'awaiting_applicant_payment'
    or match_row.contact_exchange_paid_at is not null
    or match_row.contact_exchange_paid_by_user_id is not null
    or mutual_at is null
    or mutual_at > clock_timestamp()
  then
    raise exception 'NUDGE_NOT_ELIGIBLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.dating_1on1_contact_nudge_delay_hours()
returns integer language sql stable set search_path = public
as $$ select 0; $$;

revoke all on function public.validate_dating_1on1_contact_nudge() from public, anon, authenticated;
revoke all on function public.dating_1on1_contact_nudge_delay_hours() from public, anon, authenticated;
grant execute on function public.dating_1on1_contact_nudge_delay_hours() to service_role;
commit;
notify pgrst, 'reload schema';
