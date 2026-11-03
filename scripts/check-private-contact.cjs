/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {runtime,id,load,read}=require('./fixtures/contact-checkout-runtime.cjs');
const {normalizeContactInstagram,parsePayerContact}=load('lib/dating-private-contact.ts');
const decode=async pending=>{const r=await pending;return {status:r.status,body:await r.json()};};
const choice={mode:'instagram',instagram:'sample_runner'};
const create=(f,user=id(1),extra={})=>decode(f.routes(user).create(f.request({productType:'one_on_one_contact_exchange',matchId:id(10),payerContact:choice,...extra})));
const confirm=(f,order,user=id(1),extra={})=>decode(f.routes(user).confirm(f.request({orderId:order,paymentKey:'test_'+order,amount:18000,...extra},'/api/payments/toss/confirm')));
const mine=(f,user)=>decode(f.routes(user).mine(new Request('http://127.0.0.1:3161/api/dating/1on1/matches/my')));
const chat=(f,user,body)=>body ? decode(f.routes(user).privateChat.POST(f.request({matchId:id(10),clientId:id(70),...body},'/api/dating/1on1/private-chat'))) : decode(f.routes(user).privateChat.GET(new Request('http://127.0.0.1:3161/api/dating/1on1/private-chat?matchId='+id(10))));
async function paid(f,user=id(1)){const c=await create(f,user);assert.equal(c.status,200,JSON.stringify(c));const a=await confirm(f,c.body.orderId,user);assert.equal(a.status,200,JSON.stringify(a));return c.body.orderId;}
test('handle input is exact, bounded and cannot create arbitrary URLs or HTML',()=>{
  assert.equal(normalizeContactInstagram(' @My.Runner_1 '),'my.runner_1');
  for(const value of ['', '.', '..', 'a..b','a.','.a','https://instagram.com/abc','a/b','a?b','<script>','a'.repeat(31),'한글',{},null]) assert.equal(normalizeContactInstagram(value),null);
  assert.equal(parsePayerContact(undefined),null);assert.throws(()=>parsePayerContact({mode:'phone',instagram:'abc'}));
});
for(const payer of [id(1),id(2)])test(`actual routes and atomic SQL: asymmetric disclosure, both chat directions, repeated confirm (${payer.slice(-1)})`,async()=>{
  const f=await runtime({privateContact:true});try{
    const recipient=payer===id(1)?id(2):id(1);
    assert.equal((await chat(f,payer)).status,409);
    const order=await paid(f,payer);
    const a=await mine(f,payer),b=await mine(f,recipient);
    assert.equal(a.status,200);assert.equal(b.status,200);
    assert.equal(a.body.items[0].counterparty_phone,payer===id(1)?'01000000002':'01000000001');
    assert.equal(a.body.items[0].my_contact_method,'instagram');
    assert.equal(b.body.items[0].counterparty_phone,null);assert.equal(b.body.items[0].counterparty_instagram,'sample_runner');
    assert(!JSON.stringify(b.body).includes(payer===id(1)?'01000000001':'01000000002'));
    assert(!JSON.stringify(b.body).includes(payer===id(1)?'+821000000001':'+821000000002'));
    assert.equal((await confirm(f,order,payer,{payerContact:{mode:'instagram',instagram:'tampered'}})).status,200);
    assert.equal((await f.db.query('select count(*)::int n from dating_1on1_private_contacts')).rows[0].n,1);
    assert.equal((await chat(f,payer,{content:'안녕하세요 🙂'})).status,200);
    const incoming=await chat(f,recipient);assert.equal(incoming.body.items[0].content,'안녕하세요 🙂');assert.equal(incoming.body.items[0].mine,false);
    assert.equal((await chat(f,recipient,{content:'반가워요!'})).status,200);
    assert.equal((await chat(f,payer,{content:'안녕하세요 🙂'})).body.items.length,2);
    assert.equal((await chat(f,id(3))).status,409);assert.equal((await chat(f,null)).status,401);
    assert.equal(f.provider.calls.filter(x=>x.type==='confirm').length,1);
  }finally{await f.db.close();}
});
test('default OFF, malformed choice, missing schema and wrong product fail before provider charge',async()=>{
  const f=await runtime();try{assert.equal((await create(f)).status,409);assert.equal(f.provider.calls.length,0);}finally{await f.db.close();}
  const g=await runtime({privateContact:true});try{
    assert.equal((await create(g,id(1),{payerContact:{...choice,instagram:'x/evil'}})).status,400);
    assert.equal((await create(g,id(1),{productType:'apply_credits'})).status,409);
    assert.equal((await create(g,id(1),{recoveryOrderId:'old'})).status,409);
    const oldOrder=await create(g,id(1),{payerContact:undefined});assert.equal(oldOrder.status,200);
    const providerCallsBefore=g.provider.calls.length;
    await g.db.exec('drop function check_private_contact_exchange(uuid,uuid,text[],text[],text[],text)');
    assert.notEqual((await create(g)).status,200);assert.equal(g.provider.calls.length,providerCallsBefore);
    assert.equal((await g.db.query('select status from toss_test_payment_orders where toss_order_id=$1',[oldOrder.body.orderId])).rows[0].status,'ready');
  }finally{await g.db.close();}
});
test('failed payment publishes neither contact nor chat; retry preserves Instagram',async()=>{
  const f=await runtime({privateContact:true});try{
    const c=await create(f);f.provider.flags.failure=true;
    assert.equal((await confirm(f,c.body.orderId)).status,502);
    assert.equal((await mine(f,id(2))).body.items[0].counterparty_phone,null);
    assert.equal((await chat(f,id(1))).status,409);
    f.provider.flags.failure=false;assert.equal((await confirm(f,c.body.orderId)).status,200);
    assert.equal((await mine(f,id(2))).body.items[0].counterparty_instagram,choice.instagram);
  }finally{await f.db.close();}
});

