begin;

create or replace function public.bodybattle_finalize_season(p_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season public.bodybattle_seasons%rowtype;
  v_top10 jsonb;
  v_champion public.bodybattle_entries%rowtype;
begin
  select *
  into v_season
  from public.bodybattle_seasons
  where id = p_season_id
  for update;

  if not found then
    raise exception 'SEASON_NOT_FOUND';
  end if;

  with strict_eligible as (
    select e.*
    from public.bodybattle_entries e
    where e.season_id = p_season_id
      and e.moderation_status = 'approved'
      and e.status <> 'hidden'
      and e.exposures >= 20
      and e.votes_received >= 30
      and coalesce(e.report_count, 0) < 5
  ),
  strict_ranked as (
    select
      e.*,
      row_number() over (
        order by e.rating desc,
                 (case when (e.wins + e.losses + e.draws) > 0 then e.wins::numeric / (e.wins + e.losses + e.draws) else 0 end) desc,
                 e.votes_received desc,
                 e.wins desc,
                 e.exposures desc,
                 e.created_at asc
      ) as rank_no
    from strict_eligible e
  ),
  fallback_eligible as (
    select e.*
    from public.bodybattle_entries e
    where e.season_id = p_season_id
      and e.moderation_status = 'approved'
      and e.status <> 'hidden'
      and coalesce(e.report_count, 0) < 5
  ),
  fallback_ranked as (
    select
      e.*,
      row_number() over (
        order by e.rating desc,
                 (case when (e.wins + e.losses + e.draws) > 0 then e.wins::numeric / (e.wins + e.losses + e.draws) else 0 end) desc,
                 e.votes_received desc,
                 e.wins desc,
                 e.exposures desc,
                 e.created_at asc
      ) as rank_no
    from fallback_eligible e
  ),
  ranked as (
    select * from strict_ranked
    union all
    select * from fallback_ranked
    where not exists (select 1 from strict_ranked)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank', rank_no,
        'entry_id', id,
        'user_id', user_id,
        'nickname', nickname,
        'rating', rating,
        'votes_received', votes_received,
        'wins', wins,
        'losses', losses,
        'draws', draws,
        'image_url', coalesce(image_urls[1], null),
        'champion_comment', champion_comment
      )
      order by rank_no
    ),
    '[]'::jsonb
  )
  into v_top10
  from ranked
  where rank_no <= 10;

  if jsonb_array_length(v_top10) > 0 then
    select e.*
    into v_champion
    from public.bodybattle_entries e
    where e.id = (v_top10->0->>'entry_id')::uuid;
  end if;

  insert into public.bodybattle_season_results (season_id, champion_entry_id, top10, finalized_at)
  values (p_season_id, v_champion.id, v_top10, now())
  on conflict (season_id)
  do update
  set champion_entry_id = excluded.champion_entry_id,
      top10 = excluded.top10,
      finalized_at = now();

  if v_champion.id is not null then
    insert into public.bodybattle_hall_of_fame (
      season_id,
      week_id,
      theme_slug,
      theme_label,
      champion_entry_id,
      user_id,
      nickname,
      image_url,
      rating,
      votes_received,
      wins,
      losses,
      draws,
      champion_comment,
      created_at
    ) values (
      p_season_id,
      v_season.week_id,
      v_season.theme_slug,
      v_season.theme_label,
      v_champion.id,
      v_champion.user_id,
      v_champion.nickname,
      coalesce(v_champion.image_urls[1], null),
      v_champion.rating,
      v_champion.votes_received,
      v_champion.wins,
      v_champion.losses,
      v_champion.draws,
      v_champion.champion_comment,
      now()
    )
    on conflict (season_id)
    do update
    set champion_entry_id = excluded.champion_entry_id,
        user_id = excluded.user_id,
        nickname = excluded.nickname,
        image_url = excluded.image_url,
        rating = excluded.rating,
        votes_received = excluded.votes_received,
        wins = excluded.wins,
        losses = excluded.losses,
        draws = excluded.draws,
        champion_comment = excluded.champion_comment,
        created_at = now();
  else
    delete from public.bodybattle_hall_of_fame
    where season_id = p_season_id;
  end if;

  update public.bodybattle_seasons
  set status = case when end_at <= now() then 'closed' else status end
  where id = p_season_id;

  return jsonb_build_object(
    'ok', true,
    'season_id', p_season_id,
    'champion_entry_id', v_champion.id,
    'top10_count', jsonb_array_length(v_top10)
  );
end;
$$;

create or replace function public.bodybattle_finalize_due_seasons()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_done integer := 0;
begin
  for v_row in
    select s.id
    from public.bodybattle_seasons s
    where s.end_at <= now()
      and (
        not exists (
          select 1
          from public.bodybattle_season_results r
          where r.season_id = s.id
        )
        or not exists (
          select 1
          from public.bodybattle_hall_of_fame h
          where h.season_id = s.id
        )
        or exists (
          select 1
          from public.bodybattle_season_results r
          where r.season_id = s.id
            and r.champion_entry_id is null
        )
        or exists (
          select 1
          from public.bodybattle_hall_of_fame h
          where h.season_id = s.id
            and h.champion_entry_id is null
        )
      )
    order by s.end_at asc
  loop
    perform public.bodybattle_finalize_season(v_row.id);
    update public.bodybattle_seasons
    set status = 'closed'
    where id = v_row.id;
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'finalized_count', v_done
  );
end;
$$;

do $$
declare
  v_row record;
begin
  for v_row in
    select s.id
    from public.bodybattle_seasons s
    where s.end_at <= now()
      and exists (
        select 1
        from public.bodybattle_entries e
        where e.season_id = s.id
          and e.moderation_status = 'approved'
          and e.status <> 'hidden'
          and coalesce(e.report_count, 0) < 5
      )
      and (
        not exists (
          select 1
          from public.bodybattle_season_results r
          where r.season_id = s.id
        )
        or not exists (
          select 1
          from public.bodybattle_hall_of_fame h
          where h.season_id = s.id
        )
        or exists (
          select 1
          from public.bodybattle_season_results r
          where r.season_id = s.id
            and r.champion_entry_id is null
        )
        or exists (
          select 1
          from public.bodybattle_hall_of_fame h
          where h.season_id = s.id
            and h.champion_entry_id is null
        )
      )
    order by s.end_at asc
  loop
    perform public.bodybattle_finalize_season(v_row.id);
    update public.bodybattle_seasons
    set status = 'closed'
    where id = v_row.id;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
