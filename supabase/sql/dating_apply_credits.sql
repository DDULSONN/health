-- Apply quota + paid credits for open-card applications.
-- Base: 2 applies per KST day.
-- Credits: non-expiring carry-over.

begin;

create table if not exists public.user_daily_apply_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  kst_date date not null,
  base_used int not null default 0 check (base_used >= 0 and base_used <= 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kst_date)
);

create table if not exists public.user_apply_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits int not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.apply_credit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_size int not null default 3 check (pack_size > 0),
  amount int not null default 5000 check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  processed_at timestamptz null,
  memo text null
);

create index if not exists idx_apply_credit_orders_user_created
  on public.apply_credit_orders (user_id, created_at desc);
create index if not exists idx_apply_credit_orders_status_created
  on public.apply_credit_orders (status, created_at desc);

alter table public.user_daily_apply_usage enable row level security;
alter table public.user_apply_credits enable row level security;
alter table public.apply_credit_orders enable row level security;

drop policy if exists "user_daily_apply_usage_select_own" on public.user_daily_apply_usage;
create policy "user_daily_apply_usage_select_own"
  on public.user_daily_apply_usage for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_daily_apply_usage_insert_own" on public.user_daily_apply_usage;
create policy "user_daily_apply_usage_insert_own"
  on public.user_daily_apply_usage for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_daily_apply_usage_update_own" on public.user_daily_apply_usage;
create policy "user_daily_apply_usage_update_own"
  on public.user_daily_apply_usage for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_apply_credits_select_own" on public.user_apply_credits;
create policy "user_apply_credits_select_own"
  on public.user_apply_credits for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "apply_credit_orders_select_own" on public.apply_credit_orders;
create policy "apply_credit_orders_select_own"
  on public.apply_credit_orders for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "apply_credit_orders_insert_own" on public.apply_credit_orders;
create policy "apply_credit_orders_insert_own"
  on public.apply_credit_orders for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "apply_credit_orders_admin_all" on public.apply_credit_orders;
create policy "apply_credit_orders_admin_all"
  on public.apply_credit_orders for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

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

revoke all on function public.consume_apply_token(uuid) from public;
grant execute on function public.consume_apply_token(uuid) to authenticated;

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

revoke all on function public.refund_apply_token(uuid, text) from public;
grant execute on function public.refund_apply_token(uuid, text) to service_role;

create or replace function public.approve_apply_credit_order(p_order_id uuid, p_admin_user_id uuid)
returns table (
  result_code text,
  order_id uuid,
  target_user_id uuid,
  added_credits int,
  credits_after int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.apply_credit_orders%rowtype;
  v_now timestamptz := now();
  v_credits int := 0;
begin
  select *
    into v_order
  from public.apply_credit_orders o
  where o.id = p_order_id
  for update;

  if not found then
    return query select 'NOT_FOUND'::text, p_order_id, null::uuid, 0, 0;
    return;
  end if;

  if v_order.status = 'approved' then
    select c.credits into v_credits
    from public.user_apply_credits c
    where c.user_id = v_order.user_id;
    return query select 'ALREADY_APPROVED'::text, v_order.id, v_order.user_id, 0, greatest(coalesce(v_credits, 0), 0);
    return;
  end if;

  if v_order.status <> 'pending' then
    return query select 'NOT_PENDING'::text, v_order.id, v_order.user_id, 0, 0;
    return;
  end if;

  update public.apply_credit_orders
  set status = 'approved',
      processed_at = v_now,
      memo = coalesce(memo, '') || case when coalesce(memo, '') = '' then '' else ' ' end || '(approved_by=' || coalesce(p_admin_user_id::text, 'unknown') || ')'
  where id = v_order.id;

  insert into public.user_apply_credits (user_id, credits, updated_at)
  values (v_order.user_id, 0, v_now)
  on conflict (user_id) do nothing;

  select c.credits
    into v_credits
  from public.user_apply_credits c
  where c.user_id = v_order.user_id
  for update;

  update public.user_apply_credits
  set credits = coalesce(v_credits, 0) + v_order.pack_size,
      updated_at = v_now
  where user_id = v_order.user_id;

  select c.credits
    into v_credits
  from public.user_apply_credits c
  where c.user_id = v_order.user_id;

  return query select 'APPROVED'::text, v_order.id, v_order.user_id, v_order.pack_size, greatest(coalesce(v_credits, 0), 0);
end;
$$;

revoke all on function public.approve_apply_credit_order(uuid, uuid) from public;
grant execute on function public.approve_apply_credit_order(uuid, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