for(const status of ['READY','EXPIRED','ABORTED'])test('private recovery '+status+' never silently creates a phone-disclosing order',async()=>{
  const f=await runtime({privateContact:true});try{
    const c=await create(f);assert.equal(c.status,200);
    f.provider.payments.get(c.body.orderId).status=status;
    const result=await decode(f.routes().create(f.request({productType:'one_on_one_contact_exchange',matchId:id(10),recoveryOrderId:c.body.orderId})));
    assert.equal(result.status,status==='READY'?200:409,JSON.stringify(result));
    if(status==='READY'){assert.equal(result.body.reusedOrder,true);assert.match(result.body.checkoutUrl,new RegExp(c.body.orderId));}
    const orders=(await f.db.query('select product_meta from toss_test_payment_orders')).rows;
    assert.equal(orders.length,1);assert.deepEqual(orders[0].product_meta.payerContact,choice);
    assert.equal((await mine(f,id(2))).body.items[0].counterparty_phone,null);
  }finally{await f.db.close();}
});
test('paid-but-unfulfilled can retry without exposing payer phone or charging again',async()=>{
  const f=await runtime({privateContact:true});try{
    const c=await create(f);const rpc=f.admin.rpc;let fail=true;
    f.admin.rpc=async(name,params)=>name==='approve_private_contact_exchange'&&fail?(fail=false,{data:null,error:{message:'synthetic timeout'}}):rpc(name,params);
    assert.notEqual((await confirm(f,c.body.orderId)).status,200);
    assert.equal((await mine(f,id(2))).body.items[0].counterparty_phone,null);
    assert.equal((await confirm(f,c.body.orderId)).status,200);
    assert.equal((await mine(f,id(2))).body.items[0].counterparty_phone,null);
    assert.equal(f.provider.calls.filter(x=>x.type==='confirm').length,1);
  }finally{await f.db.close();}
});

