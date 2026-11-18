-- Additive, disabled by default. Install before the matching deployment.
-- partial_enabled replaces the legacy failed-save repair path, not member refresh.
-- Activate only after verification: mode='repair', partial_enabled=true,
-- email_enabled=true. mode='off' stops ALL auditing/repair/mail.
-- Scan recent 7-day refresh users once/KST day; retry leases at most 3 times.
-- Only 1-3 main slots change, at most once/24h; extras, hidden slots, matches,
-- payments, contact disclosure and regular/bonus quota are not changed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.dating_1on1_refresh_monitor_settings add column if not exists partial_enabled boolean not null default false;
alter table public.dating_1on1_refresh_audits add column if not exists repair_count integer not null default 0 check(repair_count between 0 and 3);
alter table public.dating_1on1_refresh_audits add column if not exists repair_main_ids uuid[];
alter table public.dating_1on1_refresh_audits add column if not exists repair_extra_ids uuid[];

create or replace function public.claim_dating_1on1_refresh_audit()
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.dating_1on1_refresh_audits%rowtype; v_now timestamptz:=clock_timestamp();
  v_day date:=(v_now at time zone 'Asia/Seoul')::date; v_partial boolean; v_mode text;
begin
  delete from public.dating_1on1_refresh_attempts where id in
    (select id from public.dating_1on1_refresh_attempts where created_at<v_now-interval '30 days' order by created_at limit 1000);
  update public.dating_1on1_refresh_audits set email_state='skipped' where id in
    (select id from public.dating_1on1_refresh_audits where email_state='pending' and repaired_at<v_now-interval '24 hours' limit 100);
  update public.dating_1on1_refresh_audits set email_state='unknown' where id in
    (select id from public.dating_1on1_refresh_audits where email_state='sending' and repaired_at<v_now-interval '1 hour' limit 100);
  select mode,partial_enabled into v_mode,v_partial from public.dating_1on1_refresh_monitor_settings where singleton;
  if v_mode is null or v_mode='off' then return null; end if;
  update public.dating_1on1_refresh_audits set state='done',finding='check_failed',checked_at=v_now
    where id in (select id from public.dating_1on1_refresh_audits where state='running' and lease_until<v_now and attempts>=3 limit 100);
  if v_partial then
    -- Indexed and bounded; no new refresh is required to recheck a stuck page.
    insert into public.dating_1on1_refresh_audits(user_id,day_key,attempt_id)
      select s.user_id,v_day,a.id from public.dating_1on1_recommendation_pages s
      join public.dating_1on1_cards c on c.id=s.source_card_id and c.user_id=s.user_id
      join lateral (select r.id,r.created_at from public.dating_1on1_refresh_attempts r
        where r.user_id=s.user_id and r.source_card_id=s.source_card_id and r.created_at>=v_now-interval '7 days'
        order by r.created_at desc,r.id desc limit 1) a on true
      where c.status in ('submitted','reviewing','approved') and s.refreshed_at=c.recommendation_refresh_used_at
        and not exists(select 1 from public.dating_1on1_refresh_audits done where done.user_id=s.user_id and done.day_key=v_day)
      order by a.created_at desc,s.user_id limit 100 on conflict(user_id,day_key) do nothing;
  end if;
  select * into j from public.dating_1on1_refresh_audits
    where (case when v_partial then day_key=v_day else day_key<v_day end)
      and (not v_partial or exists(select 1 from public.dating_1on1_refresh_attempts quiet
        where quiet.id=attempt_id and quiet.planned_at<v_now-interval '10 minutes'))
      and (state='queued' or (state='running' and lease_until<v_now and attempts<3)
        or (v_partial and v_mode='repair' and state='done' and finding='partial_ready' and repaired_at is null and attempts<3))
    order by day_key,id for update skip locked limit 1;
  if j.id is null then return null; end if;
  update public.dating_1on1_refresh_audits set state='running',lease_token=gen_random_uuid(),
    lease_until=v_now+interval '5 minutes',attempts=attempts+1 where id=j.id returning * into j;
  return jsonb_build_object('job',to_jsonb(j),'attempt',(select to_jsonb(a) from public.dating_1on1_refresh_attempts a where a.id=j.attempt_id));
end $$;
revoke all on function public.claim_dating_1on1_refresh_audit() from public,anon,authenticated;
grant execute on function public.claim_dating_1on1_refresh_audit() to service_role;

