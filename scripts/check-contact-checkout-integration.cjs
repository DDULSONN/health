/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),{test}=require('node:test');
const {runtime,id}=require('./fixtures/contact-checkout-runtime.cjs');
const input={productType:'one_on_one_contact_exchange',matchId:id(10)};
const json=async response=>({status:response.status,body:await response.json()});
async function create(f,extra={}) {return json(await f.routes().create(f.request({...input,...extra})));}
async function approve(f,orderId,amount=18000,user=id(1)) {
  return json(await f.routes(user).confirm(f.request({paymentKey:'test_'+orderId,orderId,amount},'/api/payments/toss/confirm')));
}
async function phones(f,user=id(1)) {
  const res=await f.routes(user).mine(new Request('http://127.0.0.1:3161/api/dating/1on1/matches/my'));
  assert.equal(res.status,200);return (await res.json()).items;
}
test('18000 actual create → provider → confirm → PostgreSQL → both participants phone disclosure; reload is idempotent',async()=>{
  const f=await runtime();try{
    assert.equal((await phones(f))[0].counterparty_phone,null);
    const c=await create(f,{amount:1});assert.equal(c.status,200,JSON.stringify(c));assert.equal(c.body.amount,18000);
    assert.equal(f.provider.calls.filter(v=>v.type==='create')[0].amount,18000);
    const stored=(await f.db.query('select * from toss_test_payment_orders')).rows;assert.equal(stored.length,1);assert.equal(stored[0].amount,18000);
    assert.equal((await phones(f))[0].counterparty_phone,null);
    const a=await approve(f,c.body.orderId);assert.equal(a.status,200,JSON.stringify(a));assert.equal(a.body.matchId,id(10));
    assert.equal((await phones(f))[0].counterparty_phone,'01000000002');
    assert.equal((await phones(f,id(2)))[0].counterparty_phone,'01000000001');
    assert.equal((await phones(f,id(3))).length,0);
    const stamp=(await f.db.query('select contact_exchange_paid_at from dating_1on1_match_proposals')).rows[0].contact_exchange_paid_at;
    for(let i=0;i<3;i++){const again=await approve(f,c.body.orderId);assert.equal(again.status,200);assert.equal(again.body.alreadyConfirmed,true);}
    assert.equal(f.provider.calls.filter(v=>v.type==='confirm').length,1);
    assert.equal((await f.db.query('select contact_exchange_paid_at from dating_1on1_match_proposals')).rows[0].contact_exchange_paid_at.toISOString(),stamp.toISOString());
    assert.equal((await create(f)).body.code,'ALREADY_APPROVED');
    assert.equal((await f.db.query('select count(*)::int n from toss_test_payment_orders')).rows[0].n,1);
  }finally{await f.db.close();}
});
test('old 20000 READY checkout reopens unchanged and can still confirm after price decrease',async()=>{
  const f=await runtime();try{
    const c=await create(f);const orderId=c.body.orderId;
    await f.db.query('update toss_test_payment_orders set amount=20000 where toss_order_id=$1',[orderId]);
    f.provider.payments.get(orderId).totalAmount=20000;
    const retry=await create(f,{recoveryOrderId:orderId});assert.equal(retry.status,200);assert.equal(retry.body.amount,20000);assert.equal(retry.body.reusedOrder,true);
    assert.equal(f.provider.calls.filter(v=>v.type==='create').length,1);
    assert.equal((await approve(f,orderId,18000)).body.code,'AMOUNT_MISMATCH');
    assert.equal((await approve(f,orderId,20000)).status,200);
    assert.equal((await phones(f))[0].counterparty_phone,'01000000002');
  }finally{await f.db.close();}
});
test('wrong amount, stranger and unauthenticated requests never invoke provider approval or expose phone',async()=>{
  const f=await runtime();try{
    const c=await create(f);
    for(const amount of [0,1,15000,20000,18000.5,-18000])assert.equal((await approve(f,c.body.orderId,amount)).body.code,'AMOUNT_MISMATCH');
    assert.equal((await approve(f,c.body.orderId,18000,id(3))).status,404);
    assert.equal((await approve(f,c.body.orderId,18000,null)).status,401);
    assert.equal(f.provider.calls.filter(v=>v.type==='confirm').length,0);
    assert.equal((await phones(f))[0].counterparty_phone,null);
  }finally{await f.db.close();}
});
test('provider approved but connection dropped: server lookup recovers without a second payment',async()=>{
  const f=await runtime();try{
    const c=await create(f);f.provider.flags.confirmAfterApprovedError=true;
    assert.equal((await approve(f,c.body.orderId)).status,200);
    assert.equal(f.provider.calls.filter(v=>v.type==='create').length,1);
    assert.equal(f.provider.calls.filter(v=>v.type==='get').length,1);
    assert.equal((await phones(f))[0].counterparty_phone,'01000000002');
  }finally{await f.db.close();}
});
for(const stage of ['failPaidWriteOnce','failFulfillmentOnce'])test(`retry repairs ${stage} after provider approval, preserving the same order`,async()=>{
  const f=await runtime();try{
    const c=await create(f);f.flags[stage]=true;
    assert.equal((await approve(f,c.body.orderId)).status,500);
    assert.equal((await phones(f))[0].counterparty_phone,null);
    const recovery=await f.routes().recovery(c.body.orderId);assert.equal(recovery.view.state,'paid');assert.equal(recovery.checkoutUrl,null);
    assert.equal((await approve(f,c.body.orderId)).status,200);
    assert.equal((await phones(f))[0].counterparty_phone,'01000000002');
    assert.equal(f.provider.calls.filter(v=>v.type==='create').length,1);
  }finally{await f.db.close();}
});
test('concurrent duplicate confirmations produce one paid order and one approved exchange',async()=>{
  const f=await runtime();try{
    const c=await create(f);const results=await Promise.all([approve(f,c.body.orderId),approve(f,c.body.orderId)]);
    assert(results.every(r=>r.status===200),JSON.stringify(results));
    assert.equal((await f.db.query("select count(*)::int n from toss_test_payment_orders where status='paid'")).rows[0].n,1);
    assert.equal((await f.db.query("select count(*)::int n from dating_1on1_match_proposals where contact_exchange_status='approved'")).rows[0].n,1);
  }finally{await f.db.close();}
});
test('failed checkout never reveals numbers; recovery reuses READY and approved numbers disappear after blocking',async()=>{
  const f=await runtime();try{
    const c=await create(f);f.provider.flags.failure=true;
    assert.equal((await approve(f,c.body.orderId)).status,500);assert.equal((await phones(f))[0].counterparty_phone,null);
    f.provider.flags.failure=false;
    const retry=await create(f,{recoveryOrderId:c.body.orderId});assert.equal(retry.body.reusedOrder,true);
    assert.equal((await approve(f,c.body.orderId)).status,200);f.flags.blocked=true;
    assert.equal((await phones(f)).length,0);assert.equal((await phones(f,id(2))).length,0);
  }finally{await f.db.close();}
});
test('rejected/canceled matches and invalid age cannot start a checkout; cross-origin mutation is denied',async()=>{
  const f=await runtime();try{
    for(const [state,status,code]of [['candidate_rejected','none','MATCH_NOT_READY'],['mutual_accepted','canceled','MATCH_CANCELED']]){
      await f.db.query('update dating_1on1_match_proposals set state=$1,contact_exchange_status=$2',[state,status]);
      assert.equal((await create(f)).body.code,code);
    }
    await f.db.query("update dating_1on1_match_proposals set state='mutual_accepted',contact_exchange_status='awaiting_applicant_payment'");
    await f.db.query('update dating_1on1_cards set birth_year=null where id=$1',[id(21)]);
    assert.equal((await create(f)).body.code,'DATING_AGE_INELIGIBLE');
    const cross=new Request('http://127.0.0.1:3161/api/payments/toss/create',{method:'POST',headers:{host:'127.0.0.1:3161',origin:'https://foreign.invalid'},body:JSON.stringify(input)});
    assert.equal((await f.routes().create(cross)).status,403);
    assert.equal(f.provider.calls.length,0);
  }finally{await f.db.close();}
});
test('expired legacy 20000 attempt creates a new 18000 order without rewriting the historical amount',async()=>{
  const f=await runtime();try{
    const c=await create(f);await f.db.query('update toss_test_payment_orders set amount=20000 where toss_order_id=$1',[c.body.orderId]);
    Object.assign(f.provider.payments.get(c.body.orderId),{totalAmount:20000,status:'EXPIRED'});
    const next=await create(f,{recoveryOrderId:c.body.orderId});assert.equal(next.status,200);assert.equal(next.body.amount,18000);assert.notEqual(next.body.orderId,c.body.orderId);
    const old=(await f.db.query('select amount,status from toss_test_payment_orders where toss_order_id=$1',[c.body.orderId])).rows[0];
    assert.equal(old.amount,20000);assert.equal(old.status,'canceled');
    assert.equal((await approve(f,next.body.orderId)).status,200);
  }finally{await f.db.close();}
});