test('private recovery does not silently use a newly granted phone-only Plus benefit',async()=>{
  const f=await runtime({privateContact:true});try{
    const c=await create(f);assert.equal(c.status,200);f.flags.includedContact=true;
    const result=await decode(f.routes().create(f.request({productType:'one_on_one_contact_exchange',matchId:id(10),recoveryOrderId:c.body.orderId})));
    assert.equal(result.status,409);assert.equal(result.body.code,'PRIVATE_CONTACT_RESELECT');
    assert.equal((await mine(f,id(2))).body.items[0].counterparty_phone,null);
    assert.equal((await f.db.query('select contact_exchange_status from dating_1on1_match_proposals')).rows[0].contact_exchange_status,'awaiting_applicant_payment');
  }finally{await f.db.close();}
});
for(const change of ["update dating_1on1_match_proposals set state='admin_canceled',contact_exchange_status='canceled'",
  `insert into dating_user_blocks values('${id(1)}','${id(2)}')`,
  `insert into dating_1on1_admin_user_blocks values('${id(1)}','${id(2)}')`,
  `update profiles set is_banned=true where user_id='${id(2)}'`,
  `update auth.users set deleted_at=now() where id='${id(2)}'`,
  "update toss_test_payment_orders set status='canceled'",
  "update toss_test_payment_orders set cancel_amount=1",
  "update toss_test_payment_orders set canceled_at=now()"
])test('chat access revoked after '+change.split(' ').slice(0,3).join(' '),async()=>{
  const f=await runtime({privateContact:true});try{await paid(f);await f.db.exec(change);assert.equal((await chat(f,id(1))).status,409);assert.equal((await chat(f,id(2),{content:'차단 후 전송'})).status,409);}finally{await f.db.close();}
});
test('privacy data errors fail closed; changing admin note never clears the marker',async()=>{
  const f=await runtime({privateContact:true});try{
    await paid(f);await f.db.exec("update dating_1on1_match_proposals set contact_exchange_note='admin memo'");
    assert.match((await f.db.query('select contact_exchange_note from dating_1on1_match_proposals')).rows[0].contact_exchange_note,/instagram:v1:/);
    await f.db.exec('alter table dating_1on1_private_contacts rename to missing_private_contacts');
    const result=await mine(f,id(2));assert.equal(result.status,503);assert(!JSON.stringify(result).includes('01000000001'));
  }finally{await f.db.close();}
});

