/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), {test} = require('node:test');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const {runtime,id} = require('./fixtures/contact-checkout-runtime.cjs');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const mod = {exports:{}};
new Function('module','exports',ts.transpileModule(read('lib/payment-confirmation-diagnostics.ts'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(mod,mod.exports);
const api=mod.exports;
const create=async f=>(await f.routes().create(f.request({productType:'one_on_one_contact_exchange',matchId:id(10)}))).json();
const confirm=(f,order)=>f.routes().confirm(f.request({paymentKey:'test_'+order.orderId,orderId:order.orderId,amount:order.amount},'/api/payments/toss/confirm'));
const phones=async f=>(await (await f.routes().mine(new Request('http://127.0.0.1:3161/api/dating/1on1/matches/my'))).json()).items;

test('provider diagnostics keep only a normalized code and safe Korean guidance',()=>{
  assert.equal(api.getPaymentConfirmationFailureCode(Error('{"code":"INVALID_UNREGISTERED_SUBMALL","message":"private"}')),'INVALID_UNREGISTERED_SUBMALL');
  for(const error of [Error('email@invalid.local'), Error('{"code":"email@invalid.local"}'),Error('null'),null,{message:'private'}])assert.equal(api.getPaymentConfirmationFailureCode(error),'UNKNOWN');
  assert.equal(api.getPaymentConfirmationFailureCode(new TypeError('Failed to fetch')),'NETWORK_ERROR');
  for(const code of ['INVALID_UNREGISTERED_SUBMALL','PROVIDER_ERROR','NETWORK_ERROR','UNKNOWN']){
    const text=api.getPaymentConfirmationFailureMessage(code);
    assert.match(text,/다시 결제하지 말고/);assert.match(text,/결제센터/);assert.doesNotMatch(text,/\uFFFD|현대|국민|우리카드/);
  }
});

test('actual unresolved merchant approval is recorded once; it cannot charge again or reveal numbers',async()=>{
  const f=await runtime();try{
    const order=await create(f);f.provider.flags.failure=true;f.provider.flags.providerCode='INVALID_UNREGISTERED_SUBMALL';
    for(let i=0;i<2;i++){
      const response=await confirm(f,order),body=await response.json();
      assert.equal(response.status,502);assert.equal(body.providerCode,'INVALID_UNREGISTERED_SUBMALL');
      assert.match(body.message,/가맹점 설정/);assert.doesNotMatch(JSON.stringify(body),/private|paymentKey/);
    }
    const events=(await f.db.query('select * from payment_confirmation_failures')).rows;
    assert.equal(events.length,1);assert.equal(events[0].provider_code,'INVALID_UNREGISTERED_SUBMALL');
    assert.deepEqual(Object.keys(events[0]).sort(),['created_at','order_id','product_type','provider_code']);
    assert.equal((await f.db.query('select status from toss_test_payment_orders')).rows[0].status,'ready');
    assert.equal((await phones(f))[0].counterparty_phone,null);
    f.provider.flags.failure=false;
    assert.equal((await confirm(f,order)).status,200);assert.equal((await phones(f))[0].counterparty_phone,'01000000002');
    assert.equal((await f.db.query('select count(*)::int n from toss_test_payment_orders')).rows[0].n,1);
    // An old diagnostic does not override a later successful payment.
    assert.equal((await f.db.query("select count(*)::int n from payment_confirmation_failures f join toss_test_payment_orders o on o.id=f.order_id where o.status='paid'")).rows[0].n,1);
  }finally{await f.db.close();}
});
test('lost approval response recovers DONE; no false failure diagnostic',async()=>{
  const f=await runtime();try{
    const order=await create(f);f.provider.flags.confirmAfterApprovedError=true;
    assert.equal((await confirm(f,order)).status,200);
    assert.equal((await f.db.query('select count(*)::int n from payment_confirmation_failures')).rows[0].n,0);
    assert.equal((await phones(f))[0].counterparty_phone,'01000000002');
  }finally{await f.db.close();}
});
test('missing diagnostics table does not break recovery or make an uncertain payment successful',async()=>{
  const f=await runtime();try{
    await f.db.exec('drop table payment_confirmation_failures');
    const order=await create(f);f.provider.flags.failure=true;
    assert.equal((await confirm(f,order)).status,502);assert.equal((await phones(f))[0].counterparty_phone,null);
    f.provider.flags.failure=false;
    assert.equal((await confirm(f,order)).status,200);assert.equal((await phones(f))[0].counterparty_phone,'01000000002');
  }finally{await f.db.close();}
});
test('migration is repeatable and private; no existing payment/match content changes',async()=>{
  const f=await runtime();try{
    await create(f);
    const before=(await f.db.query('select * from toss_test_payment_orders')).rows;
    const pairs=(await f.db.query('select * from dating_1on1_match_proposals')).rows;
    await f.db.exec(read('supabase/sql/payment_confirmation_failures.sql'));
    assert.deepEqual((await f.db.query('select * from toss_test_payment_orders')).rows,before);
    assert.deepEqual((await f.db.query('select * from dating_1on1_match_proposals')).rows,pairs);
    for(const role of ['anon','authenticated'])for(const action of ['SELECT','INSERT','UPDATE','DELETE']){
      assert.equal((await f.db.query("select has_table_privilege($1,'payment_confirmation_failures',$2) allowed",[role,action])).rows[0].allowed,false);
    }
    assert.equal((await f.db.query("select has_table_privilege('service_role','payment_confirmation_failures','INSERT') allowed")).rows[0].allowed,true);
    assert.equal((await f.db.query("select relrowsecurity enabled from pg_class where oid='payment_confirmation_failures'::regclass")).rows[0].enabled,true);
  }finally{await f.db.close();}
});
