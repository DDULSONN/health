-- One-way recommendation preference, NOT a block or rejection.
-- No updates to matches, payments, refresh quotas, favorites, or notifications.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table if not exists public.dating_1on1_candidate_hides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  candidate_card_id uuid references public.dating_1on1_cards(id) on delete set null,
  candidate_name text not null check(char_length(candidate_name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique(user_id,candidate_user_id),
  check(user_id<>candidate_user_id)
);
create index if not exists dating_candidate_hides_owner on public.dating_1on1_candidate_hides(user_id,created_at desc,id desc);
alter table public.dating_1on1_candidate_hides enable row level security;
revoke all on public.dating_1on1_candidate_hides from public,anon,authenticated,service_role;
grant select on public.dating_1on1_candidate_hides to service_role;

create or replace function public.hide_dating_1on1_candidate(p_user uuid,p_source uuid,p_candidate uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare s public.dating_1on1_cards%rowtype; c public.dating_1on1_cards%rowtype; hidden_id uuid;
begin
  if p_user is null or p_source is null or p_candidate is null then raise exception 'HIDE_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,17004));
  select * into s from public.dating_1on1_cards where id=p_source and user_id=p_user and status in ('submitted','reviewing','approved');
  if not found then raise exception 'HIDE_SOURCE'; end if;
  select * into c from public.dating_1on1_cards where id=p_candidate;
  if not found or c.user_id=p_user or c.sex is null or s.sex is null or c.sex=s.sex then raise exception 'HIDE_CANDIDATE'; end if;
  select id into hidden_id from public.dating_1on1_candidate_hides where user_id=p_user and candidate_user_id=c.user_id;
  if found then return jsonb_build_object('ok',true,'id',hidden_id); end if;
  if (select count(*) from public.dating_1on1_candidate_hides where user_id=p_user)>=500 then raise exception 'HIDE_LIMIT'; end if;
  insert into public.dating_1on1_candidate_hides(user_id,candidate_user_id,candidate_card_id,candidate_name)
    values(p_user,c.user_id,c.id,left(coalesce(nullif(btrim(c.name),''),'상대 프로필'),80)) returning id into hidden_id;
  return jsonb_build_object('ok',true,'id',hidden_id);
end;
$$;
create or replace function public.restore_dating_1on1_candidate(p_user uuid,p_hide uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
begin
  if p_user is null or p_hide is null then raise exception 'HIDE_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,17004));
  delete from public.dating_1on1_candidate_hides where id=p_hide and user_id=p_user;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.hide_dating_1on1_candidate(uuid,uuid,uuid),public.restore_dating_1on1_candidate(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.hide_dating_1on1_candidate(uuid,uuid,uuid),public.restore_dating_1on1_candidate(uuid,uuid) to service_role;
commit;
notify pgrst,'reload schema';
