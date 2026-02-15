-- Nickname one-time change system (free 1 time + future paid credits)

alter table public.profiles
  add column if not exists nickname_changed_count integer not null default 0,
  add column if not exists nickname_changed_at timestamptz null,
  add column if not exists nickname_change_credits integer not null default 0;

-- Ensure nickname exists and case-insensitive uniqueness
alter table public.profiles
  alter column nickname set not null;

drop index if exists profiles_nickname_lower_key;
create unique index if not exists profiles_nickname_lower_key
  on public.profiles ((lower(nickname)));

create or replace function public.change_nickname(new_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_profile public.profiles%rowtype;
  v_clean text;
  v_blocked text[] := array['admin', '운영자', '관리자', 'fuck', 'shit', 'sex', '섹스'];
  v_used_free boolean := false;
begin
  v_uid := auth.uid();

  if v_uid is null then
    return jsonb_build_object(
      'success', false,
      'code', 'unauthorized',
      'message', '로그인이 필요합니다.'
    );
  end if;

  v_clean := regexp_replace(trim(coalesce(new_nickname, '')), '\s+', ' ', 'g');

  if v_clean = '' then
    return jsonb_build_object('success', false, 'code', 'invalid', 'message', '닉네임을 입력해 주세요.');
  end if;

  if v_clean <> trim(v_clean) then
    return jsonb_build_object('success', false, 'code', 'invalid', 'message', '닉네임 앞뒤 공백은 사용할 수 없습니다.');
  end if;

  if position(' ' in v_clean) > 0 then
    return jsonb_build_object('success', false, 'code', 'invalid', 'message', '닉네임에는 공백을 사용할 수 없습니다.');
  end if;

  if char_length(v_clean) < 2 or char_length(v_clean) > 12 then
    return jsonb_build_object('success', false, 'code', 'invalid', 'message', '닉네임은 2~12자로 입력해 주세요.');
  end if;

  if v_clean !~ '^[0-9A-Za-z가-힣_]+$' then
    return jsonb_build_object('success', false, 'code', 'invalid', 'message', '닉네임은 한글/영문/숫자/_만 사용할 수 있습니다.');
  end if;

  if exists (
    select 1
    from unnest(v_blocked) as b
    where lower(v_clean) like '%' || lower(b) || '%'
  ) then
    return jsonb_build_object('success', false, 'code', 'blocked', 'message', '사용할 수 없는 닉네임입니다.');
  end if;

  select *
    into v_profile
  from public.profiles
  where user_id = v_uid
  for update;

  if v_profile.user_id is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found', 'message', '프로필을 찾을 수 없습니다.');
  end if;

  if lower(v_profile.nickname) = lower(v_clean) then
    return jsonb_build_object('success', false, 'code', 'same', 'message', '현재 닉네임과 동일합니다.');
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.user_id <> v_uid
      and lower(p.nickname) = lower(v_clean)
  ) then
    return jsonb_build_object('success', false, 'code', 'duplicate', 'message', '이미 사용 중인 닉네임입니다.');
  end if;

  if coalesce(v_profile.nickname_changed_count, 0) < 1 then
    v_used_free := true;
  elsif coalesce(v_profile.nickname_change_credits, 0) <= 0 then
    return jsonb_build_object(
      'success', false,
      'code', 'limit_exceeded',
      'message', '닉네임 변경은 1회 무료입니다. 추가 변경은 준비 중입니다.'
    );
  end if;

  update public.profiles
  set
    nickname = v_clean,
    nickname_changed_count = case when v_used_free then coalesce(nickname_changed_count, 0) + 1 else nickname_changed_count end,
    nickname_change_credits = case when not v_used_free and coalesce(nickname_change_credits, 0) > 0 then nickname_change_credits - 1 else nickname_change_credits end,
    nickname_changed_at = now()
  where user_id = v_uid
  returning * into v_profile;

  -- Keep related public-facing snapshots aligned.
  update public.cert_requests
  set nickname = v_clean
  where user_id = v_uid;

  update public.hall_of_fame
  set nickname = v_clean
  where user_id = v_uid;

  return jsonb_build_object(
    'success', true,
    'code', 'ok',
    'message', '닉네임이 변경되었습니다.',
    'nickname', v_profile.nickname,
    'nickname_changed_count', v_profile.nickname_changed_count,
    'nickname_change_credits', v_profile.nickname_change_credits
  );
end;
$$;

grant execute on function public.change_nickname(text) to authenticated;

-- RLS: direct update should not mutate nickname controls; use RPC instead.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own_limited"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and nickname = (select p.nickname from public.profiles p where p.user_id = auth.uid())
    and nickname_changed_count = (select p.nickname_changed_count from public.profiles p where p.user_id = auth.uid())
    and coalesce(nickname_changed_at, to_timestamp(0)) = coalesce((select p.nickname_changed_at from public.profiles p where p.user_id = auth.uid()), to_timestamp(0))
    and nickname_change_credits = (select p.nickname_change_credits from public.profiles p where p.user_id = auth.uid())
  );
