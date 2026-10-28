-- Friend recommendations. New tables/functions only; no matching/payment changes.
-- Install before deployment. Activation is a separate final operator step.
begin;
create table if not exists public.dating_friend_share_policy (
  id boolean primary key default true check (id), enabled boolean not null default false
);
insert into public.dating_friend_share_policy(id,enabled) values(true,false) on conflict do nothing;
create table if not exists public.dating_friend_share_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.dating_friend_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  request_key uuid not null,
  token text not null unique check(token ~ '^[A-Za-z0-9_-]{43}$'),
  prompt text not null check(prompt in ('fit','hello','introduce')),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 3),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  unique(user_id,request_key)
);
create index if not exists dating_friend_shares_owner_recent on public.dating_friend_shares(user_id,created_at desc,id desc);
create index if not exists dating_friend_shares_recent on public.dating_friend_shares(created_at desc,id desc);
alter table public.dating_friend_share_policy enable row level security;
alter table public.dating_friend_share_preferences enable row level security;
alter table public.dating_friend_shares enable row level security;
revoke all on public.dating_friend_share_policy,public.dating_friend_share_preferences,public.dating_friend_shares from public,anon,authenticated;
grant all on public.dating_friend_share_policy,public.dating_friend_share_preferences,public.dating_friend_shares to service_role;

create or replace function public.set_dating_friend_share_preference(p_user uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_user is null or p_enabled is null then raise exception 'invalid preference'; end if;
  insert into dating_friend_share_preferences(user_id,enabled,revision)
  values(p_user,p_enabled,case when p_enabled then 0 else 1 end)
  on conflict(user_id) do update set enabled=excluded.enabled,
    revision=dating_friend_share_preferences.revision + case when not excluded.enabled and dating_friend_share_preferences.enabled then 1 else 0 end,
    updated_at=now();
end $$;

create or replace function public.create_dating_friend_share(p_user uuid,p_request_key uuid,p_token text,p_prompt text,p_items jsonb)
returns public.dating_friend_shares language plpgsql security definer set search_path=public,pg_temp as $$
declare result dating_friend_shares; item jsonb; pref dating_friend_share_preferences; owner_id uuid;
begin
  if not coalesce((select enabled from dating_friend_share_policy where id),false) then raise exception 'sharing unavailable'; end if;
  if p_user is null or p_request_key is null or p_prompt not in ('fit','hello','introduce') or p_prompt is null
    or p_token !~ '^[A-Za-z0-9_-]{43}$' or p_token is null
    or p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'invalid share'; end if;
  if jsonb_array_length(p_items) not between 1 and 3 then raise exception 'invalid items'; end if;
  perform pg_advisory_xact_lock(hashtextextended('friend-share:'||p_user::text,0));
  select * into result from dating_friend_shares where user_id=p_user and request_key=p_request_key;
  if found then
    if result.prompt<>p_prompt or
      (select jsonb_agg(v-'id'-'label') from jsonb_array_elements(result.items) v) <>
      (select jsonb_agg(v-'id'-'label') from jsonb_array_elements(p_items) v) then raise exception 'request conflict'; end if;
    return result;
  end if;
  if (select count(*) from dating_friend_shares where user_id=p_user and created_at>now()-interval '24 hours') >= 20
    or (select count(*) from dating_friend_shares where user_id=p_user and expires_at>now() and revoked_at is null) >= 10
    then raise exception 'share limit'; end if;
  if not exists(select 1 from profiles where user_id=p_user and phone_verified=true and not coalesce(is_banned,false))
    then raise exception 'member unavailable'; end if;
  -- Sorted locks serialize OFF vs creation, including previously implicit defaults.
  for owner_id in select distinct (v->>'user_id')::uuid from jsonb_array_elements(p_items) v order by 1 loop
    insert into dating_friend_share_preferences(user_id) values(owner_id) on conflict do nothing;
    select * into pref from dating_friend_share_preferences where user_id=owner_id for update;
    if not pref.enabled then raise exception 'profile unavailable'; end if;
  end loop;
  for item in select * from jsonb_array_elements(p_items) loop
    if item->>'kind' not in ('open_card','paid_card','one_on_one') or item->>'kind' is null
      or item->>'card_id' is null or item->>'id' is null or item->>'revision' is null then raise exception 'invalid item'; end if;
    perform (item->>'card_id')::uuid, (item->>'id')::uuid;
    select * into pref from dating_friend_share_preferences where user_id=(item->>'user_id')::uuid;
    if not found or not pref.enabled or pref.revision<>(item->>'revision')::bigint then raise exception 'profile changed'; end if;
  end loop;
  insert into dating_friend_shares(user_id,request_key,token,prompt,items)
  values(p_user,p_request_key,p_token,p_prompt,p_items) returning * into result;
  return result;
end $$;
revoke all on function public.set_dating_friend_share_preference(uuid,boolean),public.create_dating_friend_share(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.set_dating_friend_share_preference(uuid,boolean),public.create_dating_friend_share(uuid,uuid,text,text,jsonb) to service_role;
commit;
-- After server/browser verification, activate explicitly:
-- update public.dating_friend_share_policy set enabled=true where id=true;
-- Immediate rollback (links and records retained): set enabled=false instead.