create or replace function public.repair_dating_1on1_partial_audit(p_job uuid,p_token uuid,p_plan jsonb)
returns text language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='15s' as $$
declare j public.dating_1on1_refresh_audits%rowtype; a public.dating_1on1_refresh_attempts%rowtype;
  c public.dating_1on1_cards%rowtype; s public.dating_1on1_recommendation_pages%rowtype;
  stamp timestamptz:=clock_timestamp(); planned timestamptz; ids uuid[]; users uuid[];
  main uuid[]; extra uuid[]; expected_main uuid[]; expected_extra uuid[]; incoming uuid[]; outgoing uuid[];
  change_count int; repeat_count int; profile_count int; source_id uuid;
begin
  select * into j from public.dating_1on1_refresh_audits where id=p_job;
  select * into a from public.dating_1on1_refresh_attempts where id=j.attempt_id;
  if a.id is null or a.user_id is distinct from j.user_id then return 'invalid_job'; end if;
  source_id:=(p_plan->>'source_card_id')::uuid;
  select * into c from public.dating_1on1_cards where id=source_id for update;
  perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,17004));
  select * into s from public.dating_1on1_recommendation_pages where user_id=j.user_id for update;
  select * into j from public.dating_1on1_refresh_audits where id=p_job for update;
  if j.repaired_at is not null then return 'already_repaired'; end if;
  if j.state is distinct from 'running' or j.lease_token is distinct from p_token or j.lease_until<stamp
    or a.created_at<stamp-interval '7 days'
    or not exists(select 1 from public.dating_1on1_refresh_monitor_settings where mode='repair' and partial_enabled)
    then return 'inactive_job'; end if;
  planned:=(p_plan->>'refresh_at')::timestamptz;
  expected_main:=array(select jsonb_array_elements_text(p_plan->'partial'->'expected_main')::uuid);
  expected_extra:=array(select jsonb_array_elements_text(p_plan->'partial'->'expected_extra')::uuid);
  main:=array(select jsonb_array_elements_text(p_plan->'main_candidate_ids')::uuid);
  extra:=array(select jsonb_array_elements_text(p_plan->'extra_candidate_ids')::uuid);
  if c.id is null or s.user_id is null or c.user_id is distinct from j.user_id or c.id is distinct from a.source_card_id
    or c.status not in ('submitted','reviewing','approved') or s.source_card_id is distinct from c.id
    or c.birth_year not between 1960 and extract(year from stamp at time zone 'Asia/Seoul')::int-19
    or c.recommendation_refresh_used_at is distinct from (p_plan->>'expected_refresh_used_at')::timestamptz
    or s.refreshed_at is distinct from c.recommendation_refresh_used_at
    or s.source_profile_key is distinct from p_plan->>'source_profile_key'
    or md5(c.sex||':'||c.birth_year::text||':'||coalesce(c.region,'')) is distinct from s.source_profile_key
    or s.main_candidate_ids is distinct from expected_main or s.extra_candidate_ids is distinct from expected_extra
    or planned is null or planned<stamp-interval '2 minutes' or planned>stamp+interval '5 seconds'
    or s.refreshed_at>=planned or coalesce((p_plan->>'persist_page')::boolean,false)=false
    then return 'stale_plan'; end if;
  if exists(select 1 from public.dating_1on1_refresh_audits prior where prior.user_id=j.user_id and prior.repaired_at>stamp-interval '24 hours')
    or exists(select 1 from public.notifications n where n.user_id=j.user_id and n.created_at>stamp-interval '24 hours'
      and (n.meta_json->>'notification_type'='dating_1on1_refresh_repaired' or n.meta_json ? 'refresh_repair_incident'))
    then return 'cooldown'; end if;
  ids:=main||extra;
  incoming:=array(select main[i] from generate_subscripts(main,1) i where main[i] is distinct from expected_main[i]);
  outgoing:=array(select expected_main[i] from generate_subscripts(main,1) i where main[i] is distinct from expected_main[i]);
  change_count:=cardinality(incoming);
  if cardinality(main)<>cardinality(expected_main) or extra is distinct from expected_extra
    or cardinality(main)>10 or cardinality(extra)>3 or cardinality(ids)<5 or change_count not between 1 and 3
    or change_count is distinct from (p_plan->>'changed_candidate_count')::int
    or change_count is distinct from (p_plan->>'rotated_candidate_count')::int
    or not coalesce((p_plan->'monitor'->>'safe_local_change')::boolean,false)
    or array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct x) from unnest(ids) x)
    or exists(select 1 from unnest(incoming) x where x=any(expected_main||expected_extra))
    then return 'invalid_partial'; end if;
  -- Lock/compare exactly the small snapshot whose age and distance were ranked.
  perform 1 from public.dating_1on1_cards where id=any(ids||outgoing) order by id for share;
  select count(*) into profile_count from jsonb_to_recordset(p_plan->'partial'->'profiles')
    as p(id uuid,user_id uuid,sex text,birth_year int,region text,status text,phone_key text)
    join public.dating_1on1_cards d on d.id=p.id and d.user_id=p.user_id and d.sex=p.sex
      and d.birth_year=p.birth_year and d.region is not distinct from p.region and d.status=p.status
    join public.profiles identity on identity.user_id=d.user_id
      and md5(right(regexp_replace(coalesce(nullif(identity.phone_e164,''),d.phone,''),'[^0-9]','','g'),10))=p.phone_key;
  if profile_count<>(select count(distinct x) from unnest(ids||outgoing||array[c.id]) x)
    or profile_count<>jsonb_array_length(p_plan->'partial'->'profiles') then return 'profile_changed'; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id where p.user_id=j.user_id
    and not coalesce(p.is_banned,false) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=stamp))
    then return 'source_unavailable'; end if;
  select array_agg(distinct d.user_id) into users from public.dating_1on1_cards d
    join public.profiles p on p.user_id=d.user_id join auth.users u on u.id=d.user_id
    where d.id=any(ids) and d.user_id<>j.user_id and d.sex<>c.sex and d.status in ('submitted','reviewing','approved')
      and not coalesce(p.is_banned,false) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=stamp)
      and d.birth_year between 1960 and extract(year from stamp at time zone 'Asia/Seoul')::int-19;
  if cardinality(users) is distinct from cardinality(ids) then return 'candidate_unavailable'; end if;
  if exists(select 1 from public.dating_1on1_cards d where d.id=any(incoming)
      and d.birth_year not between c.birth_year-case when c.sex='male' then 1 else 4 end
        and c.birth_year+case when c.sex='male' then 4 else 1 end)
    or jsonb_array_length(p_plan->'partial'->'changes') is distinct from change_count
    or (select count(distinct x->>'index') from jsonb_array_elements(p_plan->'partial'->'changes') x)<>change_count
    or exists(select 1 from jsonb_to_recordset(p_plan->'partial'->'changes')
      as x(index int,"from" uuid,"to" uuid,"beforeKm" numeric,"afterKm" numeric)
      where x.index is null or x.index<0 or x.index>=cardinality(main)
        or main[x.index+1] is distinct from x."to" or expected_main[x.index+1] is distinct from x."from"
        or x."afterKm" is null or x."beforeKm" is null or x."afterKm"<0 or x."afterKm">90
        or x."afterKm">x."beforeKm"+0.01) then return 'fit_changed'; end if;
  -- Repeat means a real impression BEFORE this generation, not just its views.
  select count(distinct d.id) into repeat_count from public.dating_1on1_cards d
    where d.id=any(expected_main||expected_extra) and exists(select 1 from public.dating_1on1_candidate_impressions i
      where i.viewer_user_id=j.user_id and i.candidate_user_id=d.user_id
        and i.first_seen_at>=greatest(stamp-interval '30 days',c.created_at) and i.first_seen_at<s.refreshed_at);
  if repeat_count<ceil(cardinality(ids)/2.0) or exists(select 1 from public.dating_1on1_cards d where d.id=any(outgoing)
    and not exists(select 1 from public.dating_1on1_candidate_impressions i where i.viewer_user_id=j.user_id
      and i.candidate_user_id=d.user_id and i.first_seen_at>=greatest(stamp-interval '30 days',c.created_at) and i.first_seen_at<s.refreshed_at))
    then return 'not_repeated'; end if;
  if exists(select 1 from public.dating_1on1_cards d where d.id=any(incoming) and exists(
      select 1 from public.dating_1on1_candidate_impressions i where i.viewer_user_id=j.user_id and i.candidate_user_id=d.user_id
        and i.first_seen_at>=stamp-interval '30 days'))
    or exists(select 1 from public.dating_1on1_recommendation_page_history h where h.user_id=j.user_id
      and h.refreshed_at>=stamp-interval '30 days' and incoming&&(h.main_candidate_ids||h.extra_candidate_ids))
    or exists(select 1 from public.dating_1on1_expansion_batches b where b.user_id=j.user_id
      and b.day_key>=(stamp at time zone 'Asia/Seoul')::date-30 and incoming&&b.candidate_ids)
    then return 'already_seen'; end if;
  if exists(select 1 from public.dating_1on1_match_proposals m where
      ((m.source_user_id=j.user_id and m.candidate_user_id=any(users)) or (m.candidate_user_id=j.user_id and m.source_user_id=any(users)))
      and m.state not in ('source_skipped','admin_canceled'))
    or exists(select 1 from public.dating_1on1_candidate_hides h where h.user_id=j.user_id and h.candidate_user_id=any(users))
    or exists(select 1 from public.dating_1on1_candidate_favorites f where f.user_id=j.user_id and f.candidate_card_id=any(ids))
    or exists(select 1 from public.dating_user_blocks b where
      (b.blocker_user_id=j.user_id and b.blocked_user_id=any(users)) or (b.blocked_user_id=j.user_id and b.blocker_user_id=any(users)))
    or exists(select 1 from public.dating_1on1_admin_user_blocks b where
      (b.user_a_id=j.user_id and b.user_b_id=any(users)) or (b.user_b_id=j.user_id and b.user_a_id=any(users)))
    or exists(select 1 from public.dating_1on1_phone_blocks b where (b.user_id=j.user_id or b.user_id=any(users)) and b.created_at>=planned)
    or exists(select 1 from public.dating_contact_blocks b where (b.user_id=j.user_id or b.user_id=any(users)) and b.created_at>=planned)
    or exists(select 1 from public.dating_1on1_cards d join public.dating_1on1_cards newer on newer.user_id=d.user_id
      and newer.status in ('submitted','reviewing','approved') and (newer.created_at,newer.id)>(d.created_at,d.id)
      where d.id=any(ids||array[c.id])) then return 'candidate_excluded'; end if;
  -- Incoming people with previously ended requests are not fresh candidates.
  if exists(select 1 from public.dating_1on1_match_proposals m join public.dating_1on1_cards d on d.id=any(incoming)
    where (m.source_user_id=j.user_id and m.candidate_user_id=d.user_id) or (m.candidate_user_id=j.user_id and m.source_user_id=d.user_id))
    then return 'candidate_excluded'; end if;
  if c.recommendation_refresh_used_at>stamp-interval '24 hours'
    and not exists(select 1 from public.dating_1on1_recommendation_refresh_events e where e.card_id=c.id
      and e.refreshed_at>stamp-interval '24 hours' and e.quota_refunded_at is null)
    and not exists(select 1 from public.dating_1on1_recommendation_refresh_events e where e.card_id=c.id
      and e.refreshed_at=c.recommendation_refresh_used_at and e.quota_refunded_at is not null) then
    insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
      values(c.id,j.user_id,c.recommendation_refresh_used_at);
  end if;
  insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at,quota_refunded_at,rotation_only)
    values(c.id,j.user_id,stamp,stamp,true);
  update public.dating_1on1_cards set recommendation_refresh_used_at=stamp,updated_at=stamp where id=c.id;
  update public.dating_1on1_recommendation_pages set refreshed_at=stamp,main_candidate_ids=main where user_id=j.user_id;
  insert into public.notifications(user_id,type,meta_json) values(j.user_id,'comment',jsonb_build_object(
    'notification_type','dating_1on1_refresh_repaired','audit_id',j.id,'partial_repair',true,'changed_count',change_count,
    'notification_title','1:1 후보를 일부 새로 담았어요',
    'notification_body','반복해서 보였던 후보 일부를 나이와 지역을 고려한 다른 후보로 바꿨어요. 새로고침 횟수와 기존 매칭은 그대로예요.',
    'notification_route','/community/dating/cards?tab=one_on_one'));
  update public.dating_1on1_refresh_audits set state='done',finding='partial_repaired',repaired_at=stamp,checked_at=stamp,
    repair_count=change_count,repair_main_ids=main,repair_extra_ids=extra,
    email_state=case when (select email_enabled from public.dating_1on1_refresh_monitor_settings where singleton) then 'pending' else 'none' end
    where id=j.id;
  return 'repaired';
end $$;
revoke all on function public.repair_dating_1on1_partial_audit(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.repair_dating_1on1_partial_audit(uuid,uuid,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
