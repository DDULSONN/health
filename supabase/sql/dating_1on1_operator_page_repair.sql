-- Operator-only session helper. No public RPC, grants, scheduled job, or writes
-- merely from loading this file. Run inside one transaction with reviewed plans.
-- The caller must use the production planner, compare age/region/repetition,
-- and supply a fresh plan plus the exact stored page inspected beforehand.
create or replace function pg_temp.repair_dating_1on1_page(
  p_user uuid, p_source uuid, p_expected_at timestamptz, p_source_key text,
  p_expected_main uuid[], p_expected_extra uuid[], p_main uuid[], p_extra uuid[],
  p_planned_at timestamptz, p_incident text
) returns text language plpgsql set search_path='' as $$
declare c public.dating_1on1_cards%rowtype; s public.dating_1on1_recommendation_pages%rowtype;
  ids uuid[]; users uuid[]; stamp timestamptz:=clock_timestamp();
begin
  if p_incident is distinct from 'regional-repeat-20261117' then return 'invalid_incident'; end if;
  -- Same source lock as member refresh; same hide lock as hide/restore actions.
  select * into c from public.dating_1on1_cards where id=p_source for update;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,17004));
  select * into s from public.dating_1on1_recommendation_pages where user_id=p_user for update;
  if exists(select 1 from public.notifications where user_id=p_user
      and meta_json->>'refresh_repair_incident'=p_incident) then return 'already_repaired'; end if;
  if c.id is null or s.user_id is null or c.user_id is distinct from p_user
    or c.status not in ('submitted','reviewing','approved') or s.source_card_id is distinct from c.id
    or c.birth_year not between 1960 and extract(year from stamp at time zone 'Asia/Seoul')::int-19
    or c.recommendation_refresh_used_at is distinct from p_expected_at
    or s.refreshed_at is distinct from p_expected_at or s.source_profile_key is distinct from p_source_key
    or md5(c.sex||':'||c.birth_year::text||':'||coalesce(c.region,'')) is distinct from p_source_key
    or s.main_candidate_ids is distinct from p_expected_main or s.extra_candidate_ids is distinct from p_expected_extra
    or p_planned_at is null or p_planned_at<stamp-interval '5 minutes' or p_planned_at>stamp+interval '5 seconds'
    or p_expected_at>=stamp then return 'stale_plan'; end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id where p.user_id=p_user
    and not coalesce(p.is_banned,false) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=stamp))
    then return 'source_unavailable'; end if;
  ids:=p_main||p_extra;
  if p_main is null or p_extra is null or coalesce(array_ndims(p_main),1)<>1 or coalesce(array_ndims(p_extra),1)<>1
    or cardinality(p_main)>10 or cardinality(p_extra)>3 or cardinality(ids)<cardinality(p_expected_main||p_expected_extra)
    or cardinality(ids)=0 or array_position(ids,null) is not null
    or cardinality(ids)<>(select count(distinct x) from unnest(ids) x)
    or not exists(select 1 from unnest(ids) x where not x=any(p_expected_main||p_expected_extra))
    then return 'invalid_page'; end if;
  select array_agg(distinct candidate.user_id) into users from public.dating_1on1_cards candidate
    join public.profiles p on p.user_id=candidate.user_id join auth.users u on u.id=candidate.user_id
    where candidate.id=any(ids) and candidate.user_id<>p_user and candidate.sex<>c.sex
      and candidate.status in ('submitted','reviewing','approved') and not coalesce(p.is_banned,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=stamp)
      and candidate.birth_year between 1960 and extract(year from stamp at time zone 'Asia/Seoul')::int-19;
  if cardinality(users) is distinct from cardinality(ids) then return 'candidate_unavailable'; end if;
  if exists(select 1 from public.dating_1on1_match_proposals m where
       ((m.source_user_id=p_user and m.candidate_user_id=any(users)) or (m.candidate_user_id=p_user and m.source_user_id=any(users)))
       and m.state not in ('source_skipped','admin_canceled'))
    or exists(select 1 from public.dating_1on1_candidate_hides h where h.user_id=p_user and h.candidate_user_id=any(users))
    or exists(select 1 from public.dating_1on1_candidate_favorites f where f.user_id=p_user and f.candidate_card_id=any(ids))
    or exists(select 1 from public.dating_user_blocks b where
       (b.blocker_user_id=p_user and b.blocked_user_id=any(users)) or (b.blocked_user_id=p_user and b.blocker_user_id=any(users)))
    or exists(select 1 from public.dating_1on1_admin_user_blocks b where
       (b.user_a_id=p_user and b.user_b_id=any(users)) or (b.user_b_id=p_user and b.user_a_id=any(users)))
    -- Existing phone exclusions come from the planner; reject any new phone
    -- block added by either side while this reviewed plan was being prepared.
    or exists(select 1 from public.dating_1on1_phone_blocks b where
       (b.user_id=p_user or b.user_id=any(users)) and b.created_at>=p_planned_at)
    then return 'candidate_excluded'; end if;
  -- Preserve a legacy paid use before changing its seed. The new event is free.
  -- Do not reset balances, extend Plus or alter any match/contact/payment data.
  if c.recommendation_refresh_used_at>stamp-interval '24 hours'
    and not exists(select 1 from public.dating_1on1_recommendation_refresh_events e where e.card_id=c.id
      and e.refreshed_at>stamp-interval '24 hours' and e.quota_refunded_at is null)
    and not exists(select 1 from public.dating_1on1_recommendation_refresh_events e where e.card_id=c.id
      and e.refreshed_at=c.recommendation_refresh_used_at and e.quota_refunded_at is not null) then
    insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
      values(c.id,p_user,c.recommendation_refresh_used_at);
  end if;
  insert into public.dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at,quota_refunded_at,rotation_only)
    values(c.id,p_user,stamp,stamp,true);
  update public.dating_1on1_cards set recommendation_refresh_used_at=stamp,updated_at=stamp where id=c.id;
  update public.dating_1on1_recommendation_pages set refreshed_at=stamp,main_candidate_ids=p_main,extra_candidate_ids=p_extra where user_id=p_user;
  -- The existing page-history trigger preserves both generations atomically.
  insert into public.notifications(user_id,type,meta_json) values(p_user,'comment',jsonb_build_object(
    'notification_type','dating_1on1_refresh_repaired','refresh_repair_incident',p_incident,
    'notification_title','1:1 추천 후보를 다시 정리했어요',
    'notification_body','일부 후보가 반복되는 추천 방식을 보완하고, 나이와 지역을 고려해 다른 후보로 목록을 다시 구성했어요. 새로고침 횟수와 기존 매칭은 그대로예요.',
    'notification_route','/community/dating/cards?tab=one_on_one'));
  return 'repaired';
end $$;
revoke all on function pg_temp.repair_dating_1on1_page(uuid,uuid,timestamptz,text,uuid[],uuid[],uuid[],uuid[],timestamptz,text) from public;
