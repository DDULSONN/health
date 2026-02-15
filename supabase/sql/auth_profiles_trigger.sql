-- Profiles nickname source-of-truth + auto-create trigger
-- Run once in Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  nickname text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles
  alter column nickname set not null;

create unique index if not exists profiles_nickname_lower_key
  on public.profiles ((lower(nickname)));

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_nickname text;
  base_nickname text;
  candidate text;
  suffix int := 0;
begin
  raw_nickname := nullif(trim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), '');
  base_nickname := coalesce(raw_nickname, split_part(coalesce(new.email, ''), '@', 1), 'user');
  base_nickname := regexp_replace(base_nickname, '[^0-9A-Za-z가-힣_]+', '', 'g');
  base_nickname := left(base_nickname, 12);

  if base_nickname = '' then
    base_nickname := 'user';
  end if;

  candidate := base_nickname;

  loop
    begin
      insert into public.profiles (user_id, nickname)
      values (new.id, candidate);
      exit;
    exception
      when unique_violation then
        suffix := suffix + 1;
        candidate := left(base_nickname, 10) || lpad(suffix::text, 2, '0');
    end;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_create_profile_for_new_user on auth.users;
create trigger trg_create_profile_for_new_user
after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

insert into public.profiles (user_id, nickname)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'nickname'), ''),
    nullif(regexp_replace(split_part(coalesce(u.email, ''), '@', 1), '[^0-9A-Za-z가-힣_]+', '', 'g'), ''),
    'user_' || left(replace(u.id::text, '-', ''), 8)
  )
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;
