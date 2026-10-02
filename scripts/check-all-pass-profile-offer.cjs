/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {test}=require('node:test'),{createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n');
function load(file,mocks={},globals={}) {
 const m={exports:{}},js=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',...Object.keys(globals),js)(name=>Object.hasOwn(mocks,name)?mocks[name]:name.startsWith('@/')?load(name.slice(2)+'.ts',mocks,globals):require(name),m,m.exports,...Object.values(globals));return m.exports;
}
const model=load('lib/all-pass-profile-offer.ts');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now=Date.parse('2026-10-03T00:00:00Z'),iso=ms=>new Date(ms).toISOString();
const quote=(state='active',override={})=>({state,offerId:state==='available'?null:id(1),startsAt:state==='available'?null:iso(now),expiresAt:state==='available'?null:iso(now+86400000),serverNow:iso(now),amount:32000,originalAmount:39900,...override});
const Clock=class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};

test('real price: fixed 32000 KRW, accurately labelled about 20%; deadline remains immutable',()=>{
 assert.equal(model.ALL_PASS_PROFILE_DISCOUNT_PRICE,32000);
 const regular=load('lib/dating-1on1-plus.ts').DATING_ALL_PASS_PRICE_KRW;
 assert.equal(regular,39900);assert.equal(regular-model.ALL_PASS_PROFILE_DISCOUNT_PRICE,7900);
 assert.equal(Math.round((1-model.ALL_PASS_PROFILE_DISCOUNT_PRICE/regular)*1000)/10,19.8);
 assert.equal(model.ALL_PASS_PROFILE_DISCOUNT_LABEL,'약 20% 할인');
 for(const state of ['available','active','expired','used']) assert(model.isAllPassProfileOffer(quote(state)));
 for(const value of [null,{},quote('fake'),quote('active',{amount:1}),quote('active',{expiresAt:iso(now+1)}),quote('active',{serverNow:'invalid'})]) assert.equal(model.isAllPassProfileOffer(value),false);
 assert.equal(model.allPassOfferRemaining(quote(),86400000),0);
 assert.equal(model.allPassOfferRemaining(quote(),86399999),1);
 assert.equal(model.allPassOfferRemaining(quote('expired'),0),0);
 assert.equal(model.allPassOfferTimeLabel(86400000),'24시간 0분');
});

