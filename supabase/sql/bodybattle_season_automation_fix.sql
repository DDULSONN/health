-- BodyBattle season automation hardening
-- 1) Ensure weekly theme rotation uses full theme set
-- 2) Finalize ended seasons even if status is already closed but HOF/result missing

begin;

create or replace function public.bodybattle_ensure_current_season()
returns table (
  season_id uuid,
  week_id text,
  created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_kst timestamp := now() at time zone 'Asia/Seoul';
  v_week_start_kst timestamp;
  v_week_end_kst timestamp;
  v_week_id text;
  v_existing public.bodybattle_seasons%rowtype;
  v_theme_slugs text[] := array['shoulders','back','legs','arms','upper_chest','full_balance','growth'];
  v_theme_labels text[] := array['어깨 챔피언전','등 챔피언전','하체 챔피언전','팔 챔피언전','가슴 상부 챔피언전','전신 밸런스 챔피언전','성장 배틀'];
  v_theme_idx integer;
begin
  v_week_start_kst := date_trunc('week', v_now_kst);
  v_week_end_kst := v_week_start_kst + interval '7 day';
  v_week_id := to_char(v_week_start_kst, 'IYYY-"W"IW');

  select *
  into v_existing
  from public.bodybattle_seasons
  where week_id = v_week_id
  limit 1;

  if found then
    if v_existing.status <> 'active' then
      update public.bodybattle_seasons
      set status = case when end_at > now() then 'active' else 'closed' end
      where id = v_existing.id;
      select * into v_existing from public.bodybattle_seasons where id = v_existing.id;
    end if;
    return query select v_existing.id, v_existing.week_id, false;
    return;
  end if;

  v_theme_idx := (extract(week from v_week_start_kst)::integer % array_length(v_theme_slugs, 1)) + 1;
  insert into public.bodybattle_seasons (
    week_id,
    theme_slug,
    theme_label,
    start_at,
    end_at,
    status
  ) values (
    v_week_id,
    v_theme_slugs[v_theme_idx],
    v_theme_labels[v_theme_idx],
    v_week_start_kst at time zone 'Asia/Seoul',
    v_week_end_kst at time zone 'Asia/Seoul',
    'active'
  )
  returning id, week_id
  into v_existing.id, v_existing.week_id;

  return query select v_existing.id, v_existing.week_id, true;
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

commit;

notify pgrst, 'reload schema';
