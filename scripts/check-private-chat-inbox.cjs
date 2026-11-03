/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {runtime,id,load,read}=require('./fixtures/contact-checkout-runtime.cjs');
const decode=async task=>{const res=await task;return {status:res.status,body:await res.json(),headers:res.headers};};
async function paid(f,payer=id(1)) {
  const c=await decode(f.routes(payer).create(f.request({productType:'one_on_one_contact_exchange',matchId:id(10),payerContact:{mode:'instagram',instagram:'sample_runner'}})));
  assert.equal(c.status,200,JSON.stringify(c.body));
  const r=await decode(f.routes(payer).confirm(f.request({orderId:c.body.orderId,paymentKey:'test_'+c.body.orderId,amount:18000},'/api/payments/toss/confirm')));
  assert.equal(r.status,200,JSON.stringify(r.body));
}
const inbox=(f,user)=>decode(f.routes(user).privateInbox(new Request('http://127.0.0.1:3161/api/dating/1on1/private-chat/inbox')));
const send=(f,user,n=1)=>decode(f.routes(user).privateChat.POST(f.request({matchId:id(10),clientId:id(100+n),content:'안녕하세요 🙂 '+n},'/api/dating/1on1/private-chat')));
const mark=(f,user,through,matchId=id(10),origin)=>decode(f.routes(user).privateChat.PATCH(new Request('http://127.0.0.1:3161/api/dating/1on1/private-chat',{method:'PATCH',headers:{origin:origin||'http://127.0.0.1:3161',host:'127.0.0.1:3161','Content-Type':'application/json'},body:JSON.stringify({matchId,through})})));
const notes=async f=>(await f.db.query('select * from notifications order by created_at')).rows;

