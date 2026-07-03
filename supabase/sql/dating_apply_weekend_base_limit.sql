-- Weekend open-card apply benefit.
-- Base applies: 2 per KST weekday, 3 per KST Saturday/Sunday.

begin;

alter table public.user_daily_apply_usage
  drop constraint if exists user_daily_apply_usage_base_used_check;

alter table public.user_daily_apply_usage
  add constraint user_daily_apply_usage_base_used_check
  check (base_used >= 0 and base_used <= 3);

create or replace function public.get_daily_apply_base_limit(p_kst_date date default (timezone('Asia/Seoul', now()))::date)
returns int
language sql
stable
set search_path = public
as $$
  select case
    when extract(isodow from p_kst_date) in (6, 7) then 3
    else 2
  end;
$$;

create or replace function public.consume_apply_token(p_user_id uuid)
returns table (
  used text,
  base_used int,
  credits_remaining int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kst_date date := (timezone('Asia/Seoul', now()))::date;
  v_base_limit int := public.get_daily_apply_base_limit((timezone('Asia/Seoul', now()))::date);
  v_base_used int := 0;
  v_credits int := 0;
begin
  insert into public.user_daily_apply_usage (user_id, kst_date, base_used)
  values (p_user_id, v_kst_date, 0)
  on conflict (user_id, kst_date) do nothing;

  select u.base_used
    into v_base_used
  from public.user_daily_apply_usage u
  where u.user_id = p_user_id and u.kst_date = v_kst_date
  for update;

  if coalesce(v_base_used, 0) < v_base_limit then
    update public.user_daily_apply_usage as u
    set base_used = u.base_used + 1,
        updated_at = now()
    where u.user_id = p_user_id and u.kst_date = v_kst_date;

    select u.base_used
      into v_base_used
    from public.user_daily_apply_usage u
    where u.user_id = p_user_id and u.kst_date = v_kst_date;

    select c.credits
      into v_credits
    from public.user_apply_credits c
    where c.user_id = p_user_id;

    return query select 'base'::text, coalesce(v_base_used, 0), greatest(coalesce(v_credits, 0), 0);
    return;
  end if;

  insert into public.user_apply_credits (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select c.credits
    into v_credits
  from public.user_apply_credits c
  where c.user_id = p_user_id
  for update;

  if coalesce(v_credits, 0) > 0 then
    update public.user_apply_credits
    set credits = credits - 1,
        updated_at = now()
    where user_id = p_user_id;

    select c.credits
      into v_credits
    from public.user_apply_credits c
    where c.user_id = p_user_id;

    return query select 'credit'::text, coalesce(v_base_used, v_base_limit), greatest(coalesce(v_credits, 0), 0);
    return;
  end if;

  return query select 'none'::text, coalesce(v_base_used, v_base_limit), 0;
end;
$$;

revoke all on function public.get_daily_apply_base_limit(date) from public;
grant execute on function public.get_daily_apply_base_limit(date) to authenticated, service_role;

revoke all on function public.consume_apply_token(uuid) from public;
grant execute on function public.consume_apply_token(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
