-- Repair stale nearby-view pending requests that still block re-apply
-- after a later rejected/approved review already exists.
--
-- Safe scope:
-- - only rows with status = 'pending'
-- - only rows that are older than the latest reviewed row
--   for the same user + normalized province
-- - leaves currently valid pending requests untouched
--
-- Usage:
-- 1. Run the preview SELECT first.
-- 2. Confirm the rows look correct.
-- 3. Then run the UPDATE section.

begin;

with normalized_rows as (
  select
    r.id,
    r.user_id,
    r.city,
    r.status,
    r.note,
    r.created_at,
    r.reviewed_at,
    r.access_expires_at,
    case
      when r.city like '서울%' then '서울'
      when r.city like '부산%' then '부산'
      when r.city like '대구%' then '대구'
      when r.city like '인천%' then '인천'
      when r.city like '광주%' then '광주'
      when r.city like '대전%' then '대전'
      when r.city like '울산%' then '울산'
      when r.city like '세종%' then '세종'
      when r.city like '경기%' then '경기'
      when r.city like '강원%' then '강원'
      when r.city like '충북%' then '충북'
      when r.city like '충남%' then '충남'
      when r.city like '전북%' then '전북'
      when r.city like '전남%' then '전남'
      when r.city like '경북%' then '경북'
      when r.city like '경남%' then '경남'
      when r.city like '제주%' then '제주'
      else trim(r.city)
    end as normalized_province,
    coalesce(r.reviewed_at, r.created_at) as row_time
  from public.dating_city_view_requests r
),
latest_reviewed as (
  select
    user_id,
    normalized_province,
    max(row_time) as latest_reviewed_time
  from normalized_rows
  where status in ('approved', 'rejected')
  group by user_id, normalized_province
),
target_rows as (
  select
    n.id,
    n.user_id,
    n.city,
    n.normalized_province,
    n.status,
    n.created_at,
    n.reviewed_at,
    lr.latest_reviewed_time
  from normalized_rows n
  join latest_reviewed lr
    on lr.user_id = n.user_id
   and lr.normalized_province = n.normalized_province
  where n.status = 'pending'
    and n.row_time < lr.latest_reviewed_time
)
select
  id,
  user_id,
  city,
  normalized_province,
  status,
  created_at,
  reviewed_at,
  latest_reviewed_time
from target_rows
order by user_id, normalized_province, created_at asc;

with normalized_rows as (
  select
    r.id,
    r.user_id,
    r.city,
    r.status,
    r.note,
    r.created_at,
    r.reviewed_at,
    case
      when r.city like '서울%' then '서울'
      when r.city like '부산%' then '부산'
      when r.city like '대구%' then '대구'
      when r.city like '인천%' then '인천'
      when r.city like '광주%' then '광주'
      when r.city like '대전%' then '대전'
      when r.city like '울산%' then '울산'
      when r.city like '세종%' then '세종'
      when r.city like '경기%' then '경기'
      when r.city like '강원%' then '강원'
      when r.city like '충북%' then '충북'
      when r.city like '충남%' then '충남'
      when r.city like '전북%' then '전북'
      when r.city like '전남%' then '전남'
      when r.city like '경북%' then '경북'
      when r.city like '경남%' then '경남'
      when r.city like '제주%' then '제주'
      else trim(r.city)
    end as normalized_province,
    coalesce(r.reviewed_at, r.created_at) as row_time
  from public.dating_city_view_requests r
),
latest_reviewed as (
  select
    user_id,
    normalized_province,
    max(row_time) as latest_reviewed_time
  from normalized_rows
  where status in ('approved', 'rejected')
  group by user_id, normalized_province
),
target_rows as (
  select n.id
  from normalized_rows n
  join latest_reviewed lr
    on lr.user_id = n.user_id
   and lr.normalized_province = n.normalized_province
  where n.status = 'pending'
    and n.row_time < lr.latest_reviewed_time
)
update public.dating_city_view_requests r
set
  status = 'rejected',
  reviewed_at = coalesce(r.reviewed_at, now()),
  note = case
    when r.note is null or trim(r.note) = '' then 'stale pending cleanup'
    else r.note || ' | stale pending cleanup'
  end
from target_rows t
where r.id = t.id
returning
  r.id,
  r.user_id,
  r.city,
  r.status,
  r.reviewed_at,
  r.note;

commit;
