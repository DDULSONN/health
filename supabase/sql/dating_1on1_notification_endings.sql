-- Preserve only a verified reason on existing recipient-owned notifications.
-- No phone numbers, profile snapshots, new messages, or historical backfill.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
create index if not exists idx_notifications_one_on_one_match_id
  on public.notifications ((meta_json->>'match_id')) where meta_json->>'match_id' is not null;

create or replace function public.record_one_on_one_notification_ending()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare reason text;
begin
  if old.state in ('source_skipped','candidate_rejected','source_declined','admin_canceled') then
    reason := old.state;
  elsif not exists(select 1 from auth.users where id=old.source_user_id)
     or not exists(select 1 from auth.users where id=old.candidate_user_id) then
    reason := 'account_deleted';
  elsif not exists(select 1 from public.dating_1on1_cards where id=old.source_card_id)
     or not exists(select 1 from public.dating_1on1_cards where id=old.candidate_card_id) then
    reason := 'profile_deleted';
  else reason := 'removed';
  end if;
  -- Auth cascades may reach the match before actor_id's SET NULL trigger.
  -- Touch only surviving recipients and clear only already-deleted actors.
  update public.notifications n set
    actor_id=case when exists(select 1 from auth.users where id=n.actor_id) then n.actor_id else null end,
    meta_json=coalesce(n.meta_json,'{}'::jsonb) || jsonb_build_object(
    'notification_end_reason',reason,'notification_ended_at',now(),
    'notification_end_role',case when n.user_id=old.source_user_id then 'source' else 'candidate' end)
  where n.meta_json->>'match_id'=old.id::text
    and n.user_id in (old.source_user_id,old.candidate_user_id)
    and exists(select 1 from auth.users where id=n.user_id);
  return old;
exception when others then
  -- An auxiliary explanation must never block a member's withdrawal or deletion.
  raise warning 'one-on-one notification ending unavailable: %', SQLSTATE;
  return old;
end;
$$;
revoke all on function public.record_one_on_one_notification_ending() from public;
drop trigger if exists trg_one_on_one_notification_ending on public.dating_1on1_match_proposals;
create trigger trg_one_on_one_notification_ending before delete on public.dating_1on1_match_proposals
  for each row execute function public.record_one_on_one_notification_ending();
commit;
