-- Existing installations: change only the preset-message waiting period.
-- Does not reset sent messages, change payment/contact approval, or send anything.
-- Apply before deploying the 24-hour UI/API. The old API stays restrictive until deployment.
begin;

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
  select *
    into match_row
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
  if match_row.state <> 'mutual_accepted'
    or match_row.contact_exchange_status <> 'awaiting_applicant_payment'
    or match_row.contact_exchange_paid_at is not null
    or match_row.contact_exchange_paid_by_user_id is not null
    or mutual_at is null
    or mutual_at > now() - interval '24 hours'
  then
    raise exception 'NUDGE_NOT_ELIGIBLE' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_dating_1on1_contact_nudge() from public, anon, authenticated;

commit;
