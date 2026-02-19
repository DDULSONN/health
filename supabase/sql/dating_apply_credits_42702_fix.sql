-- Fix 42702 ambiguous column reference in apply credit functions.
-- Error example:
--   code: 42702
--   message: column reference "base_used" is ambiguous

begin;

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

  if coalesce(v_base_used, 0) < 2 then
    update public.user_daily_apply_usage as u
    set base_used = u.base_used + 1, updated_at = now()
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
    set credits = credits - 1, updated_at = now()
    where user_id = p_user_id;

    select c.credits
      into v_credits
    from public.user_apply_credits c
    where c.user_id = p_user_id;

    return query select 'credit'::text, coalesce(v_base_used, 2), greatest(coalesce(v_credits, 0), 0);
    return;
  end if;

  return query select 'none'::text, coalesce(v_base_used, 2), 0;
end;
$$;

create or replace function public.refund_apply_token(p_user_id uuid, p_used text)
returns table (
  refunded boolean,
  base_used int,
  credits_remaining int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kst_date date := (timezone('Asia/Seoul', now()))::date;
  v_base_used int := 0;
  v_credits int := 0;
begin
  if p_used = 'base' then
    update public.user_daily_apply_usage as u
    set base_used = greatest(u.base_used - 1, 0),
        updated_at = now()
    where u.user_id = p_user_id
      and u.kst_date = v_kst_date;
  elsif p_used = 'credit' then
    insert into public.user_apply_credits (user_id, credits, updated_at)
    values (p_user_id, 1, now())
    on conflict (user_id) do update
      set credits = public.user_apply_credits.credits + 1,
          updated_at = now();
  end if;

  select u.base_used
    into v_base_used
  from public.user_daily_apply_usage u
  where u.user_id = p_user_id and u.kst_date = v_kst_date;

  select c.credits
    into v_credits
  from public.user_apply_credits c
  where c.user_id = p_user_id;

  return query select true, greatest(coalesce(v_base_used, 0), 0), greatest(coalesce(v_credits, 0), 0);
end;
$$;

commit;

notify pgrst, 'reload schema';
