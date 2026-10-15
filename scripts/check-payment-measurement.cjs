/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),{test}=require('node:test'),{execFileSync}=require('node:child_process');
const {read,load,user,other,match,order,body,req,database}=require('./fixtures/payment-measurement-runtime.cjs');

test('real route -> PostgreSQL: one view/click per member, match, session and placement; no payment/match mutations',async()=>{
  const f=await database();try{
    const before=await f.db.query('select * from toss_test_payment_orders');
    for(const eventName of ['view_item','select_item']) for(let n=0;n<3;n++) assert.equal((await f.contact.POST(req(body({eventName})))).status,200);
    assert.equal((await f.db.query('select count(*)::int n from payment_funnel_events')).rows[0].n,2);
    f.auth.user={id:other};assert.equal((await f.contact.POST(req(body()))).status,200);
    assert.equal((await f.db.query('select count(*)::int n from payment_funnel_events')).rows[0].n,3);
    assert.deepEqual((await f.db.query('select * from toss_test_payment_orders')).rows,before.rows);
    assert.equal((await f.db.query('select contact_exchange_status from dating_1on1_match_proposals')).rows[0].contact_exchange_status,'awaiting_applicant_payment');
    const row=(await f.db.query('select * from payment_funnel_events limit 1')).rows[0];
    assert.equal(row.product_type,'one_on_one_contact_exchange');assert.equal(row.item_name,'1:1 연락처 교환');
    assert.equal(row.match_id,match);assert.equal(row.amount,20000);
  }finally{await f.db.close();}
});
test('API rejects invalid input and foreign/closed matches without disclosing them; schema failure is NOT acknowledged',async()=>{
  const f=await database();try{
    for(const extra of [{matchId:'nope'},{eventName:'purchase'},{amount:0},{amount:'20000'},{placement:'email@example.com'},{sessionId:'private@example.com'}])assert.equal((await f.contact.POST(req(body(extra)))).status,400);
    assert.equal((await f.contact.POST(req({padding:'x'.repeat(513)}))).status,400);
    f.auth.user=null;assert.equal((await f.contact.POST(req(body()))).status,204);
    f.auth.user={id:'00000000-0000-4000-8000-000000000009'};assert.equal((await f.contact.POST(req(body()))).status,204);
    f.auth.user={id:user};
    for(const status of ['approved','payment_pending_admin','canceled']){await f.db.query('update dating_1on1_match_proposals set contact_exchange_status=$1',[status]);assert.equal((await f.contact.POST(req(body()))).status,204);}
    await f.db.exec("update dating_1on1_match_proposals set contact_exchange_status='none'");
    const res=await f.contact.POST(req(body({userId:other,phone:'DO_NOT_STORE',name:'DO_NOT_STORE',paymentKey:'DO_NOT_STORE'})));
    assert.equal(res.status,200);assert.deepEqual(await res.json(),{recorded:true});
    assert(!JSON.stringify((await f.db.query('select * from payment_funnel_events')).rows).includes('DO_NOT_STORE'));
    await f.db.exec('alter table payment_funnel_events rename column match_id to not_installed');
    assert.equal((await f.contact.POST(req(body()))).status,503);
  }finally{await f.db.close();}
});
test('failure route records explicit acknowledgement, dedupes callbacks, keeps paid state, and detects missing schema',async()=>{
  const f=await database();try{
    const request=code=>req({orderId:'measurement_test_order',code},'/api/payments/toss/failure');
    for(let n=0;n<2;n++){const r=await f.failure.POST(request('PAY_PROCESS_CANCELED'));assert.equal(r.status,200);assert.equal((await r.json()).recorded,true);}
    const rows=(await f.db.query('select * from payment_checkout_failures')).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].outcome,'user_canceled');assert.equal(rows[0].user_id,user);
    assert.equal((await f.db.query('select status from toss_test_payment_orders where id=$1',[order])).rows[0].status,'paid');
    await f.db.exec('alter table payment_checkout_failures rename to temporarily_missing');
    assert.equal((await f.failure.POST(request('REJECT_CARD_COMPANY'))).status,503);
  }finally{await f.db.close();}
});
test('SQL applies twice, preserves legacy events and restricts diagnostic data to existing authorized access',async()=>{
  const f=await database();try{
    await f.db.exec(read('supabase/sql/contact_exchange_funnel.sql'));await f.db.exec(read('supabase/sql/payment_checkout_failures.sql'));
    await f.db.query("insert into payment_funnel_events(user_id,event_name,product_type,amount) values($1,'view_item','city_view',5000),($1,'view_item','city_view',5000)",[user]);
    assert.equal((await f.db.query('select count(*)::int n from payment_funnel_events')).rows[0].n,2);
    for(const role of ['anon','authenticated']){
      assert.equal((await f.db.query("select has_table_privilege($1,'payment_checkout_failures','SELECT') allowed",[role])).rows[0].allowed,false);
      await f.db.exec('set role '+role);await assert.rejects(f.db.query('select * from payment_checkout_failures'),/permission denied/);await f.db.exec('reset role');
    }
    assert.equal((await f.db.query("select has_table_privilege('service_role','payment_funnel_events','INSERT') allowed")).rows[0].allowed,true);
    assert.equal((await f.db.query("select relrowsecurity rls from pg_class where oid='payment_funnel_events'::regclass")).rows[0].rls,true);
  }finally{await f.db.close();}
});

