-- Chat-only integration. No payment, approval or phone disclosure function changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table if not exists public.dating_1on1_private_chat_reads (
  match_id uuid not null references public.dating_1on1_private_contacts(match_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_id bigint not null default 0 check(last_read_id>=0),
  notification_id uuid references public.notifications(id) on delete set null,
  primary key(match_id,user_id)
);
alter table public.dating_1on1_private_chat_reads enable row level security;
revoke all on public.dating_1on1_private_chat_reads from public,anon,authenticated,service_role;
grant select on public.dating_1on1_private_chat_reads to service_role;

-- Only the server can obtain the inputs needed to compute contact-block hashes.
-- A single bounded batch avoids a series of per-room network requests.
create or replace function public.private_chat_contexts(p_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set statement_timeout='5s' as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
    select c.match_id,c.instagram,array[a.phone_e164,b.phone_e164] as phones
    from public.dating_1on1_private_contacts c
    join public.dating_1on1_match_proposals m on m.id=c.match_id
    join public.toss_test_payment_orders o on o.id=c.order_id
    join public.profiles a on a.user_id=m.source_user_id
    join public.profiles b on b.user_id=m.candidate_user_id
    where p_user in(m.source_user_id,m.candidate_user_id) and m.state='mutual_accepted'
      and m.contact_exchange_status='approved' and o.status='paid' and coalesce(o.cancel_amount,0)=0 and o.canceled_at is null
      and a.phone_e164 ~ '^\+[1-9][0-9]{7,14}$' and b.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
    order by c.match_id limit 1001
  ) x;
  if jsonb_array_length(result)>1000 then raise exception 'PRIVATE_INBOX_LIMIT'; end if;
  return result;
end $$;

create or replace function public.private_chat_inbox(p_user uuid,p_contexts jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='3s' set statement_timeout='8s' as $$
declare ctx jsonb; mid uuid; item jsonb; result jsonb:='[]'::jsonb;
begin
  if p_user is null or jsonb_typeof(p_contexts) is distinct from 'array' or jsonb_array_length(p_contexts)>1000 then raise exception 'PRIVATE_INPUT'; end if;
  for ctx in select value from jsonb_array_elements(p_contexts) loop
    mid:=(ctx->>'match_id')::uuid;
    begin
      perform public.guard_private_contact_pair(mid,p_user,
        array(select jsonb_array_elements_text(ctx->'phones')),
        array(select jsonb_array_elements_text(ctx->'contact_hashes')),
        array(select jsonb_array_elements_text(ctx->'legacy_hashes')),ctx->>'instagram_hash');
    exception when raise_exception then
      if sqlerrm in('PRIVATE_MATCH_UNAVAILABLE','PRIVATE_ACCOUNT_UNAVAILABLE','PRIVATE_BLOCKED') then continue; end if;
      raise;
    end;
    select jsonb_build_object('match_id',c.match_id,'peer_name',coalesce(nullif(left(d.name,30),''),'1:1 상대'),
      'last_message',coalesce(left(msg.content,120),''),'last_message_at',coalesce(msg.created_at,c.created_at),
      'unread_count',(select count(*) from public.dating_1on1_private_messages v
        where v.match_id=c.match_id and v.sender_user_id<>p_user and v.id>coalesce(r.last_read_id,0))) into item
    from public.dating_1on1_private_contacts c
    join public.dating_1on1_match_proposals m on m.id=c.match_id
    join public.toss_test_payment_orders o on o.id=c.order_id
    join public.dating_1on1_cards d on d.id=case when m.source_user_id=p_user then m.candidate_card_id else m.source_card_id end
    left join public.dating_1on1_private_chat_reads r on r.match_id=c.match_id and r.user_id=p_user
    left join lateral(select content,created_at from public.dating_1on1_private_messages where match_id=c.match_id order by id desc limit 1) msg on true
    where c.match_id=mid and p_user in(m.source_user_id,m.candidate_user_id) and m.state='mutual_accepted'
      and m.contact_exchange_status='approved' and o.status='paid' and coalesce(o.cancel_amount,0)=0 and o.canceled_at is null;
    if item is not null then result:=result||jsonb_build_array(item); end if;
  end loop;
  return coalesce((select jsonb_agg(value order by value->>'last_message_at' desc,value->>'match_id') from jsonb_array_elements(result)),'[]'::jsonb);
end $$;

-- One unread alert per recipient/room. Replayed client IDs do not insert a new
-- message, so this trigger cannot issue duplicate alerts on a retry.
create or replace function public.notify_private_chat_message()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare recipient uuid; nid uuid; meta jsonb;
begin
  select case when source_user_id=new.sender_user_id then candidate_user_id else source_user_id end into recipient
    from public.dating_1on1_match_proposals where id=new.match_id and new.sender_user_id in(source_user_id,candidate_user_id);
  if recipient is null or recipient=new.sender_user_id then raise exception 'PRIVATE_MESSAGE_INVALID'; end if;
  insert into public.dating_1on1_private_chat_reads(match_id,user_id) values(new.match_id,recipient) on conflict do nothing;
  select notification_id into nid from public.dating_1on1_private_chat_reads where match_id=new.match_id and user_id=recipient for update;
  -- Do not put message text, phones, Instagram IDs or a private name in alerts.
  meta:=jsonb_build_object('notification_type','dating_1on1_chat_message','match_id',new.match_id,
    'notification_title','1:1 대화에 새 메시지가 왔어요','notification_body','채팅에서 상대방의 메시지를 확인해 주세요.',
    'notification_route','/chat/one-on-one/'||new.match_id::text);
  update public.notifications set created_at=new.created_at,meta_json=meta
    where id=nid and user_id=recipient and is_read=false;
  if not found then
    -- The established generic notification envelope works with all deployed type constraints.
    insert into public.notifications(user_id,actor_id,type,post_id,comment_id,meta_json)
      values(recipient,null,'comment',null,null,meta) returning id into nid;
    update public.dating_1on1_private_chat_reads set notification_id=nid where match_id=new.match_id and user_id=recipient;
  end if;
  return new;
end $$;
drop trigger if exists notify_private_chat_message on public.dating_1on1_private_messages;
create trigger notify_private_chat_message after insert on public.dating_1on1_private_messages for each row execute function public.notify_private_chat_message();

create or replace function public.read_private_chat(p_match uuid,p_user uuid,p_phones text[],p_contact_hashes text[],p_legacy_hashes text[],p_instagram_hash text,p_through text)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='3s' set statement_timeout='5s' as $$
declare through_id bigint; remaining bigint;
begin
  -- Reuse the existing authorization, paid/refund and block checks. This GET-like
  -- invocation cannot approve an exchange, charge a payment, or reveal a phone.
  perform public.private_contact_messages(p_match,p_user,p_phones,p_contact_hashes,p_legacy_hashes,p_instagram_hash);
  if p_through is null or p_through !~ '^[1-9][0-9]{0,18}$' then raise exception 'PRIVATE_READ_INVALID'; end if;
  through_id:=p_through::bigint;
  if not exists(select 1 from public.dating_1on1_private_messages where match_id=p_match and id=through_id) then raise exception 'PRIVATE_READ_INVALID'; end if;
  insert into public.dating_1on1_private_chat_reads(match_id,user_id,last_read_id) values(p_match,p_user,through_id)
    on conflict(match_id,user_id) do update set last_read_id=greatest(dating_1on1_private_chat_reads.last_read_id,excluded.last_read_id);
  select count(*) into remaining from public.dating_1on1_private_messages v
    join public.dating_1on1_private_chat_reads r on r.match_id=v.match_id and r.user_id=p_user
    where v.match_id=p_match and v.sender_user_id<>p_user and v.id>r.last_read_id;
  if remaining=0 then
    update public.notifications set is_read=true where user_id=p_user and is_read=false
      and meta_json->>'notification_type'='dating_1on1_chat_message' and meta_json->>'match_id'=p_match::text;
  end if;
  return jsonb_build_object('ok',true,'unread_count',remaining);
end $$;
revoke all on function public.private_chat_contexts(uuid),public.private_chat_inbox(uuid,jsonb),public.notify_private_chat_message(),
  public.read_private_chat(uuid,uuid,text[],text[],text[],text,text) from public,anon,authenticated,service_role;
grant execute on function public.private_chat_contexts(uuid),public.private_chat_inbox(uuid,jsonb),
  public.read_private_chat(uuid,uuid,text[],text[],text[],text,text) to service_role;
commit;
notify pgrst,'reload schema';