test('chat rate limit preserves existing messages and idempotent retries; another member cannot see or send',async()=>{
  const f=await runtime({privateContact:true});try{
    await paid(f);
    for(let n=1;n<=20;n++)assert.equal((await chat(f,id(1),{content:'메시지 '+n,clientId:id(100+n)})).status,200);
    const limited=await chat(f,id(1),{content:'추가 전송',clientId:id(200)});
    assert.equal(limited.status,429);assert.match(limited.body.error,/잠시 후/);
    assert.equal((await chat(f,id(1),{content:'메시지 20',clientId:id(120)})).body.items.length,20);
    assert.equal((await chat(f,id(3),{content:'외부인',clientId:id(201)})).status,409);
    assert.equal((await chat(f,id(2))).body.items.length,20);
  }finally{await f.db.close();}
});
test('SQL functions and private tables are unavailable to anon/authenticated, paid order is required',async()=>{
  const f=await runtime({privateContact:true});try{
    await f.db.exec(read('supabase/sql/dating_1on1_private_contact.sql')); // repeat-install safe
    const permissions=(await f.db.query(`select has_table_privilege('authenticated','dating_1on1_private_contacts','SELECT') as reads,
      has_table_privilege('service_role','dating_1on1_private_contacts','INSERT') as writes,
      has_function_privilege('anon','approve_private_contact_exchange(uuid,uuid,text[],text[],text[],text,uuid)','EXECUTE') as approves`)).rows[0];
    assert.deepEqual(permissions,{reads:false,writes:false,approves:false});
    await create(f);const o=(await f.db.query('select id from toss_test_payment_orders')).rows[0];
    const result=await f.admin.rpc('approve_private_contact_exchange',{p_match:id(10),p_user:id(1),p_phones:['+821000000001','+821000000002'],p_contact_hashes:['x','y'],p_legacy_hashes:['a','b'],p_instagram_hash:'z',p_order:o.id});
    assert(result.error);assert.equal((await f.db.query('select count(*)::int n from dating_1on1_private_contacts')).rows[0].n,0);
  }finally{await f.db.close();}
});
test('SQL failure rolls back disclosure and approval together; same paid order repairs without another charge',async()=>{
  const f=await runtime({privateContact:true});try{
    const c=await create(f);
    await f.db.exec(`create function fixture_fail_private() returns trigger language plpgsql as $$begin raise exception 'synthetic approval storage failure';end$$;
      create trigger fixture_fail_private before update on dating_1on1_match_proposals for each row execute function fixture_fail_private();`);
    assert.notEqual((await confirm(f,c.body.orderId)).status,200);
    assert.equal((await f.db.query('select count(*)::int n from dating_1on1_private_contacts')).rows[0].n,0);
    assert.equal((await mine(f,id(2))).body.items[0].counterparty_phone,null);
    await f.db.exec('drop trigger fixture_fail_private on dating_1on1_match_proposals');
    assert.equal((await confirm(f,c.body.orderId)).status,200);
    assert.equal(f.provider.calls.filter(x=>x.type==='confirm').length,1);
  }finally{await f.db.close();}
});
test('concurrent duplicate approval is idempotent; another paid order cannot replace the disclosure',async()=>{
  const f=await runtime({privateContact:true});try{
    const c=await create(f);const attempts=await Promise.all([confirm(f,c.body.orderId),confirm(f,c.body.orderId)]);
    assert(attempts.every(a=>a.status===200));
    await f.db.query(`insert into toss_test_payment_orders(user_id,product_type,product_ref_id,product_meta,toss_order_id,order_name,amount,status,payment_key)
      values($1,'one_on_one_contact_exchange',$2,$3,'synthetic-other-paid','synthetic',18000,'paid','synthetic-key')`,[id(2),id(10),{matchId:id(10),payerContact:{mode:'instagram',instagram:'different_handle'}}]);
    const order=(await f.db.query("select id from toss_test_payment_orders where toss_order_id='synthetic-other-paid'")).rows[0];
    const result=await f.admin.rpc('approve_private_contact_exchange',{p_match:id(10),p_user:id(2),p_phones:['+821000000001','+821000000002'],p_contact_hashes:['x','y'],p_legacy_hashes:['a','b'],p_instagram_hash:'z',p_order:order.id});
    assert(result.error);assert.equal((await mine(f,id(2))).body.items[0].counterparty_instagram,choice.instagram);
  }finally{await f.db.close();}
});
test('kill switch preserves existing Instagram privacy, and saved choice is never taken from confirmation body',async()=>{
  const f=await runtime({privateContact:true});try{
    await paid(f);
    const result=await decode(f.routes(id(2),false).mine(new Request('http://127.0.0.1:3161/api/dating/1on1/matches/my')));
    assert.equal(result.status,200);assert.equal(result.body.items[0].counterparty_phone,null);assert.equal(result.body.items[0].counterparty_instagram,choice.instagram);
  }finally{await f.db.close();}
});
test('hashed phone / Instagram blocks deny both chat directions; oversized and cross-origin sends fail',async()=>{
  const f=await runtime({privateContact:true});try{
    await paid(f);
    assert.equal((await chat(f,id(1),{content:'x'.repeat(1001)})).status,400);
    const cross=await f.routes().privateChat.POST(new Request('http://127.0.0.1:3161/api/dating/1on1/private-chat',{method:'POST',headers:{origin:'https://evil.invalid','Content-Type':'application/json'},body:JSON.stringify({matchId:id(10),clientId:id(77),content:'x'})}));assert.equal(cross.status,403);
    const hash=require('node:crypto').createHash('sha256').update('instagram:'+choice.instagram).digest('hex');
    await f.db.query("insert into dating_contact_blocks values($1,'instagram',$2)",[id(2),hash]);
    assert.equal((await chat(f,id(1))).status,409);assert.equal((await chat(f,id(2))).status,409);
    await f.db.exec('delete from dating_contact_blocks');
    const phoneHash=require('node:crypto').createHash('sha256').update('phone:+821000000001').digest('hex');
    await f.db.query("insert into dating_contact_blocks values($1,'phone',$2)",[id(2),phoneHash]);
    assert.equal((await chat(f,id(1))).status,409);assert.equal((await chat(f,id(2))).status,409);
  }finally{await f.db.close();}
});
