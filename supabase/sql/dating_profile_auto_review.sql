-- Rollout: apply this migration before deploying the application and cron.
-- Configure server-only GEMINI_API_KEY and CRON_SECRET in Production;
-- GEMINI_VISION_MODEL is optional. vercel.json schedules four reviews/minute.
-- Only newly registered/edited active profiles since installation are queued;
-- existing historical profiles are not bulk backfilled.
-- Model failures retry up to three attempts, then enter the admin inbox.
-- Admin > AI card review contains clear, ban, delete and retry controls.
-- No automatic review code bans users, deletes profiles or blocks registration.
-- To pause processing, disable the cron; queued jobs remain available.
-- Isolated regression checks: node scripts/test-dating-auto-review.cjs
-- (See that script's first line for its disposable test dependency setup.)
begin;

-- Independent queue: registration never waits for a model or an administrator.
create table if not exists public.dating_profile_review_settings (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz not null default now()
);
insert into public.dating_profile_review_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.dating_profile_review_jobs (
  source_type text not null check (source_type in ('open_card','one_on_one')),
  card_id uuid not null,
  user_id uuid not null,
  revision uuid not null default gen_random_uuid(),
  payload jsonb not null,
  state text not null default 'queued' check (state in ('queued','running','complete','failed','gone')),
  resolution text not null default 'open' check (resolution in ('open','cleared','banned','deleted')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  result jsonb,
  error text,
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  primary key(source_type,card_id)
);
create index if not exists dating_profile_review_jobs_queue on public.dating_profile_review_jobs(state,available_at);
create table if not exists public.dating_profile_review_actions (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  card_id uuid not null,
  revision uuid not null,
  action text not null,
  admin_user_id uuid not null,
  evidence jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.dating_profile_review_jobs enable row level security;
alter table public.dating_profile_review_actions enable row level security;
alter table public.dating_profile_review_settings enable row level security;
revoke all on public.dating_profile_review_jobs,public.dating_profile_review_actions,public.dating_profile_review_settings from anon,authenticated;
grant all on public.dating_profile_review_jobs,public.dating_profile_review_actions,public.dating_profile_review_settings to service_role;

create or replace function public.dating_profile_review_payload(s text, r jsonb)
returns jsonb language sql immutable set search_path=public as $$
  select case when s='open_card' then jsonb_build_object(
    'name',r->'display_nickname','age',r->'age','region',r->'region','job',r->'job',
    'ideal',r->'ideal_type','strengths',r->'strengths_text','instagram',r->'instagram_id','photos',r->'photo_paths')
  else jsonb_build_object('name',r->'name','birthYear',r->'birth_year','region',r->'region','job',r->'job',
    'intro',r->'intro_text','strengths',r->'strengths_text','preferred',r->'preferred_partner_text','photos',r->'photo_paths') end
$$;

-- Open cards have no updated_at in production. Keep installation fingerprints
-- so reconciliation can recover an edit missed by a failed queue write, without
-- scheduling every historical card on installation.
alter table public.dating_profile_review_settings add column if not exists initial_open_card_payloads jsonb;
update public.dating_profile_review_settings set initial_open_card_payloads=(
  select coalesce(jsonb_object_agg(id::text,md5(public.dating_profile_review_payload('open_card',to_jsonb(c))::text)), '{}'::jsonb)
  from public.dating_cards c where status in ('pending','public')
) where singleton=true and initial_open_card_payloads is null;

create or replace function public.enqueue_dating_profile_review(s text, c uuid, u uuid, p jsonb)
returns void language sql security definer set search_path=public as $$
  insert into dating_profile_review_jobs(source_type,card_id,user_id,payload) values(s,c,u,p)
  on conflict(source_type,card_id) do update set user_id=excluded.user_id,payload=excluded.payload,
    revision=gen_random_uuid(),state='queued',resolution='open',attempts=0,available_at=now(),
    lease_token=null,lease_until=null,result=null,error=null,reviewed_at=null,updated_at=now()
  where dating_profile_review_jobs.payload is distinct from excluded.payload
    or dating_profile_review_jobs.user_id is distinct from excluded.user_id
     or dating_profile_review_jobs.state='gone';
$$;

create or replace function public.capture_dating_profile_review()
returns trigger language plpgsql security definer set search_path=public set lock_timeout='100ms' as $$
declare s text := case when tg_table_name='dating_cards' then 'open_card' else 'one_on_one' end; r jsonb; u uuid;
begin
  if tg_op='DELETE' then
    update dating_profile_review_jobs set state='gone',lease_token=null,lease_until=null,updated_at=now()
      where source_type=s and card_id=old.id;
    return old;
  end if;
  r:=to_jsonb(new);
  if (s='open_card' and r->>'status' not in ('pending','public')) or
     (s='one_on_one' and r->>'status' not in ('submitted','reviewing','approved')) then return new; end if;
  u:=case when s='open_card' then (r->>'owner_user_id')::uuid else (r->>'user_id')::uuid end;
  perform enqueue_dating_profile_review(s,new.id,u,dating_profile_review_payload(s,r));
  return new;
exception when others then
  -- Fail open. The scheduled reconciliation repairs missed queue entries.
  raise warning 'profile review enqueue failed: %',sqlstate;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists dating_profile_review_capture on public.dating_cards;
create trigger dating_profile_review_capture after insert or update or delete on public.dating_cards
  for each row execute function public.capture_dating_profile_review();
drop trigger if exists dating_profile_review_capture on public.dating_1on1_cards;
create trigger dating_profile_review_capture after insert or update or delete on public.dating_1on1_cards
  for each row execute function public.capture_dating_profile_review();

create or replace function public.reconcile_dating_profile_reviews()
returns void language plpgsql security definer set search_path=public as $$
declare r record; started timestamptz; initial_open jsonb;
begin
  select enabled_at,initial_open_card_payloads into started,initial_open from dating_profile_review_settings where singleton=true;
  for r in select 'open_card'::text s,c.id,c.owner_user_id u,to_jsonb(c) j from dating_cards c
    where c.status in ('pending','public') and
      (c.created_at>=started or coalesce((to_jsonb(c)->>'updated_at')::timestamptz,c.created_at)>=started
       or (initial_open->>c.id::text) is distinct from md5(dating_profile_review_payload('open_card',to_jsonb(c))::text)
       or exists(select 1 from dating_profile_review_jobs q where q.source_type='open_card' and q.card_id=c.id))
    union all select 'one_on_one',c.id,c.user_id,to_jsonb(c) from dating_1on1_cards c
    where c.status in ('submitted','reviewing','approved') and
      (c.created_at>=started or coalesce((to_jsonb(c)->>'updated_at')::timestamptz,c.created_at)>=started
       or exists(select 1 from dating_profile_review_jobs q where q.source_type='one_on_one' and q.card_id=c.id))
  loop perform enqueue_dating_profile_review(r.s,r.id,r.u,dating_profile_review_payload(r.s,r.j)); end loop;
end $$;

create or replace function public.claim_dating_profile_reviews(batch_size integer default 4)
returns setof public.dating_profile_review_jobs language plpgsql security definer set search_path=public as $$
begin
  update dating_profile_review_jobs set state='failed',error='검수 실행 중단: 재시도 필요',lease_token=null,lease_until=null
    where state='running' and lease_until<now() and attempts>=3;
  return query with picked as (
    select source_type,card_id from dating_profile_review_jobs
    where resolution='open' and attempts<3 and
      ((state='queued' and available_at<=now()) or (state='running' and lease_until<now()))
    order by available_at for update skip locked limit greatest(1,least(batch_size,4))
  ) update dating_profile_review_jobs j set state='running',attempts=j.attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now()
    from picked p where j.source_type=p.source_type and j.card_id=p.card_id returning j.*;
end $$;

create or replace function public.finish_dating_profile_review(s text,c uuid,v uuid,token uuid,review jsonb,failure text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  update dating_profile_review_jobs set result=review,error=failure,
    state=case when failure is null then 'complete' when attempts>=3 then 'failed' else 'queued' end,
    available_at=now()+interval '2 minutes',lease_token=null,lease_until=null,reviewed_at=now(),updated_at=now()
    where source_type=s and card_id=c and revision=v and lease_token=token and state='running' and resolution='open';
  get diagnostics n=row_count; return n=1;
end $$;

-- Explicit administrator actions only. Worker credentials never invoke this RPC.
create or replace function public.resolve_dating_profile_review(s text,c uuid,v uuid,decision text,actor uuid)
returns void language plpgsql security definer set search_path=public as $$
declare j dating_profile_review_jobs%rowtype; target_user uuid; reason text; current_payload jsonb;
begin
  if decision not in ('clear','ban','delete','retry') or s not in ('open_card','one_on_one') then raise exception 'invalid action'; end if;
  -- Same lock order as the registration trigger: source card, then review job.
  if s='open_card' then select owner_user_id,dating_profile_review_payload(s,to_jsonb(d)) into target_user,current_payload from dating_cards d where id=c for update;
  else select user_id,dating_profile_review_payload(s,to_jsonb(d)) into target_user,current_payload from dating_1on1_cards d where id=c for update; end if;
  if target_user is null then raise exception 'card missing'; end if;
  select * into j from dating_profile_review_jobs where source_type=s and card_id=c for update;
  if not found or j.revision<>v or j.resolution<>'open' then raise exception 'review changed; reload'; end if;
  if j.payload is distinct from current_payload or j.user_id is distinct from target_user then raise exception 'review changed; reload'; end if;
  if decision='clear' and j.state not in ('complete','failed') then raise exception 'review is still processing'; end if;
  if decision='ban' and (target_user=actor or exists(select 1 from profiles where user_id=target_user and role='admin')) then raise exception 'admin target blocked'; end if;
  insert into dating_profile_review_actions(source_type,card_id,revision,action,admin_user_id,evidence)
    values(s,c,v,decision,actor,jsonb_build_object('payload',j.payload,'result',j.result,'state',j.state));
  if decision='retry' then
    update dating_profile_review_jobs set state='queued',attempts=0,revision=gen_random_uuid(),available_at=now(),
      lease_token=null,lease_until=null,error=null,result=null,reviewed_at=null,updated_at=now() where source_type=s and card_id=c;
    return;
  end if;
  if decision='ban' then
    reason:='프로필 자동 검수 결과 확인 후 관리자 직접 밴 처리. AI 단독 확정 판정 아님.';
    update profiles set is_banned=true,banned_reason=case when is_banned then banned_reason else reason end,
      banned_at=case when is_banned then banned_at else now() end where user_id=target_user;
    if not found then raise exception 'profile missing'; end if;
    update dating_cards set status='hidden',expires_at=now() where owner_user_id=target_user and status in ('pending','public');
    update dating_paid_cards set status='expired',expires_at=now() where user_id=target_user and status in ('pending','approved');
    update dating_1on1_cards set status='rejected',reviewed_at=now(),reviewed_by_user_id=actor
      where user_id=target_user and status in ('submitted','reviewing','approved');
  elsif decision='delete' then
    if s='open_card' then delete from dating_cards where id=c;
    else delete from dating_1on1_cards where id=c; end if;
  end if;
  update dating_profile_review_jobs set resolution=case decision when 'clear' then 'cleared' when 'ban' then 'banned' else 'deleted' end,
    lease_token=null,lease_until=null,updated_at=now() where source_type=s and card_id=c;
end $$;

revoke all on function public.dating_profile_review_payload(text,jsonb),
  public.enqueue_dating_profile_review(text,uuid,uuid,jsonb),public.capture_dating_profile_review(),
  public.reconcile_dating_profile_reviews(),public.claim_dating_profile_reviews(integer),
  public.finish_dating_profile_review(text,uuid,uuid,uuid,jsonb,text),
  public.resolve_dating_profile_review(text,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.dating_profile_review_payload(text,jsonb),
  public.enqueue_dating_profile_review(text,uuid,uuid,jsonb),public.reconcile_dating_profile_reviews(),
  public.claim_dating_profile_reviews(integer),public.finish_dating_profile_review(text,uuid,uuid,uuid,jsonb,text),
  public.resolve_dating_profile_review(text,uuid,uuid,text,uuid) to service_role;
commit;
notify pgrst, 'reload schema';
