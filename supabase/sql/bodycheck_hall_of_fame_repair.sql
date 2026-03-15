begin;

create or replace function public.kst_week_bounds_from_week_id(p_week_id text)
returns table (
  week_id text,
  start_utc timestamptz,
  end_utc timestamptz
)
language plpgsql
stable
as $$
declare
  v_match text[];
  v_iso_year integer;
  v_iso_week integer;
  v_jan4_kst date;
  v_first_monday_kst date;
  v_start_kst timestamp;
begin
  v_match := regexp_match(trim(coalesce(p_week_id, '')), '^(\d{4})-W(\d{2})$');
  if v_match is null then
    raise exception 'INVALID_WEEK_ID';
  end if;

  v_iso_year := v_match[1]::integer;
  v_iso_week := v_match[2]::integer;
  if v_iso_week < 1 or v_iso_week > 53 then
    raise exception 'INVALID_WEEK_ID';
  end if;

  v_jan4_kst := make_date(v_iso_year, 1, 4);
  v_first_monday_kst := v_jan4_kst - ((extract(isodow from v_jan4_kst)::integer) - 1);
  v_start_kst := (v_first_monday_kst + ((v_iso_week - 1) * 7))::timestamp;

  week_id := p_week_id;
  start_utc := v_start_kst at time zone 'Asia/Seoul';
  end_utc := (v_start_kst + interval '1 week') at time zone 'Asia/Seoul';
  return next;
end;
$$;

create or replace function public.bodycheck_rebuild_post_score_weekly()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  delete from public.post_score_weekly;

  insert into public.post_score_weekly (
    week_id,
    post_id,
    gender,
    score_sum,
    vote_count,
    score_avg,
    updated_at
  )
  select
    public.kst_week_id(p.created_at) as week_id,
    v.post_id,
    coalesce(nullif(p.gender, ''), 'male') as gender,
    sum(v.value)::integer as score_sum,
    count(*)::integer as vote_count,
    case
      when count(*) > 0 then round(sum(v.value)::numeric / count(*)::numeric, 4)
      else 0
    end as score_avg,
    max(coalesce(v.updated_at, v.created_at)) as updated_at
  from public.votes v
  join public.posts p on p.id = v.post_id
  where p.type = 'photo_bodycheck'
    and public.kst_week_id(v.created_at) = public.kst_week_id(p.created_at)
  group by 1, 2, 3;

  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'ok', true,
    'rebuilt_rows', v_rows
  );
end;
$$;

