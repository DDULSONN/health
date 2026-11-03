-- Additive opt-in payer contact disclosure. Existing exchanges are not migrated.
-- Enable new checkouts only after deploying the privacy-preserving application.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table if not exists public.dating_1on1_private_contacts (
  match_id uuid primary key references public.dating_1on1_match_proposals(id) on delete cascade,
  order_id uuid not null unique references public.toss_test_payment_orders(id),
  payer_user_id uuid not null references auth.users(id) on delete cascade,
  instagram text not null check (instagram ~ '^[a-z0-9_][a-z0-9._]{0,29}$' or instagram ~ '^[a-z0-9_]$'),
  created_at timestamptz not null default now()
);
create table if not exists public.dating_1on1_private_messages (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.dating_1on1_private_contacts(match_id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  content text not null check (char_length(btrim(content)) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique(match_id,sender_user_id,client_id)
);
create index if not exists private_messages_match_id on public.dating_1on1_private_messages(match_id,id desc);
alter table public.dating_1on1_private_contacts enable row level security;
alter table public.dating_1on1_private_messages enable row level security;
revoke all on public.dating_1on1_private_contacts,public.dating_1on1_private_messages from public,anon,authenticated,service_role;
grant select on public.dating_1on1_private_contacts,public.dating_1on1_private_messages to service_role;

-- Rechecks current account/phone/block state at the transaction boundary.
create or replace function public.guard_private_contact_pair(p_match uuid,p_user uuid,p_phones text[],p_contact_hashes text[],p_legacy_hashes text[],p_instagram_hash text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare m public.dating_1on1_match_proposals%rowtype; contact_payer uuid;
begin
  select * into m from public.dating_1on1_match_proposals where id=p_match for share;
  if not found or p_user is null or p_user not in(m.source_user_id,m.candidate_user_id)
    or m.source_user_id=m.candidate_user_id or m.state not in('candidate_accepted','mutual_accepted')
    or m.contact_exchange_status is null or m.contact_exchange_status='canceled' then raise exception 'PRIVATE_MATCH_UNAVAILABLE'; end if;
  if array_length(p_phones,1) is distinct from 2 or array_length(p_contact_hashes,1) is distinct from 2
    or array_length(p_legacy_hashes,1) is distinct from 2 or p_instagram_hash is null then raise exception 'PRIVATE_INPUT'; end if;
  select payer_user_id into contact_payer from public.dating_1on1_private_contacts where match_id=p_match;
  contact_payer:=coalesce(contact_payer,p_user);
  if (select count(*) from public.profiles p join auth.users u on u.id=p.user_id
    join public.dating_1on1_cards d on d.user_id=p.user_id and d.id=case when p.user_id=m.source_user_id then m.source_card_id else m.candidate_card_id end
    where p.user_id in(m.source_user_id,m.candidate_user_id) and p.phone_verified is true
      and p.phone_e164=case when p.user_id=m.source_user_id then p_phones[1] else p_phones[2] end
      and not coalesce(p.is_banned,false) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
      and d.birth_year between 1960 and extract(year from now() at time zone 'Asia/Seoul')::int-19)<>2 then raise exception 'PRIVATE_ACCOUNT_UNAVAILABLE'; end if;
  if exists(select 1 from public.dating_user_blocks where
    (blocker_user_id=m.source_user_id and blocked_user_id=m.candidate_user_id) or (blocker_user_id=m.candidate_user_id and blocked_user_id=m.source_user_id))
    or exists(select 1 from public.dating_1on1_admin_user_blocks where
    (user_a_id=m.source_user_id and user_b_id=m.candidate_user_id) or (user_a_id=m.candidate_user_id and user_b_id=m.source_user_id))
    or exists(select 1 from public.dating_contact_blocks where
      (block_type='phone' and ((user_id=m.source_user_id and value_hash=p_contact_hashes[2]) or (user_id=m.candidate_user_id and value_hash=p_contact_hashes[1])))
      or (block_type='instagram' and user_id in(m.source_user_id,m.candidate_user_id) and user_id<>contact_payer and value_hash=p_instagram_hash))
    or exists(select 1 from public.dating_1on1_phone_blocks where
      (user_id=m.source_user_id and phone_hash=p_legacy_hashes[2]) or (user_id=m.candidate_user_id and phone_hash=p_legacy_hashes[1]))
    then raise exception 'PRIVATE_BLOCKED'; end if;
end $$;

create or replace function public.check_private_contact_exchange(p_match uuid,p_user uuid,p_phones text[],p_contact_hashes text[],p_legacy_hashes text[],p_instagram_hash text)
returns void language plpgsql security definer set search_path=pg_catalog set lock_timeout='3s' set statement_timeout='5s' as $$
begin
  perform public.guard_private_contact_pair(p_match,p_user,p_phones,p_contact_hashes,p_legacy_hashes,p_instagram_hash);
  if exists(select 1 from public.dating_1on1_match_proposals where id=p_match and contact_exchange_status='approved') then raise exception 'PRIVATE_ALREADY_APPROVED'; end if;
end $$;

create or replace function public.approve_private_contact_exchange(p_match uuid,p_user uuid,p_phones text[],p_contact_hashes text[],p_legacy_hashes text[],p_instagram_hash text,p_order uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='3s' set statement_timeout='5s' as $$
declare m public.dating_1on1_match_proposals%rowtype; o public.toss_test_payment_orders%rowtype; handle text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_match::text,15000));
  select * into m from public.dating_1on1_match_proposals where id=p_match for update;
  select * into o from public.toss_test_payment_orders where id=p_order for update;
  if not found or o.user_id is distinct from p_user or o.product_type<>'one_on_one_contact_exchange'
    or o.product_ref_id is distinct from p_match or o.status<>'paid' or o.payment_key is null or coalesce(o.cancel_amount,0)<>0 or o.canceled_at is not null
    or o.product_meta->'payerContact'->>'mode' is distinct from 'instagram' then raise exception 'PRIVATE_ORDER_INVALID'; end if;
  handle:=o.product_meta->'payerContact'->>'instagram';
  if handle is null or handle !~ '^[a-z0-9_][a-z0-9._]{0,29}$' or handle like '%..%' or right(handle,1)='.' then raise exception 'PRIVATE_HANDLE_INVALID'; end if;
  perform public.guard_private_contact_pair(p_match,p_user,p_phones,p_contact_hashes,p_legacy_hashes,p_instagram_hash);
  if exists(select 1 from public.dating_1on1_private_contacts where match_id=p_match and order_id=p_order and payer_user_id=p_user and instagram=handle)
    and m.contact_exchange_status='approved' then return jsonb_build_object('matchId',p_match,'alreadyApproved',true); end if;
  if m.contact_exchange_status not in('none','awaiting_applicant_payment','payment_pending_admin') then raise exception 'PRIVATE_EXCHANGE_CHANGED'; end if;
  insert into public.dating_1on1_private_contacts(match_id,order_id,payer_user_id,instagram) values(p_match,p_order,p_user,handle);
  update public.dating_1on1_match_proposals set state='mutual_accepted',contact_exchange_status='approved',
    contact_exchange_requested_at=now(),contact_exchange_paid_at=now(),contact_exchange_paid_by_user_id=p_user,
    contact_exchange_approved_at=now(),contact_exchange_approved_by_user_id=null,
    contact_exchange_note='instagram:v1:'||p_order::text,updated_at=now() where id=p_match;
  return jsonb_build_object('matchId',p_match,'alreadyApproved',false);
end $$;

-- A legacy admin note edit must not remove the fail-closed privacy marker.
create or replace function public.preserve_private_contact_marker()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from public.dating_1on1_private_contacts where match_id=new.id) and
    position('instagram:v1:' in coalesce(new.contact_exchange_note,''))=0 then
    new.contact_exchange_note:='instagram:v1: '||coalesce(new.contact_exchange_note,'');
  end if;
  return new;
end $$;
drop trigger if exists preserve_private_contact_marker on public.dating_1on1_match_proposals;
create trigger preserve_private_contact_marker before update on public.dating_1on1_match_proposals for each row execute function public.preserve_private_contact_marker();

create or replace function public.private_contact_messages(p_match uuid,p_user uuid,p_phones text[],p_contact_hashes text[],p_legacy_hashes text[],p_instagram_hash text,p_content text default null,p_client_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='3s' set statement_timeout='5s' as $$
declare output jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_match::text,17091));
  perform public.guard_private_contact_pair(p_match,p_user,p_phones,p_contact_hashes,p_legacy_hashes,p_instagram_hash);
  if not exists(select 1 from public.dating_1on1_private_contacts c join public.dating_1on1_match_proposals m on m.id=c.match_id
    join public.toss_test_payment_orders o on o.id=c.order_id where c.match_id=p_match and m.state='mutual_accepted'
    and m.contact_exchange_status='approved' and o.status='paid' and coalesce(o.cancel_amount,0)=0 and o.canceled_at is null) then raise exception 'PRIVATE_CHAT_UNAVAILABLE'; end if;
  if p_content is not null then
    if p_client_id is null or char_length(btrim(p_content)) not between 1 and 1000 then raise exception 'PRIVATE_MESSAGE_INVALID'; end if;
    if not exists(select 1 from public.dating_1on1_private_messages where match_id=p_match and sender_user_id=p_user and client_id=p_client_id) then
      if (select count(*) from public.dating_1on1_private_messages where match_id=p_match and sender_user_id=p_user and created_at>now()-interval '1 minute')>=20 then raise exception 'PRIVATE_RATE_LIMIT'; end if;
      insert into public.dating_1on1_private_messages(match_id,sender_user_id,client_id,content) values(p_match,p_user,p_client_id,btrim(p_content));
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'mine',sender_user_id=p_user,'content',content,'created_at',created_at) order by id),'[]'::jsonb)
    into output from (select * from public.dating_1on1_private_messages where match_id=p_match order by id desc limit 100) recent;
  return output;
end $$;
revoke all on function public.guard_private_contact_pair(uuid,uuid,text[],text[],text[],text),public.preserve_private_contact_marker(),
  public.check_private_contact_exchange(uuid,uuid,text[],text[],text[],text),
  public.approve_private_contact_exchange(uuid,uuid,text[],text[],text[],text,uuid),
  public.private_contact_messages(uuid,uuid,text[],text[],text[],text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.check_private_contact_exchange(uuid,uuid,text[],text[],text[],text),
  public.approve_private_contact_exchange(uuid,uuid,text[],text[],text[],text,uuid),
  public.private_contact_messages(uuid,uuid,text[],text[],text[],text,text,uuid) to service_role;
commit;
notify pgrst,'reload schema';