function clientFixture({status=200,recorded=true,throwFetch=false,brokenStorage=false}={}){
  const values=new Map(),calls=[];
  const window={location:{pathname:'/mypage'},sessionStorage:{getItem(k){if(brokenStorage)throw Error('private');return values.get(k);},setItem(k,v){if(brokenStorage)throw Error('private');values.set(k,v);}}};
  const fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});if(throwFetch)throw Error('offline');return status===204?new Response(null,{status}):Response.json({recorded},{status});};
  return {values,calls,window,contact:load('lib/contact-payment-analytics.ts',{}, {window,fetch}),failure:load('lib/payment-failure-client.ts',{}, {window,fetch})};
}
test('telemetry never rejects, never transmits identity text, and never acknowledges skipped/missing storage',async()=>{
  for(const options of [{},{status:204},{status:503},{recorded:false},{throwFetch:true},{brokenStorage:true}]){
    const f=clientFixture(options);const result=await f.contact.recordContactPaymentEvent('select_item',match,20000);
    assert.equal(result,!options.throwFetch&&![204,503].includes(options.status)&&options.recorded!==false);
    assert.deepEqual(Object.keys(f.calls[0].body).sort(),['amount','eventName','matchId','placement','sessionId']);
    await assert.doesNotReject(f.failure.reportPaymentFailure('measurement_test_order','REJECT_CARD_COMPANY'));
  }
});
test('failure client retries later after 204/503; old false-positive v1 marker cannot suppress a real record',async()=>{
  for(const status of [204,503]){const f=clientFixture({status});await f.failure.reportPaymentFailure('measurement_test_order','X');await f.failure.reportPaymentFailure('measurement_test_order','X');assert.equal(f.calls.length,2);}
  const f=clientFixture();f.values.set('gymtools-payment-failure:measurement_test_order','1');
  await Promise.all([f.failure.reportPaymentFailure('measurement_test_order','X'),f.failure.reportPaymentFailure('measurement_test_order','X')]);
  await f.failure.reportPaymentFailure('measurement_test_order','X');assert.equal(f.calls.length,1);
});
test('cross-origin telemetry is denied before auth/database; auth failure remains diagnostic-only',async()=>{
  const mocks={'@/lib/request-origin':{ensureAllowedMutationOrigin:()=>new Response(null,{status:403})},'@/lib/supabase/request':{getRequestAuthContext:()=>{throw Error('unavailable');}}};
  assert.equal((await load('app/api/analytics/contact-exchange/route.ts',mocks).POST(req(body()))).status,403);
  mocks['@/lib/request-origin'].ensureAllowedMutationOrigin=()=>null;
  assert.equal((await load('app/api/analytics/contact-exchange/route.ts',mocks).POST(req(body()))).status,503);
});
test('payment creation, confirmation, recovery, number disclosure and OTP implementation remain unchanged from HEAD',()=>{
  for(const file of ['app/api/payments/toss/create/route.ts','app/api/payments/toss/confirm/route.ts','lib/contact-payment-recovery.ts','app/api/dating/1on1/matches/[id]/contact-exchange/route.ts','app/api/mypage/phone-verification/verify/route.ts']){
    const baseline=execFileSync('git',['show','HEAD:'+file],{encoding:'utf8'});assert.equal(read(file).replace(/\r\n/g,'\n'),baseline.replace(/\r\n/g,'\n'),file);
  }
});