for(const payer of [id(1),id(2)]) test('private inbox: both participants, existing exchange, incoming-only count, no identity/contact leak '+payer.slice(-1),async()=>{
  const f=await runtime({privateContact:true});try {
    assert.equal((await inbox(f,id(1))).body.items.length,0);await paid(f,payer);
    const a=await inbox(f,id(1));assert.equal(a.status,200);assert.equal(a.body.items[0].peer_name,'테스트회원B');
    assert.equal(a.body.items[0].unread_count,0);assert.equal((await inbox(f,id(2))).body.items[0].peer_name,'테스트회원A');
    assert.match(a.headers.get('cache-control'),/no-store/);assert(!JSON.stringify(a.body).includes('sample_runner'));assert(!JSON.stringify(a.body).includes('8210'));
    assert.equal((await inbox(f,id(3))).body.items.length,0);assert.equal((await inbox(f,null)).status,401);
    assert.equal((await send(f,id(1))).status,200);
    assert.equal((await inbox(f,id(1))).body.items[0].unread_count,0);assert.equal((await inbox(f,id(2))).body.items[0].unread_count,1);
    const n=(await notes(f))[0];assert.equal(n.user_id,id(2));assert.equal(n.actor_id,null);assert.equal(n.meta_json.notification_route,'/chat/one-on-one/'+id(10));
    assert(!JSON.stringify(n).includes('안녕하세요'));assert(!JSON.stringify(n).includes('sample_runner'));
  }finally{await f.db.close();}
});
test('retry is idempotent; multiple messages group one alert; actual read clears and new message alerts again',async()=>{
  const f=await runtime({privateContact:true});try {
    await paid(f);await send(f,id(1));await send(f,id(1));const s=await send(f,id(1),2);assert.equal(s.body.items.length,2);
    assert.equal((await notes(f)).length,1);assert.equal((await inbox(f,id(2))).body.items[0].unread_count,2);
    const r=await mark(f,id(2),s.body.items[1].id);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.unread_count,0);
    assert.equal((await notes(f))[0].is_read,true);assert.equal((await inbox(f,id(2))).body.items[0].unread_count,0);
    await send(f,id(1),3);assert.equal((await notes(f)).length,2);assert.equal((await inbox(f,id(2))).body.items[0].unread_count,1);
    await mark(f,id(2),s.body.items[0].id);assert.equal((await inbox(f,id(2))).body.items[0].unread_count,1);
  }finally{await f.db.close();}
});
test('new arrival after displayed snapshot stays unread; own cursor cannot read for the other member; future/foreign reads refused',async()=>{
  const f=await runtime({privateContact:true});try {
    await paid(f);const first=await send(f,id(1));await send(f,id(1),2);
    assert.equal((await mark(f,id(2),first.body.items[0].id)).body.unread_count,1);assert.equal((await notes(f))[0].is_read,false);
    assert.equal((await mark(f,id(1),first.body.items[0].id)).status,200);
    assert.equal((await inbox(f,id(2))).body.items[0].unread_count,1);
    assert.equal((await mark(f,id(3),first.body.items[0].id)).status,409);
    for(const value of ['9999999999999999999','1;select','0',1,null]) assert.notEqual((await mark(f,id(2),value)).status,200);
    assert.equal((await mark(f,id(2),first.body.items[0].id,id(10),'https://other.invalid')).status,403);
    assert.equal((await inbox(f,id(2))).body.items[0].unread_count,1);
  }finally{await f.db.close();}
});
test('last displayed outgoing message can acknowledge older incoming messages beyond the latest 100',async()=>{
  const f=await runtime({privateContact:true});try {
    await paid(f);await send(f,id(1));
    // Synthetic history, not live messages or users.
    await f.db.query(`insert into dating_1on1_private_messages(match_id,sender_user_id,client_id,content)
      select $1,$2,gen_random_uuid(),'보낸 대화 '||n from generate_series(1,101) n`,[id(10),id(2)]);
    const history=await decode(f.routes(id(2)).privateChat.GET(new Request('http://127.0.0.1:3161/api/dating/1on1/private-chat?matchId='+id(10))));
    assert.equal(history.body.items.length,100);assert(history.body.items.every(m=>m.mine));
    assert.equal((await mark(f,id(2),history.body.items.at(-1).id)).body.unread_count,0);
    assert.equal((await inbox(f,id(2))).body.items[0].unread_count,0);
  }finally{await f.db.close();}
});
for(const change of [
  "update dating_1on1_match_proposals set state='admin_canceled',contact_exchange_status='canceled'",
  `insert into dating_user_blocks values('${id(1)}','${id(2)}')`,
  `insert into dating_1on1_admin_user_blocks values('${id(1)}','${id(2)}')`,
  `update profiles set is_banned=true where user_id='${id(2)}'`,
  `update auth.users set deleted_at=now() where id='${id(2)}'`,
  "update toss_test_payment_orders set cancel_amount=1",
  "update toss_test_payment_orders set status='canceled'",
  "update toss_test_payment_orders set canceled_at=now()",
  "update dating_1on1_cards set birth_year=2020",
]) test('revoked chat disappears from list/badge and cannot be marked read: '+change.split(' ').slice(0,4).join(' '),async()=>{
  const f=await runtime({privateContact:true});try {
    await paid(f);const s=await send(f,id(1));await f.db.exec(change);
    assert.equal((await inbox(f,id(1))).body.items.length,0);assert.equal((await inbox(f,id(2))).body.items.length,0);
    assert.equal((await mark(f,id(2),s.body.items[0].id)).status,409);
    assert.equal((await send(f,id(1),2)).status,409);assert.equal((await notes(f)).length,1);
  }finally{await f.db.close();}
});
test('contact phone/Instagram blocks use the payer hashes in either direction; invalidated phone does not break other lists',async()=>{
  const f=await runtime({privateContact:true});try {
    await paid(f);const hash=require('node:crypto').createHash('sha256').update('instagram:sample_runner').digest('hex');
    await f.db.query('insert into dating_contact_blocks values($1,$2,$3)',[id(2),'instagram',hash]);
    assert.equal((await inbox(f,id(1))).body.items.length,0);assert.equal((await inbox(f,id(2))).body.items.length,0);
    await f.db.exec('delete from dating_contact_blocks;update profiles set phone_e164=null');
    assert.equal((await inbox(f,id(1))).body.items.length,0);
  }finally{await f.db.close();}
});
test('read failure preserves unread; schema/query failures are not presented as empty; migration repeat preserves payment functions',async()=>{
  const f=await runtime({privateContact:true});try {
    await paid(f);await send(f,id(1));
    const before=(await f.db.query("select prosrc from pg_proc where proname='approve_private_contact_exchange'")).rows;
    await f.db.exec(read('supabase/sql/dating_1on1_private_chat_inbox.sql'));
    assert.deepEqual((await f.db.query("select prosrc from pg_proc where proname='approve_private_contact_exchange'")).rows,before);
    assert.equal((await notes(f)).length,1);assert.equal((await inbox(f,id(2))).body.items[0].unread_count,1);
    await f.db.exec('alter table dating_1on1_private_chat_reads rename to missing_reads');
    const r=await inbox(f,id(2));assert.equal(r.status,503);assert.equal(r.body.items,undefined);
    const payment=(await f.db.query('select status from toss_test_payment_orders')).rows[0];assert.equal(payment.status,'paid');
  }finally{await f.db.close();}
});
test('new functions/tables cannot be used directly by anon/members; read cannot change phone or payment',async()=>{
  const f=await runtime({privateContact:true});try {
    const privileges=(await f.db.query(`select has_table_privilege('authenticated','dating_1on1_private_chat_reads','SELECT') as member_read,
      has_table_privilege('service_role','dating_1on1_private_chat_reads','UPDATE') as direct_write,
      has_function_privilege('anon','private_chat_contexts(uuid)','EXECUTE') as context,
      has_function_privilege('authenticated','private_chat_inbox(uuid,jsonb)','EXECUTE') as inbox,
      has_function_privilege('authenticated','read_private_chat(uuid,uuid,text[],text[],text[],text,text)','EXECUTE') as read,
      has_function_privilege('service_role','notify_private_chat_message()','EXECUTE') as trigger`)).rows[0];
    assert(Object.values(privileges).every(v=>v===false));
    await paid(f);const before=(await f.db.query('select row_to_json(m) value from dating_1on1_match_proposals m')).rows;
    const s=await send(f,id(1));await mark(f,id(2),s.body.items[0].id);
    assert.deepEqual((await f.db.query('select row_to_json(m) value from dating_1on1_match_proposals m')).rows,before);
    assert.equal(f.provider.calls.filter(c=>c.type==='confirm').length,1);
  }finally{await f.db.close();}
});
test('private inbox browser parser rejects malformed responses and duplicate unsafe links',()=>{
  const {parsePrivateChatInbox}=load('lib/private-chat-inbox-client.ts');
  const item={match_id:id(10),peer_name:'수빈',last_message:'반가워요',last_message_at:new Date().toISOString(),unread_count:1};
  assert.equal(parsePrivateChatInbox({items:[item]}).length,1);
  for(const body of [null,{}, {items:[item,item]}, {items:[{...item,match_id:'//bad'}]}, {items:[{...item,unread_count:-1}]}])assert.equal(parsePrivateChatInbox(body),null);
});
test('global chat badge adds private unread without changing legacy thread or available counts',async()=>{
  const deps={
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:{id:id(1)}})},
    '@/lib/supabase/server':{createAdminClient:()=>({from:table=>{
      const q={select(){return q;},or(){return q;},eq(){return q;},in(){return q;},then(fn){return Promise.resolve(table==='dating_chat_threads'?{data:[{id:id(40),source_kind:'open',source_id:id(41),user_a_id:id(1),user_b_id:id(2),status:'open'}],error:null}:{count:3,error:null}).then(fn);}};return q;
    }})},
    '@/lib/dating-chat':{listDatingChatConnections:async()=>[{sourceKind:'open',sourceId:id(41)},{sourceKind:'paid',sourceId:id(42)}],isMissingDatingChatRelation:()=>false},
    '@/lib/private-chat-inbox':{loadPrivateChatInbox:async()=>[{unread_count:2}]},
  };
  const route=load('app/api/dating/chat/badge/route.ts',deps);
  assert.deepEqual((await decode(route.GET(new Request('http://localhost/api/dating/chat/badge')))).body,{ok:true,unreadCount:5,availableCount:1});
  deps['@/lib/private-chat-inbox'].loadPrivateChatInbox=async()=>{throw Error('temporary failure');};
  const failure=await decode(load('app/api/dating/chat/badge/route.ts',deps,{console:{error(){}}}).GET(new Request('http://localhost/api/dating/chat/badge')));
  assert.equal(failure.status,500);assert.equal(failure.body.unreadCount,undefined);
});
test('bigint message IDs are kept as strings beyond JavaScript integer precision',async()=>{
  const f=await runtime({privateContact:true});try {
    await paid(f);await f.db.exec('alter table dating_1on1_private_messages alter column id restart with 9007199254740993');
    const s=await send(f,id(1));assert.equal(s.body.items[0].id,'9007199254740993');
    assert.equal((await mark(f,id(2),s.body.items[0].id)).body.unread_count,0);
  }finally{await f.db.close();}
});
test('notification write failure rolls back only the message; payment and private disclosure remain intact',async()=>{
  const f=await runtime({privateContact:true});try {
    await paid(f);await f.db.exec(`create function fail_notice() returns trigger language plpgsql as $$begin raise exception 'fixture failure';end$$;
      create trigger fail_notice before insert on notifications for each row execute function fail_notice();`);
    assert.equal((await send(f,id(1))).status,409);assert.equal((await f.db.query('select count(*)::int n from dating_1on1_private_messages')).rows[0].n,0);
    assert.equal((await f.db.query('select status from toss_test_payment_orders')).rows[0].status,'paid');
    await f.db.exec('drop trigger fail_notice on notifications');assert.equal((await send(f,id(1))).status,200);assert.equal((await notes(f)).length,1);
  }finally{await f.db.close();}
});
