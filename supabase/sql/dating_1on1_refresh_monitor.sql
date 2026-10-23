-- Additive. Requires checked_refresh, repeat_rotation, recommendation_pages/history.
-- Default: observation only. No historical mass repair, quota grants or mail.
-- Rollout: install SQL, deploy code/cron with CRON_SECRET, then inspect the
-- admin 1:1 candidate tab in observe mode. Enable repair/email separately only
-- after reviewing actual results. Email requires existing Resend configuration.
-- One audit per member/KST day, processed in bounded hourly batches (20/run).
-- Records are generated after HTTP responses; missing telemetry is not proof
-- that a member never experienced a failure. No browser-only click diagnosis.
-- High overlap and distance/age concerns are review-only, never auto-blamed on
-- a bug. Repair requires a failed save, unchanged source seed/settings, and
-- originally available alternatives still matching age and known <=90km region
-- in the shared server planner. No repair of incidents older than 48h; at most
-- one repair/member/7 days. Current safety filters also run on every display GET.
-- Site notice + page + free seed are atomic. Email is once-reserved, opt-out
-- checked, sent only 09:00-20:00 KST; ambiguous outcomes are not retried later.
-- Stop: set mode=off in admin (or this settings table). This stops auditing,
-- repair and email, not diagnostics capture/retention. Do not drop tables while
-- the feature is running. Quota, favorites, matches, payments stay untouched.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create table if not exists public.dating_1on1_refresh_monitor_settings (
  singleton boolean primary key default true check(singleton),
  mode text not null default 'observe' check(mode in ('off','observe','repair')),
  email_enabled boolean not null default false
);
insert into public.dating_1on1_refresh_monitor_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.dating_1on1_refresh_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_card_id uuid not null references public.dating_1on1_cards(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  expected_refresh_at timestamptz, planned_at timestamptz not null,
  source_profile_key text not null,
  outcome text not null check(outcome in ('changed','rotated','unchanged','limited','conflict','failed')),
  persist_page boolean not null,
  changed_count integer not null check(changed_count between 0 and 13),
  rotated_count integer not null check(rotated_count between 0 and 13),
  before_candidate_ids uuid[] not null check(cardinality(before_candidate_ids)<=13),
  before_user_ids uuid[] not null check(cardinality(before_user_ids)<=13),
  after_user_ids uuid[] not null check(cardinality(after_user_ids)<=13),
  main_candidate_ids uuid[] not null check(cardinality(main_candidate_ids)<=10),
  extra_candidate_ids uuid[] not null check(cardinality(extra_candidate_ids)<=3),
  pool_count integer not null check(pool_count>=0),
  safe_local_change boolean not null,
  widened_count integer not null default 0 check(widened_count between 0 and 13),
  age_mismatch_count integer not null default 0 check(age_mismatch_count between 0 and 13)
);
create index if not exists dating_refresh_attempt_user_time on public.dating_1on1_refresh_attempts(user_id,created_at desc);
create index if not exists dating_refresh_attempt_time on public.dating_1on1_refresh_attempts(created_at);
create table if not exists public.dating_1on1_refresh_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_key date not null,
  attempt_id uuid not null references public.dating_1on1_refresh_attempts(id) on delete cascade,
  state text not null default 'queued' check(state in ('queued','running','done')),
  lease_token uuid, lease_until timestamptz, attempts integer not null default 0,
  finding text, checked_at timestamptz, repaired_at timestamptz,
  email_state text not null default 'none' check(email_state in ('none','pending','sending','sent','skipped','unknown')),
  unique(user_id,day_key)
);
create index if not exists dating_refresh_audit_queue on public.dating_1on1_refresh_audits(day_key,state);
create index if not exists dating_refresh_audit_email on public.dating_1on1_refresh_audits(email_state,repaired_at);

alter table public.dating_1on1_refresh_monitor_settings enable row level security;
alter table public.dating_1on1_refresh_attempts enable row level security;
alter table public.dating_1on1_refresh_audits enable row level security;
revoke all on public.dating_1on1_refresh_monitor_settings,public.dating_1on1_refresh_attempts,public.dating_1on1_refresh_audits from public,anon,authenticated,service_role;
grant select,update on public.dating_1on1_refresh_monitor_settings to service_role;
grant select,insert on public.dating_1on1_refresh_attempts to service_role;
grant select,update on public.dating_1on1_refresh_audits to service_role;

create or replace function public.queue_dating_1on1_refresh_audit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.dating_1on1_refresh_audits(user_id,day_key,attempt_id)
    values(new.user_id,(new.created_at at time zone 'Asia/Seoul')::date,new.id)
    on conflict(user_id,day_key) do update set attempt_id=excluded.attempt_id
      where public.dating_1on1_refresh_audits.state='queued'
        and (select a.planned_at from public.dating_1on1_refresh_attempts a
          where a.id=public.dating_1on1_refresh_audits.attempt_id)<new.planned_at;
  return new;