test('PostgreSQL: both profiles/phone, immutable window, one pending order, safe replacement, expiry and private authority',async()=>{
 const db=new PGlite();const q=(sql,args=[])=>db.query(sql,args);
 const rpc=async(name,user,...args)=>(await q(`select ${name}(${[user,...args].map((_,i)=>'$'+(i+1)).join(',')}) as v`,[user,...args])).rows[0].v;
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
   create table profiles(user_id uuid primary key references auth.users(id) on delete cascade,role text default 'user',is_banned boolean default false,phone_verified boolean default true);
   create table dating_cards(id uuid default gen_random_uuid(),owner_user_id uuid references auth.users(id) on delete cascade,status text,instagram_id text);
   create table dating_1on1_cards(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade,status text,created_at timestamptz default now());
   create table dating_1on1_plus_subscriptions(user_id uuid,expires_at timestamptz);
   create table dating_swipe_subscription_requests(user_id uuid,status text,expires_at timestamptz);
   alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  `);
  const def=read('supabase/sql/toss_test_payment_orders.sql').match(/create table if not exists public\.toss_test_payment_orders \([\s\S]*?\n\);/)[0];
  await db.exec(def);await db.exec(read('supabase/sql/dating_plus_paid_plans.sql'));
  const migration=read('supabase/sql/all_pass_profile_offer.sql');await db.exec(migration);await db.exec(migration);
  for(let n=1;n<=12;n++) {
   await q('insert into auth.users(id) values($1)',[id(n)]);await q('insert into profiles(user_id) values($1)',[id(n)]);
   if(n!==2)await q("insert into dating_cards(owner_user_id,status,instagram_id) values($1,'pending','fake_profile')",[id(n)]);
   if(n!==3)await q("insert into dating_1on1_cards(user_id,status) values($1,'submitted')",[id(n)]);
  }
  await q('update profiles set phone_verified=false where user_id=$1',[id(4)]);
  await q('update profiles set is_banned=true where user_id=$1',[id(5)]);
  await q('update auth.users set deleted_at=now() where id=$1',[id(6)]);
  await q("update profiles set role='admin' where user_id=$1",[id(7)]);
  await q("update dating_cards set status='hidden' where owner_user_id=$1",[id(8)]);
  await q("update dating_1on1_cards set status='rejected' where user_id=$1",[id(9)]);
  await q("insert into dating_1on1_plus_subscriptions values($1,now()+interval '30 days')",[id(10)]);
  await q("insert into dating_swipe_subscription_requests values($1,'approved',now()+interval '30 days')",[id(10)]);
  for(let n=2;n<=10;n++)assert.equal(await rpc('start_all_pass_profile_offer',id(n)),null,'excluded '+n);
  assert.equal((await rpc('all_pass_profile_offer_status',id(1))).state,'available');
  assert.equal((await q('select count(*)::int n from all_pass_profile_offers')).rows[0].n,0,'GET never starts timer');
  const first=await rpc('start_all_pass_profile_offer',id(1));assert.equal(first.state,'active');
  assert.equal(Date.parse(first.expiresAt)-Date.parse(first.startsAt),86400000);
  assert.equal((await q('select count(*)::int n from toss_test_payment_orders')).rows[0].n,0,'no automatic purchase');
  const repeat=await rpc('start_all_pass_profile_offer',id(1));assert.equal(repeat.startsAt,first.startsAt);assert.equal(repeat.offerId,first.offerId);
  await assert.rejects(rpc('reserve_all_pass_profile_offer_order',id(2),first.offerId,null),/UNAVAILABLE/);
  const attempts=await Promise.all(Array.from({length:8},()=>rpc('reserve_all_pass_profile_offer_order',id(1),first.offerId,null)));
  assert.equal(new Set(attempts.map(x=>x.id)).size,1,'serial/duplicate attempts reuse one order');
  const order=(await q('select * from toss_test_payment_orders where id=$1',[attempts[0].id])).rows[0];
  assert.equal(order.amount,32000);assert.equal(order.status,'ready');assert.equal(order.product_type,'dating_all_pass_30d');
  for(const [key,value] of Object.entries({durationDays:30,swipeDurationDays:30,swipeDailyLimit:30,contactExchangeIncluded:false,includesOneOnOnePlus:true,includesSwipePremium:true,swipePremiumAmount:30000,discountPercent:19.8,discountAmount:7900}))assert.equal(order.product_meta[key],value,key);
  const replaced=await rpc('reserve_all_pass_profile_offer_order',id(1),first.offerId,order.id);
  assert.notEqual(replaced.id,order.id);assert.equal(replaced.expiresAt,first.expiresAt);
  assert.equal((await q('select status from toss_test_payment_orders where id=$1',[order.id])).rows[0].status,'canceled');
  await assert.rejects(rpc('reserve_all_pass_profile_offer_order',id(1),first.offerId,order.id),/CHANGED/);
  // Later-order write failure cannot consume the offer or leave a canceled retry behind.
  await db.exec("alter table toss_test_payment_orders add constraint reject_test_discount check(amount<>32000) not valid");
  await assert.rejects(rpc('reserve_all_pass_profile_offer_order',id(1),first.offerId,replaced.id),/constraint/);
  assert.equal((await q('select status from toss_test_payment_orders where id=$1',[replaced.id])).rows[0].status,'ready');
  await db.exec('alter table toss_test_payment_orders drop constraint reject_test_discount');
  await q("update toss_test_payment_orders set status='paid' where id=$1",[replaced.id]);
  assert.equal((await rpc('all_pass_profile_offer_status',id(1))).state,'used');
  await assert.rejects(rpc('reserve_all_pass_profile_offer_order',id(1),first.offerId,null),/UNAVAILABLE/);
  await q("update toss_test_payment_orders set status='canceled' where id=$1",[replaced.id]);
  assert.equal((await rpc('all_pass_profile_offer_status',id(1))).state,'used','refund must not advertise a second discount');
  const expiry=await rpc('start_all_pass_profile_offer',id(11));
  await q("update all_pass_profile_offers set starts_at=now()-interval '24 hours',expires_at=now() where user_id=$1",[id(11)]);
  assert.equal((await rpc('start_all_pass_profile_offer',id(11))).state,'expired');
  await assert.rejects(rpc('reserve_all_pass_profile_offer_order',id(11),expiry.offerId,null),/UNAVAILABLE/);
  await db.exec(migration);assert.equal((await rpc('start_all_pass_profile_offer',id(11))).state,'expired');
  for(const role of ['anon','authenticated']) {
   await db.exec('set role '+role);
   for(const sql of ['select * from all_pass_profile_offers',`select start_all_pass_profile_offer('${id(12)}')`,`select all_pass_profile_offer_status('${id(1)}')`,`select reserve_all_pass_profile_offer_order('${id(1)}','${first.offerId}',null)`])await assert.rejects(q(sql),/permission denied/);
   await db.exec('reset role');
  }
  await db.exec('set role service_role');assert.equal((await rpc('all_pass_profile_offer_status',id(12))).state,'available');
  await assert.rejects(q('update all_pass_profile_offers set starts_at=now()'),/permission denied/);
  await db.exec('reset role');
  await q('delete from auth.users where id=$1',[id(1)]);
  assert.equal((await q('select count(*)::int n from all_pass_profile_offers where user_id=$1',[id(1)])).rows[0].n,0,'offer must not block account deletion');
 }finally{await db.close();}
});

function helperFixture(options={}) {
 const calls=[];
 const order={id:id(101),orderId:'a'.repeat(32),amount:32000,orderName:'가상 올패스',expiresAt:iso(now+86400000),reused:false,...options.order};
 const payment={status:'READY',orderId:order.orderId,totalAmount:32000,paymentKey:'fake',checkout:{url:'https://api.tosspayments.com/checkout/fake'},...options.payment};
 const db={rpc(name,args){calls.push({name,args});return {abortSignal:async()=>({data:name==='reserve_all_pass_profile_offer_order'?(args.p_replace_order_id?{...order,id:id(102),orderId:'b'.repeat(32),reused:false}:order):options.status===undefined?quote():options.status,error:options.rpcError||null})};},
  from(table){assert.equal(table,'all_pass_profile_offers');const filters=[];const builder={select(){return builder;},eq(k,v){filters.push([k,v]);return builder;},async maybeSingle(){calls.push({table,filters});return {data:options.noBinding?null:{offer_id:id(1),order_id:id(101),expires_at:options.deadline||iso(now+86400000)},error:null};}};return builder;}};
 const helper=load('lib/all-pass-profile-offer-server.ts',{'@/lib/dating-1on1-plus':{assertOneOnOnePlusSchemaReady:async()=>{calls.push({schema:true});if(options.schemaError)throw Error('schema missing');}},'@/lib/toss-payments':{
  getTossCheckoutOptions:()=>({flowMode:'DEFAULT'}),getTossPayment:async()=>{calls.push({getPayment:true});if(options.readError)throw Error('outage');return payment;},
  getTossPaymentByOrderId:async()=>{calls.push({getOrder:true});if(options.readError)throw Error(options.readError);return payment;},
  createTossPayment:async(params,idem)=>{calls.push({create:params,idem});return {checkout:{url:options.checkoutUrl||'https://api.tosspayments.com/checkout/fake'}};},
 }},{Date:Clock});
 return {helper,db,calls,order,payment,create:()=>helper.createAllPassProfileOfferCheckout(db,{id:id(1),email:'example@example.invalid'},id(1),'https://helchang.com'),confirm:()=>helper.checkAllPassProfileOfferPayment(db,{id:id(101),user_id:id(1),amount:32000,toss_order_id:order.orderId,product_meta:{profileAllPassOfferKey:model.ALL_PASS_PROFILE_OFFER_KEY,profileAllPassOfferId:id(1)},...options.confirmOrder},'fake')};
}
test('fresh checkout has server-owned discount, stable idempotency and unchanged 30-day product',async()=>{
 const f=helperFixture();const result=await f.create();assert.equal(result.amount,32000);
 const call=f.calls.find(c=>c.create);assert.equal(call.create.amount,32000);assert.equal(call.idem.idempotencyKey,'all-pass-profile:'+'a'.repeat(32));
 assert(new URL(call.create.failUrl).searchParams.has('failedOrderId'));assert(!f.calls.some(c=>c.getPayment));
});
for(const state of ['READY','DONE','IN_PROGRESS','WAITING_FOR_DEPOSIT','CANCELED','EXPIRED','ABORTED','UNKNOWN'])test('retry '+state+' never blindly creates another charge',async()=>{
 const f=helperFixture({order:{reused:true},payment:{status:state}});
 if(['IN_PROGRESS','WAITING_FOR_DEPOSIT','CANCELED','UNKNOWN'].includes(state)){await assert.rejects(f.create(),/결제 상태/);assert(!f.calls.some(c=>c.create));return;}
 const result=await f.create();
 if(state==='READY') {assert.equal(result.reusedOrder,true);assert(!f.calls.some(c=>c.create));}
 if(state==='DONE'){assert.equal(new URL(result.checkoutUrl).pathname,'/payments/success');assert(!f.calls.some(c=>c.create));}
 if(['EXPIRED','ABORTED'].includes(state)){assert.equal(f.calls.filter(c=>c.name==='reserve_all_pass_profile_offer_order').length,2);assert.equal(f.calls.filter(c=>c.create).length,1);}
});
test('provider outage/mismatch/redirect injection cannot generate new attempts',async()=>{
 for(const options of [{readError:'network'},{payment:{totalAmount:39900}},{payment:{orderId:'wrong'}},{payment:{checkout:{url:'https://evil.invalid'}}}]) {
  const f=helperFixture({order:{reused:true},...options});await assert.rejects(f.create());assert(!f.calls.some(c=>c.create));
 }
 const missing=helperFixture({order:{reused:true},readError:JSON.stringify({code:'NOT_FOUND_PAYMENT'})});await missing.create();
 assert.equal(missing.calls.find(c=>c.create).create.orderId,'a'.repeat(32),'explicit missing retries SAME order');
});
test('deadline and account/profile changes fail closed; paid provider recovery survives deadline',async()=>{
 let f=helperFixture();assert.equal(await f.confirm(),null);assert(!f.calls.some(c=>c.getPayment));
 for(const options of [{noBinding:true},{status:null},{confirmOrder:{amount:1}},{confirmOrder:{product_meta:{}}}])await assert.rejects(helperFixture(options).confirm());
 f=helperFixture({deadline:iso(now),payment:{status:'READY'}});await assert.rejects(f.confirm(),/24시간/);
 f=helperFixture({deadline:iso(now),payment:{status:'DONE'}});assert.equal((await f.confirm()).status,'DONE');
 for(const options of [{payment:{status:'DONE',totalAmount:1}},{payment:{status:'DONE',paymentKey:'wrong'}},{readError:'outage'}])await assert.rejects(helperFixture({deadline:iso(now-1),...options}).confirm());
});
test('missing SQL shows no offer; invalid server response never promises a discount',async()=>{
 for(const code of ['PGRST202','PGRST205','42883','42P01']) {const f=helperFixture({rpcError:{code}});assert.equal(await f.helper.readAllPassProfileOffer(f.db,id(1)),null);}
 const f=helperFixture({status:quote('active',{amount:1})});await assert.rejects(f.helper.readAllPassProfileOffer(f.db,id(1)));
 const missing=helperFixture({schemaError:true});await assert.rejects(missing.create(),error=>error.code==='PAYMENT_SCHEMA_OUTDATED');
 assert(!missing.calls.some(c=>c.create||c.name==='reserve_all_pass_profile_offer_order'),'entitlement schema check precedes order/charge');
});
test('offer API authenticates, isolates identity, keeps GET read-only and forbids supplied state',async()=>{
 let user={id:id(1)},calls=[];
 const route=load('app/api/dating/all-pass-offer/route.ts',{
  'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
  '@/lib/supabase/request':{getRequestAuthContext:async()=>({user})},'@/lib/supabase/server':{createAdminClient:()=>({})},
  '@/lib/all-pass-profile-offer-server':{readAllPassProfileOffer:async(_admin,uid,start)=>{calls.push({uid,start});return quote();}},
 });
 const req=(method,extra={})=>new Request('https://helchang.com/api/dating/all-pass-offer?userId=other',{method,headers:{host:'helchang.com',origin:'https://helchang.com'},...extra});
 let res=await route.GET(req('GET'));assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');assert.deepEqual(calls.pop(),{uid:id(1),start:false});
 res=await route.POST(req('POST'));assert.equal(res.status,200);assert.deepEqual(calls.pop(),{uid:id(1),start:true});
 for(const body of ['{}','{"amount":1,"expiresAt":"2099-01-01"}'])assert.equal((await route.POST(req('POST',{body}))).status,400);
 assert.equal((await route.POST(req('POST',{headers:{host:'helchang.com',origin:'https://evil.invalid'}}))).status,403);
 user=null;assert.equal((await route.GET(req('GET'))).status,401);assert.equal(calls.length,0);
});

// Protect fulfillment and normal price/phone/photo paths with an exact baseline,
// while the new guarded checkout is exercised independently above.
test('normal fulfillment/confirmation is unchanged outside the explicit offer preflight',()=>{
 const file='app/api/payments/toss/confirm/route.ts';
 // SHA-256 of LF-normalized 955b2f8 source: retain the exact baseline in shallow/no-Git builds.
 const before='87da546f98b7fd3e8972d12b4f1ef5ae93ae0c2f7307c145b7da1929ae10fcd7';
 const stripped=read(file)
  .replace('import { AllPassOfferError, checkAllPassProfileOfferPayment } from "@/lib/all-pass-profile-offer-server";\n','')
  .replace('import { ALL_PASS_PROFILE_DISCOUNT_PRICE } from "@/lib/all-pass-profile-offer";\n','')
  .replace('    const recoveredOfferPayment = order.product_type === "dating_all_pass_30d" && (order.product_meta?.profileAllPassOfferKey || order.amount === ALL_PASS_PROFILE_DISCOUNT_PRICE)\n      ? await checkAllPassProfileOfferPayment(admin, order, paymentKey) : null;\n    const payment = recoveredOfferPayment ?? await confirmOrRecoverTossPayment({ paymentKey, orderId, amount });','    const payment = await confirmOrRecoverTossPayment({ paymentKey, orderId, amount });')
  .replace('    if (error instanceof AllPassOfferError) return json(error.status, { ok: false, code: error.code, message: error.message });\n','');
 assert.equal(createHash('sha256').update(stripped).digest('hex'),before);
});

// Execute the real route bodies, replacing only database/provider boundaries.
function actualFunction(file,name,bindings) {
 const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const declaration=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert(declaration,name);const m={exports:{}};
 const js=ts.transpileModule(declaration.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function('module','exports',...Object.keys(bindings),js+`\nreturn ${name};`)(m,m.exports,...Object.values(bindings));
}
const request=body=>new Request('https://helchang.com/api/payments/toss/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const routeCommon={ensureAllowedMutationOrigin:()=>null,getRequestAuthContext:async()=>({user:{id:id(1)}}),isTossConfigured:()=>true,json:(status,body)=>Response.json(body,{status})};
test('actual create POST: explicit and existing buttons use server price; expired/invalid quotes cannot fall through',async()=>{
 for(const explicit of [true,false]) {
  const f=helperFixture();
  const create=actualFunction('app/api/payments/toss/create/route.ts','POST',{
   ...routeCommon,...f.helper,createAdminClient:()=>f.db,parseProductType:v=>v,
   PRODUCT_CONFIG:{dating_all_pass_30d:{amount:39900}},getBaseUrl:()=> 'https://helchang.com',
  });
  const res=await create(request({productType:'dating_all_pass_30d',amount:1,...explicit?{allPassOfferId:id(1)}:{}}));
  assert.equal(res.status,200,JSON.stringify(await res.clone().json()));assert.equal((await res.json()).amount,32000);
  assert.equal(f.calls.filter(c=>c.create).length,1);assert.equal(f.calls.find(c=>c.create).create.amount,32000);
 }
 for(const body of [{productType:'dating_all_pass_30d',allPassOfferId:id(1)},{productType:'dating_all_pass_30d',allPassOfferId:'fake'},
  {productType:'apply_credits',allPassOfferId:id(1)}]) {
  const f=helperFixture({rpcError:{code:'OFFER_EXPIRED'}});
  const create=actualFunction('app/api/payments/toss/create/route.ts','POST',{
   ...routeCommon,...f.helper,createAdminClient:()=>f.db,parseProductType:v=>v,
   PRODUCT_CONFIG:{dating_all_pass_30d:{amount:39900},apply_credits:{amount:9900}},getBaseUrl:()=> 'https://helchang.com',
  });
  const res=await create(request(body));assert.equal(res.status,body.productType==='apply_credits'?400:409);
  assert(!f.calls.some(c=>c.create),'invalid quote never creates full-price fallback');
 }
});

for(const scenario of ['active','expired-unpaid','expired-paid','missing-marker','wrong-amount','foreign-owner','normal-price'])test('actual confirm POST: '+scenario,async()=>{
 const options=scenario.startsWith('expired')?{deadline:iso(now),payment:{status:scenario==='expired-paid'?'DONE':'READY'}}:{};
 const f=helperFixture(options),events=[];
 const order={id:id(101),user_id:scenario==='foreign-owner'?id(2):id(1),amount:scenario==='normal-price'?39900:32000,toss_order_id:f.order.orderId,
  product_type:'dating_all_pass_30d',status:'ready',product_meta:scenario==='missing-marker'||scenario==='normal-price'?{}:{profileAllPassOfferKey:model.ALL_PASS_PROFILE_OFFER_KEY,profileAllPassOfferId:id(1)}};
 const admin={...f.db,from(table){
  if(table!=='toss_test_payment_orders')return f.db.from(table);
  let patch=null;const filters=[];
  const builder={select(){return builder;},eq(k,v){filters.push([k,v]);return builder;},update(p){patch=p;return builder;},async maybeSingle(){
   if(!filters.every(([k,v])=>order[k]===v))return {data:null,error:null};
   if(patch){events.push('save');Object.assign(order,patch);}return {data:{...order},error:null};
  }};return builder;
 }};
 const confirm=actualFunction('app/api/payments/toss/confirm/route.ts','POST',{
  ...routeCommon,...f.helper,...model,toAmount:Number,createAdminClient:()=>admin,
  confirmOrRecoverTossPayment:async()=>{events.push('charge');return {...f.payment,status:'DONE'};},
  ensureOrderFulfilled:async(_admin,row,userId)=>{events.push('fulfill');assert.equal(row.product_type,'dating_all_pass_30d');assert.equal(userId,id(1));return {};},
 });
 const body={paymentKey:'fake',orderId:f.order.orderId,amount:scenario==='wrong-amount'?1:order.amount};
 let res=await confirm(request(body));
 const expected=['active','expired-paid','normal-price'].includes(scenario)?200:scenario==='wrong-amount'?400:scenario==='foreign-owner'?404:409;
 assert.equal(res.status,expected,JSON.stringify(await res.clone().json()));
 if(expected!==200){assert.deepEqual(events,[]);assert.equal(order.status,'ready');return;}
 assert.equal(order.status,'paid');assert.equal(events.filter(x=>x==='charge').length,scenario==='expired-paid'?0:1);
 assert.equal(events.filter(x=>x==='fulfill').length,1);
 res=await confirm(request(body));assert.equal(res.status,200);assert.equal((await res.json()).alreadyConfirmed,true);
 assert.equal(events.filter(x=>x==='charge').length,scenario==='expired-paid'?0:1,'paid retries never recharge');
});

test('ordinary pending-order cleanup does not cancel a reusable discounted order',async()=>{
 const calls=[],query={};for(const method of ['update','in','is','eq'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
 query.then=resolve=>resolve({error:null});
 const fn=actualFunction('app/api/payments/toss/create/route.ts','cancelReadyOrders',{});
 await fn({from:()=>query},[id(101)]);
 assert(calls.some(c=>c[0]==='is'&&c[1]==='product_meta->>profileAllPassOfferKey'&&c[2]===null));
 assert(calls.some(c=>c[0]==='eq'&&c[1]==='status'&&c[2]==='ready'));
});
