-- Recipient viewport receipt only. No historic read inference/backfill.
-- Additive: does not change matching, payments, phone disclosure or sending rules.
begin;

alter table public.dating_1on1_contact_nudges
  add column if not exists read_at timestamptz;

create or replace function public.mark_dating_1on1_contact_nudge_read(
  p_match_id uuid,
  p_nudge_id uuid,
  p_recipient_user_id uuid
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.dating_1on1_match_proposals%rowtype;
  v_nudge public.dating_1on1_contact_nudges%rowtype;
  v_read_at timestamptz;
begin
  -- Serialize with cancellation, without updating the match or updated_at.
  select * into v_match from public.dating_1on1_match_proposals
  where id = p_match_id for share;
  if not found then
    raise exception 'NUDGE_READ_NOT_FOUND';
  end if;
  select * into v_nudge from public.dating_1on1_contact_nudges
  where id = p_nudge_id and match_id = p_match_id
    and recipient_user_id = p_recipient_user_id for update;
  if not found then
    raise exception 'NUDGE_READ_NOT_FOUND';
  end if;
  if not coalesce((
    (v_nudge.sender_user_id = v_match.source_user_id and v_nudge.recipient_user_id = v_match.candidate_user_id)
    or (v_nudge.sender_user_id = v_match.candidate_user_id and v_nudge.recipient_user_id = v_match.source_user_id)
  ), false) then
    raise exception 'NUDGE_READ_NOT_FOUND';
  end if;
  if v_match.state is distinct from 'mutual_accepted'
    or coalesce(v_match.contact_exchange_status, '') not in ('none', 'awaiting_applicant_payment', 'payment_pending_admin', 'approved')
  then
    raise exception 'NUDGE_READ_UNAVAILABLE';
  end if;
  if (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
      where p.user_id in (v_nudge.sender_user_id, v_nudge.recipient_user_id)
        and coalesce(p.is_banned, false) = false) <> 2
  then
    raise exception 'NUDGE_READ_UNAVAILABLE';
  end if;
  -- Some existing installations only have hashed contact blocks (checked by
  -- the authenticated API). Preserve the optional member-block table contract.
  if to_regclass('public.dating_user_blocks') is not null then
    if exists (
      select 1 from public.dating_user_blocks b
      where (b.blocker_user_id = v_nudge.sender_user_id and b.blocked_user_id = v_nudge.recipient_user_id)
         or (b.blocker_user_id = v_nudge.recipient_user_id and b.blocked_user_id = v_nudge.sender_user_id)
    ) then
      raise exception 'NUDGE_READ_UNAVAILABLE';
    end if;
  end if;
  -- Repeated exposures/retries preserve the first server timestamp.
  if v_nudge.read_at is not null then
    return v_nudge.read_at;
  end if;
  update public.dating_1on1_contact_nudges
  set read_at = greatest(clock_timestamp(), created_at)
  where id = v_nudge.id and read_at is null
  returning read_at into v_read_at;
  return v_read_at;
end;
$$;

revoke all on function public.mark_dating_1on1_contact_nudge_read(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_dating_1on1_contact_nudge_read(uuid, uuid, uuid) to service_role;

commit;
notify pgrst, 'reload schema';