end $$;
revoke all on function public.queue_dating_1on1_refresh_audit() from public,anon,authenticated;
drop trigger if exists queue_dating_1on1_refresh_audit on public.dating_1on1_refresh_attempts;
create trigger queue_dating_1on1_refresh_audit after insert on public.dating_1on1_refresh_attempts
  for each row execute function public.queue_dating_1on1_refresh_audit();

create or replace function public.claim_dating_1on1_refresh_audit()
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.dating_1on1_refresh_audits%rowtype; v_now timestamptz:=clock_timestamp();
begin
  -- A bounded retention batch; audit rows cascade with their attempts.
  delete from public.dating_1on1_refresh_attempts where id in
    (select id from public.dating_1on1_refresh_attempts where created_at<v_now-interval '30 days' order by created_at limit 1000);
  update public.dating_1on1_refresh_audits set email_state='skipped' where id in
    (select id from public.dating_1on1_refresh_audits where email_state='pending' and repaired_at<v_now-interval '24 hours' limit 100);
  update public.dating_1on1_refresh_audits set email_state='unknown' where id in
    (select id from public.dating_1on1_refresh_audits where email_state='sending' and repaired_at<v_now-interval '1 hour' limit 100);
  if not exists(select 1 from public.dating_1on1_refresh_monitor_settings where mode<>'off') then return null; end if;
  update public.dating_1on1_refresh_audits set state='done',finding='check_failed',checked_at=v_now
    where id in (select id from public.dating_1on1_refresh_audits
      where state='running' and lease_until<v_now and attempts>=3 limit 100);
  select * into j from public.dating_1on1_refresh_audits
    where day_key<(v_now at time zone 'Asia/Seoul')::date
      and (state='queued' or (state='running' and lease_until<v_now and attempts<3))
    order by day_key,id for update skip locked limit 1;
  if j.id is null then return null; end if;
  update public.dating_1on1_refresh_audits set state='running',lease_token=gen_random_uuid(),
    lease_until=v_now+interval '5 minutes',attempts=attempts+1 where id=j.id returning * into j;
  return jsonb_build_object('job',to_jsonb(j),'attempt',(select to_jsonb(a) from public.dating_1on1_refresh_attempts a where a.id=j.attempt_id));
end $$;
revoke all on function public.claim_dating_1on1_refresh_audit() from public,anon,authenticated;
grant execute on function public.claim_dating_1on1_refresh_audit() to service_role;

create or replace function public.repair_dating_1on1_refresh_audit(
  p_job_id uuid,p_token uuid,p_refresh_at timestamptz,p_main uuid[],p_extra uuid[],p_source_key text
) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.dating_1on1_refresh_audits%rowtype; a public.dating_1on1_refresh_attempts%rowtype;
  c public.dating_1on1_cards%rowtype; ids uuid[]; v_now timestamptz:=clock_timestamp(); n integer;