create or replace function public.bodycheck_sync_weekly_winner(
  p_week_id text,
  p_min_votes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bounds record;
  v_male record;
  v_female record;
  v_male_nickname text;
  v_female_nickname text;
begin
  select * into v_bounds
  from public.kst_week_bounds_from_week_id(p_week_id);

  with male_ranked as (
    select
      psw.post_id,
      psw.score_sum,
      psw.score_avg,
      psw.vote_count,
      p.user_id,
      p.images
    from public.post_score_weekly psw
    join public.posts p on p.id = psw.post_id
    where psw.week_id = p_week_id
      and psw.gender = 'male'
      and psw.vote_count >= greatest(coalesce(p_min_votes, 0), 0)
    order by psw.score_sum desc, psw.score_avg desc, psw.vote_count desc, psw.updated_at asc
    limit 1
  ),
  male_fallback as (
    select
      psw.post_id,
      psw.score_sum,
      psw.score_avg,
      psw.vote_count,
      p.user_id,
      p.images
    from public.post_score_weekly psw
    join public.posts p on p.id = psw.post_id
    where psw.week_id = p_week_id
      and psw.gender = 'male'
    order by psw.score_sum desc, psw.score_avg desc, psw.vote_count desc, psw.updated_at asc
    limit 1
  )
  select * into v_male
  from (
    select * from male_ranked
    union all
    select * from male_fallback where not exists (select 1 from male_ranked)
  ) picked
  limit 1;

  with female_ranked as (
    select
      psw.post_id,
      psw.score_sum,
      psw.score_avg,
      psw.vote_count,
      p.user_id,
      p.images
    from public.post_score_weekly psw
    join public.posts p on p.id = psw.post_id
    where psw.week_id = p_week_id
      and psw.gender = 'female'
      and psw.vote_count >= greatest(coalesce(p_min_votes, 0), 0)
    order by psw.score_sum desc, psw.score_avg desc, psw.vote_count desc, psw.updated_at asc
    limit 1
  ),
  female_fallback as (
    select
      psw.post_id,
      psw.score_sum,
      psw.score_avg,
      psw.vote_count,
      p.user_id,
      p.images
    from public.post_score_weekly psw
    join public.posts p on p.id = psw.post_id
    where psw.week_id = p_week_id
      and psw.gender = 'female'
    order by psw.score_sum desc, psw.score_avg desc, psw.vote_count desc, psw.updated_at asc
    limit 1
  )
  select * into v_female
  from (
    select * from female_ranked
    union all
    select * from female_fallback where not exists (select 1 from female_ranked)
  ) picked
  limit 1;

  insert into public.weekly_winners (
    week_start,
    week_end,
    male_post_id,
    female_post_id,
    male_score,
    female_score
  )
  values (
    v_bounds.start_utc,
    v_bounds.end_utc,
    v_male.post_id,
    v_female.post_id,
    coalesce(v_male.score_sum, 0),
    coalesce(v_female.score_sum, 0)
  )
  on conflict (week_start)
  do update
  set week_end = excluded.week_end,
      male_post_id = excluded.male_post_id,
      female_post_id = excluded.female_post_id,
      male_score = excluded.male_score,
      female_score = excluded.female_score;

  if v_male.user_id is not null then
    select p.nickname into v_male_nickname
    from public.profiles p
    where p.user_id = v_male.user_id
    limit 1;

    insert into public.hall_of_fame (
      week_id,
      gender,
      post_id,
      user_id,
      nickname,
      image_url,
      score_avg,
      vote_count
    )
    values (
      p_week_id,
      'male',
      v_male.post_id,
      v_male.user_id,
      v_male_nickname,
      coalesce(v_male.images[1], null),
      coalesce(v_male.score_avg, 0),
      coalesce(v_male.vote_count, 0)
    )
    on conflict (week_id, gender)
    do update
    set post_id = excluded.post_id,
        user_id = excluded.user_id,
        nickname = excluded.nickname,
        image_url = excluded.image_url,
        score_avg = excluded.score_avg,
        vote_count = excluded.vote_count,
        created_at = now();
  else
    delete from public.hall_of_fame
    where week_id = p_week_id
      and gender = 'male';
  end if;

  if v_female.user_id is not null then
    select p.nickname into v_female_nickname
    from public.profiles p
    where p.user_id = v_female.user_id
    limit 1;

    insert into public.hall_of_fame (
      week_id,
      gender,
      post_id,
      user_id,
      nickname,
      image_url,
      score_avg,
      vote_count
    )
    values (
      p_week_id,
      'female',
      v_female.post_id,
      v_female.user_id,
      v_female_nickname,
      coalesce(v_female.images[1], null),
      coalesce(v_female.score_avg, 0),
      coalesce(v_female.vote_count, 0)
    )
    on conflict (week_id, gender)
    do update
    set post_id = excluded.post_id,
        user_id = excluded.user_id,
        nickname = excluded.nickname,
        image_url = excluded.image_url,
        score_avg = excluded.score_avg,
        vote_count = excluded.vote_count,
        created_at = now();
  else
    delete from public.hall_of_fame
    where week_id = p_week_id
      and gender = 'female';
  end if;

  return jsonb_build_object(
    'ok', true,
    'week_id', p_week_id,
    'male_post_id', v_male.post_id,
    'female_post_id', v_female.post_id
  );
end;
$$;

create or replace function public.bodycheck_backfill_hall_of_fame(
  p_latest_closed_week_id text default null,
  p_limit integer default 520,
  p_min_votes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_id text;
  v_latest_closed_week_id text := coalesce(p_latest_closed_week_id, public.kst_week_id(now() - interval '7 day'));
  v_processed integer := 0;
  v_processed_week_ids text[] := '{}';
begin
  for v_week_id in
    select week_id
    from (
      select distinct psw.week_id
      from public.post_score_weekly psw
      where psw.week_id <= v_latest_closed_week_id
      order by psw.week_id desc
      limit greatest(coalesce(p_limit, 520), 1)
    ) weeks
    order by week_id asc
  loop
    perform public.bodycheck_sync_weekly_winner(v_week_id, p_min_votes);
    v_processed := v_processed + 1;
    v_processed_week_ids := array_append(v_processed_week_ids, v_week_id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'latest_closed_week_id', v_latest_closed_week_id,
    'processed_count', v_processed,
    'processed_week_ids', v_processed_week_ids
  );
end;
$$;

grant execute on function public.kst_week_bounds_from_week_id(text) to authenticated, service_role;
grant execute on function public.bodycheck_rebuild_post_score_weekly() to authenticated, service_role;
grant execute on function public.bodycheck_sync_weekly_winner(text, integer) to authenticated, service_role;
grant execute on function public.bodycheck_backfill_hall_of_fame(text, integer, integer) to authenticated, service_role;

select public.bodycheck_rebuild_post_score_weekly();
select public.bodycheck_backfill_hall_of_fame();

commit;

notify pgrst, 'reload schema';
