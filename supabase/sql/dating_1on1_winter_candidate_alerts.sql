-- Optional, one-shot in-app alerts. No changes to recommendation pages, quota, or payments.
begin;

create table if not exists public.dating_1on1_winter_candidate_alerts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source_card_id uuid not null references public.dating_1on1_cards(id) on delete cascade,
  request_id uuid not null default gen_random_uuid(),
  requested_at timestamptz not null default clock_timestamp(),
  next_check_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz
);
create index if not exists dating_1on1_winter_alert_due_idx
  on public.dating_1on1_winter_candidate_alerts(next_check_at, user_id) where sent_at is null;
alter table public.dating_1on1_winter_candidate_alerts enable row level security;
revoke all on public.dating_1on1_winter_candidate_alerts from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.dating_1on1_winter_candidate_alerts to service_role;

create or replace function public.set_dating_1on1_winter_alert(p_user uuid, p_card uuid, p_enabled boolean)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_now timestamptz := clock_timestamp();
begin
  if p_user is null or p_card is null or p_enabled is null then return false; end if;
  if not p_enabled then
    delete from public.dating_1on1_winter_candidate_alerts where user_id=p_user and source_card_id=p_card;
    return false;
  end if;
  if not exists (select 1 from public.dating_1on1_cards c join public.profiles p on p.user_id=c.user_id
    where c.id=p_card and c.user_id=p_user and c.status in ('submitted','reviewing','approved')
      and coalesce(p.is_banned,false)=false and nullif(btrim(p.phone_e164),'') is not null) then return false; end if;

  insert into public.dating_1on1_winter_candidate_alerts(user_id,source_card_id,requested_at,next_check_at)
    values (p_user,p_card,v_now,v_now)
    on conflict (user_id) do update set source_card_id=excluded.source_card_id,request_id=excluded.request_id,
      requested_at=v_now,next_check_at=v_now,sent_at=null
    where dating_1on1_winter_candidate_alerts.source_card_id<>excluded.source_card_id
      or dating_1on1_winter_candidate_alerts.sent_at is not null
      or dating_1on1_winter_candidate_alerts.requested_at<=v_now-interval '7 days';
  return true;
end;
$$;

create or replace function public.claim_dating_1on1_winter_alert_checks(p_limit integer)
returns table(user_id uuid, source_card_id uuid, request_id uuid)
language sql security invoker set search_path=public,pg_temp as $$
  with due as (
    select a.user_id from public.dating_1on1_winter_candidate_alerts a
    where a.sent_at is null and a.requested_at>now()-interval '7 days' and a.next_check_at<=now()
    order by a.next_check_at,a.user_id limit least(12,greatest(coalesce(p_limit,0),0)) for update skip locked
  )
  update public.dating_1on1_winter_candidate_alerts a set next_check_at=now()+interval '4 hours'
  from due d where a.user_id=d.user_id returning a.user_id,a.source_card_id,a.request_id;
$$;

create or replace function public.deliver_dating_1on1_winter_alert(p_user uuid, p_card uuid, p_request uuid, p_day date)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); v_alert public.dating_1on1_winter_candidate_alerts%rowtype;
begin
  if p_day is distinct from (v_now at time zone 'Asia/Seoul')::date then return false; end if;
  select * into v_alert from public.dating_1on1_winter_candidate_alerts a where a.user_id=p_user for update;
  if not found or v_alert.source_card_id is distinct from p_card or v_alert.request_id is distinct from p_request
    or v_alert.sent_at is not null or v_alert.requested_at<=v_now-interval '7 days' then return false; end if;
  if exists(select 1 from public.dating_1on1_expansion_batches b where b.user_id=p_user and b.day_key=p_day)
    or not exists (select 1 from public.dating_1on1_cards c join public.profiles p on p.user_id=c.user_id
      where c.id=p_card and c.user_id=p_user and c.status in ('submitted','reviewing','approved')
        and coalesce(p.is_banned,false)=false and nullif(btrim(p.phone_e164),'') is not null) then return false; end if;

  insert into public.notifications(user_id,type,meta_json) values(p_user,'comment',jsonb_build_object(
    'notification_type','dating_1on1_winter_candidate_ready',
    'notification_title','근처에 새 후보가 있어요',
    'notification_body','아직 안 본 가까운 후보를 1:1 매칭에서 확인해 보세요. 새로고침 횟수는 그대로예요.',
    'notification_route','/community/dating/cards?tab=one_on_one#one-on-one-winter-candidates'
  ));
  update public.dating_1on1_winter_candidate_alerts set sent_at=v_now where user_id=p_user;
  return true;
end;
$$;

revoke all on function public.set_dating_1on1_winter_alert(uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_dating_1on1_winter_alert(uuid,uuid,boolean) to service_role;
revoke all on function public.claim_dating_1on1_winter_alert_checks(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_dating_1on1_winter_alert_checks(integer) to service_role;
revoke all on function public.deliver_dating_1on1_winter_alert(uuid,uuid,uuid,date) from public, anon, authenticated, service_role;
grant execute on function public.deliver_dating_1on1_winter_alert(uuid,uuid,uuid,date) to service_role;
commit;
notify pgrst,'reload schema';
