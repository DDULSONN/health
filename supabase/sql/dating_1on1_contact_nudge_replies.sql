-- Additive, optional replies. Does not alter match, payment, phone or read-receipt rules.
-- Run after dating_1on1_contact_nudges.sql. No read-receipt migration required.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.dating_1on1_contact_nudge_replies (
  nudge_id uuid primary key references public.dating_1on1_contact_nudges(id) on delete cascade,
  preset_key text not null check (preset_key in ('happy_to_talk', 'available_this_week', 'not_right_now')),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.dating_1on1_contact_nudge_replies enable row level security;
revoke all on public.dating_1on1_contact_nudge_replies from public, anon, authenticated, service_role;
grant select on public.dating_1on1_contact_nudge_replies to service_role;

create or replace function public.reply_dating_1on1_contact_nudge(
  p_match_id uuid, p_nudge_id uuid, p_recipient_user_id uuid, p_preset_key text
) returns jsonb
language plpgsql security definer set search_path = ''
set lock_timeout = '3s' set statement_timeout = '5s'
as $$
declare
  v_match public.dating_1on1_match_proposals%rowtype;
  v_nudge public.dating_1on1_contact_nudges%rowtype;
  v_reply public.dating_1on1_contact_nudge_replies%rowtype;
begin
  if p_preset_key is null or p_preset_key not in ('happy_to_talk', 'available_this_week', 'not_right_now') then
    raise exception 'NUDGE_REPLY_INVALID_PRESET';
  end if;
  -- Same lock order as receipts: match first, nudge second. Cancels/payment updates
  -- serialize with this transaction; neither row is changed by replying.
  select * into v_match from public.dating_1on1_match_proposals where id = p_match_id for share;
  if not found then raise exception 'NUDGE_REPLY_NOT_FOUND'; end if;
  select * into v_nudge from public.dating_1on1_contact_nudges
    where id = p_nudge_id and match_id = p_match_id and recipient_user_id = p_recipient_user_id for update;
  if not found then raise exception 'NUDGE_REPLY_NOT_FOUND'; end if;
  if not coalesce((
    (v_nudge.sender_user_id = v_match.source_user_id and v_nudge.recipient_user_id = v_match.candidate_user_id)
    or (v_nudge.sender_user_id = v_match.candidate_user_id and v_nudge.recipient_user_id = v_match.source_user_id)
  ), false) then raise exception 'NUDGE_REPLY_NOT_FOUND'; end if;
  if v_match.state is distinct from 'mutual_accepted'
    or v_match.contact_exchange_status is distinct from 'awaiting_applicant_payment'
    or v_match.contact_exchange_paid_at is not null or v_match.contact_exchange_paid_by_user_id is not null
    or v_match.contact_exchange_approved_at is not null
  then raise exception 'NUDGE_REPLY_UNAVAILABLE'; end if;
  if (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
    where p.user_id in (v_nudge.sender_user_id, v_nudge.recipient_user_id) and coalesce(p.is_banned, false) = false
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())) <> 2
  then raise exception 'NUDGE_REPLY_UNAVAILABLE'; end if;
  if to_regclass('public.dating_user_blocks') is not null then
    if exists (select 1 from public.dating_user_blocks b
      where (b.blocker_user_id = v_nudge.sender_user_id and b.blocked_user_id = v_nudge.recipient_user_id)
         or (b.blocker_user_id = v_nudge.recipient_user_id and b.blocked_user_id = v_nudge.sender_user_id))
    then raise exception 'NUDGE_REPLY_UNAVAILABLE'; end if;
  end if;
  -- Recipient identity and hashed phone blocks are also verified by the API.
  -- Retry/double-click returns the first saved reply, even if another preset was sent.
  insert into public.dating_1on1_contact_nudge_replies(nudge_id, preset_key)
    values (v_nudge.id, p_preset_key) on conflict (nudge_id) do nothing;
  select * into v_reply from public.dating_1on1_contact_nudge_replies where nudge_id = v_nudge.id;
  return jsonb_build_object('preset_key', v_reply.preset_key, 'created_at', v_reply.created_at);
end;
$$;
revoke all on function public.reply_dating_1on1_contact_nudge(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reply_dating_1on1_contact_nudge(uuid, uuid, uuid, text) to service_role;
commit;
notify pgrst, 'reload schema';