begin
  -- Some older installations do not have member-pair blocking yet. Never
  -- bypass this safety check or fail midway through a candidate replacement.
  if to_regclass('public.dating_user_blocks') is null then return false; end if;
  select * into j from public.dating_1on1_refresh_audits where id=p_job_id;
  select * into a from public.dating_1on1_refresh_attempts where id=j.attempt_id;
  -- Source card first: same lock order as member-initiated refresh transactions.
  select * into c from public.dating_1on1_cards where id=a.source_card_id for update;
  select * into j from public.dating_1on1_refresh_audits where id=p_job_id for update;
  if j.state is distinct from 'running' or j.lease_token is distinct from p_token or j.lease_until<v_now
    or j.repaired_at is not null or a.created_at<v_now-interval '48 hours'
    or a.outcome<>'failed' or not a.persist_page or not a.safe_local_change or a.rotated_count<1
    or not exists(select 1 from public.dating_1on1_refresh_monitor_settings where mode='repair') then return false; end if;
  if c.id is null or c.user_id is distinct from a.user_id or c.status not in ('submitted','reviewing','approved')
    or c.recommendation_refresh_used_at is distinct from a.expected_refresh_at
    or p_refresh_at is null or p_refresh_at<v_now-interval '2 minutes' or p_refresh_at>v_now+interval '5 seconds'
    or (c.recommendation_refresh_used_at is not null and p_refresh_at<=c.recommendation_refresh_used_at)
    or md5(c.sex||':'||c.birth_year::text||':'||coalesce(c.region,'')) is distinct from p_source_key
    or a.source_profile_key is distinct from p_source_key then return false; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
      where p.user_id=a.user_id and not coalesce(p.is_banned,false) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=v_now)) then return false; end if;
  if exists(select 1 from public.dating_1on1_refresh_attempts newer where newer.user_id=a.user_id and newer.planned_at>a.planned_at)
    or exists(select 1 from public.dating_1on1_refresh_audits prior where prior.user_id=a.user_id
      and prior.repaired_at>v_now-interval '7 days') then return false; end if;
  ids:=p_main||p_extra;
  if p_main is null or p_extra is null or coalesce(array_ndims(p_main),1)<>1 or coalesce(array_ndims(p_extra),1)<>1
    or cardinality(p_main)>10 or cardinality(p_extra)>3 or cardinality(ids)=0
    or array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct x) from unnest(ids) x)
    or not exists(select 1 from unnest(ids) x where x=any(a.main_candidate_ids||a.extra_candidate_ids)
      and not x=any(a.before_candidate_ids)) then return false; end if;
  select count(distinct candidate.user_id)::integer into n from public.dating_1on1_cards candidate
    join public.profiles p on p.user_id=candidate.user_id join auth.users u on u.id=candidate.user_id
    where candidate.id=any(ids) and candidate.user_id<>a.user_id and candidate.sex<>c.sex
      and candidate.status in ('submitted','reviewing','approved') and not coalesce(p.is_banned,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=v_now);
  if n<>cardinality(ids) then return false; end if;
  -- Recheck user-pair states at the write boundary. Phone/contact-block and
  -- current-identity filters also run in the shared planner AND every display GET.
  if exists(select 1 from public.dating_1on1_match_proposals m where
      (m.source_user_id=a.user_id and m.candidate_user_id in (select user_id from public.dating_1on1_cards where id=any(ids))
       or m.candidate_user_id=a.user_id and m.source_user_id in (select user_id from public.dating_1on1_cards where id=any(ids)))
      and m.state not in ('source_skipped','admin_canceled'))
    or exists(select 1 from public.dating_1on1_candidate_favorites f where f.user_id=a.user_id and f.candidate_card_id=any(ids))
    or exists(select 1 from public.dating_user_blocks b where
      (b.blocker_user_id=a.user_id and b.blocked_user_id in (select user_id from public.dating_1on1_cards where id=any(ids)))
      or (b.blocked_user_id=a.user_id and b.blocker_user_id in (select user_id from public.dating_1on1_cards where id=any(ids))))
    or exists(select 1 from public.dating_1on1_admin_user_blocks b where
      (b.user_a_id=a.user_id and b.user_b_id in (select user_id from public.dating_1on1_cards where id=any(ids)))
      or (b.user_b_id=a.user_id and b.user_a_id in (select user_id from public.dating_1on1_cards where id=any(ids)))) then return false; end if;
  -- Preserve a legacy charged use before advancing the seed. Never touch bonus
  -- balances, purchases, favorites, matches or exchanged contact information.
  if c.recommendation_refresh_used_at>v_now-interval '24 hours'
    and not exists(select 1 from public.dating_1on1_recommendation_refresh_events e
      where e.card_id=c.id and e.refreshed_at>v_now-interval '24 hours' and e.quota_refunded_at is null)
    and not exists(select 1 from public.dating_1on1_recommendation_refresh_events e
      where e.card_id=c.id and e.refreshed_at=c.recommendation_refresh_used_at and e.quota_refunded_at is not null) then
    insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
      values(c.id,a.user_id,c.recommendation_refresh_used_at);
  end if;
  insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at,quota_refunded_at,rotation_only)
    values(c.id,a.user_id,p_refresh_at,v_now,true);
  update public.dating_1on1_cards set recommendation_refresh_used_at=p_refresh_at,updated_at=v_now where id=c.id;
  insert into public.dating_1on1_recommendation_pages(user_id,source_card_id,refreshed_at,source_profile_key,main_candidate_ids,extra_candidate_ids)
    values(a.user_id,c.id,p_refresh_at,p_source_key,p_main,p_extra)
    on conflict(user_id) do update set source_card_id=excluded.source_card_id,refreshed_at=excluded.refreshed_at,
      source_profile_key=excluded.source_profile_key,main_candidate_ids=excluded.main_candidate_ids,extra_candidate_ids=excluded.extra_candidate_ids;
  insert into public.notifications(user_id,type,meta_json) values(a.user_id,'comment',jsonb_build_object(
    'notification_type','dating_1on1_refresh_repaired','audit_id',j.id,'notification_title','1:1 후보 새로고침을 복구했어요',
    'notification_body','새로고침 처리 오류를 확인해 후보 목록을 복구했어요. 횟수는 사용하지 않았고 진행 중인 매칭은 그대로예요.',
    'notification_route','/community/dating/cards?tab=one_on_one'));
  update public.dating_1on1_refresh_audits set state='done',finding='repaired',repaired_at=p_refresh_at,checked_at=v_now,
    email_state=case when (select email_enabled from public.dating_1on1_refresh_monitor_settings) then 'pending' else 'none' end
    where id=j.id;
  return true;
end $$;
revoke all on function public.repair_dating_1on1_refresh_audit(uuid,uuid,timestamptz,uuid[],uuid[],text) from public,anon,authenticated;
grant execute on function public.repair_dating_1on1_refresh_audit(uuid,uuid,timestamptz,uuid[],uuid[],text) to service_role;
commit;
notify pgrst,'reload schema';
