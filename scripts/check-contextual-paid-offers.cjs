/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const mod={exports:{}};new Function('exports',ts.transpileModule(read('lib/contextual-paid-offers.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod.exports);
const {readApplyCreditBalance,readApplyCreditStatus,readNearbyPurchaseCount}=mod.exports;
for(const [name,value,want] of [
 ['zero verified balance',{loggedIn:true,baseRemaining:0,creditsRemaining:0},0],
 ['free allowance remains',{loggedIn:true,baseRemaining:2,creditsRemaining:0},2],
 ['paid credits remain',{loggedIn:true,baseRemaining:0,creditsRemaining:3},3],
 ['both remain',{loggedIn:true,baseRemaining:2,creditsRemaining:3},5],
 ['pass only',{loggedIn:true,baseRemaining:0,creditsRemaining:0,passCreditsRemaining:6},6],
 ['all three remain',{loggedIn:true,baseRemaining:2,creditsRemaining:3,passCreditsRemaining:6},11],
 ['no active pass',{loggedIn:true,baseRemaining:2,creditsRemaining:3,passCreditsRemaining:null},5],
 ['invalid pass balance not reported as shortage',{loggedIn:true,baseRemaining:0,creditsRemaining:0,passCreditsRemaining:'0'},null],
 ['overflow including pass',{loggedIn:true,baseRemaining:Number.MAX_SAFE_INTEGER,creditsRemaining:0,passCreditsRemaining:1},null],
 ['guest zero is not shortage',{loggedIn:false,baseRemaining:0,creditsRemaining:0},null],
 ['unknown user',{baseRemaining:0,creditsRemaining:0},null],
 ['server error',{ok:false,loggedIn:true,baseRemaining:0,creditsRemaining:0},null],
 ['missing field',{loggedIn:true,baseRemaining:0},null],
 ['numeric string',{loggedIn:true,baseRemaining:'0',creditsRemaining:0},null],
 ['negative',{loggedIn:true,baseRemaining:-1,creditsRemaining:0},null],
 ['fraction',{loggedIn:true,baseRemaining:0.5,creditsRemaining:0},null],
 ['overflow',{loggedIn:true,baseRemaining:Number.MAX_SAFE_INTEGER,creditsRemaining:1},null],
 ['null',null,null],
])test(name,()=>assert.equal(readApplyCreditBalance(value),want));
test('an active pass with zero remaining is distinct from no active pass',()=>{
 const base={loggedIn:true,baseRemaining:0,creditsRemaining:2};
 assert.deepEqual(readApplyCreditStatus({...base,passCreditsRemaining:0}),{baseRemaining:0,creditsRemaining:2,passCreditsRemaining:0,total:2});
 assert.equal(readApplyCreditStatus(base).passCreditsRemaining,null);
});

function loadRoute(file,lookup){
 const m={exports:{}};
 const compile=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require','console',compile)(m.exports,name=>name.startsWith('@/')?lookup[name]??{}:require(name),{...console,error(){}});
 return m.exports;
}
test('credit status includes just the authenticated member’s active Pass allowance',async()=>{
 let loggedIn=true,pass={creditsRemaining:6};const ids=[];
 const fakeDb={from(table){const q={select:()=>q,eq:(key,val)=>{if(key==='user_id')assert.equal(val,'member');return q;},maybeSingle:async()=>({data:table==='user_daily_apply_usage'?{base_used:1}:{credits:4}})};return q;}};
 const route=loadRoute('app/api/dating/apply-credits/status/route.ts',{
  '@/lib/dating-apply-limits':{getDailyBaseApplyLimit:()=>2,getKstDateString:()=> '2026-11-23',isKoreanWeekend:()=>false},
  '@/lib/supabase/request':{getRequestAuthContext:async()=>({client:fakeDb,user:loggedIn?{id:'member'}:null})},
  '@/lib/supabase/server':{createAdminClient:()=>fakeDb},
  '@/lib/dating-love-pass-access':{getLovePassStatus:async(admin,id)=>{assert.equal(admin,fakeDb);ids.push(id);return pass;}},
 });
 const req=new Request('https://fixture.test/api/dating/apply-credits/status?userId=other');
 for(const p of [pass,{creditsRemaining:0},null]){
  pass=p;const response=await route.GET(req);assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.baseRemaining,1);assert.equal(body.creditsRemaining,4);assert.equal(body.passCreditsRemaining,p?.creditsRemaining??null);
 }
 loggedIn=false;assert.equal((await (await route.GET(req)).json()).passCreditsRemaining,null);
 assert.deepEqual(ids,['member','member','member']);
});
test('only new standalone quick-match orders are blocked by an active Pass, including zero likes',async()=>{
 let pass=null,failStatus=false,legacyStatus='none';const orders=[],provider=[],manual=[],reads=[];
 const fakeDb={from(table){let inserted=false;const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,
  maybeSingle:async()=>({data:{id:'1on1-card'}}),single:async()=>({data:{id:'inserted-id'}}),
  insert:value=>{inserted=true;(table==='dating_swipe_subscription_requests'?manual:orders).push(value);return q;},
  then:resolve=>resolve({data:inserted?{id:'inserted-id'}:[],error:null}),
 };return q;}};
 const deps={
  '@/lib/supabase/server':{createAdminClient:()=>fakeDb},
  '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:{id:'member'}})},
  '@/lib/dating-1on1-plus':{getActiveOneOnOnePlus:async()=>null,assertOneOnOnePlusSchemaReady:async()=>{},DATING_ALL_PASS_PRICE_KRW:39000,DATING_ALL_PASS_DURATION_DAYS:30},
  '@/lib/dating-swipe':{SWIPE_PREMIUM_PRICE_KRW:30000,SWIPE_PREMIUM_DAILY_LIMIT:30,SWIPE_PREMIUM_DURATION_DAYS:30,
   getLatestSwipeCardForUser:async()=>({id:'swipe-card'}),getLovePassSwipeStatus:async(admin,user)=>{assert.equal(admin,fakeDb);reads.push(user);if(failStatus)throw Error('unavailable');return pass;},
   getSwipeLimitInfo:async()=>({limit:5,baseLimit:5,premiumLimit:30,premiumDurationDays:30,premiumPriceKrw:30000,
    activeSubscription:legacyStatus==='active'?{id:'old-active'}:null,pendingSubscription:legacyStatus==='pending'?{id:'old-pending'}:null}),
  },
  '@/lib/toss-payments':{isTossConfigured:()=>true,getTossCheckoutMode:()=> 'test',getTossCheckoutOptions:()=>({}),
   createTossPayment:async body=>{provider.push(body);return {checkout:{url:'https://checkout.test/order'}};}},
  '@/lib/request-origin':{ensureAllowedMutationOrigin:()=>null},
  '@/lib/contact-intro-offer-server':{ContactIntroError:class extends Error{}},
  '@/lib/all-pass-profile-offer-server':{AllPassOfferError:class extends Error{},readAllPassProfileOffer:async()=>null},
 };
 const create=loadRoute('app/api/payments/toss/create/route.ts',deps).POST;
 const sub=loadRoute('app/api/dating/cards/swipe/subscription/route.ts',deps);
 const req=(productType='swipe_premium_30d')=>new Request('https://fixture.test/api/payments/toss/create',{method:'POST',body:JSON.stringify({productType})});
 for(const remaining of [50,0]){
  pass={remaining};const response=await create(req());assert.equal(response.status,409);
  assert.equal((await response.json()).code,'SWIPE_ALREADY_INCLUDED_IN_LOVE_PASS');
  assert.equal((await sub.POST(req())).status,409);
  assert.equal((await (await sub.GET(req())).json()).lovePassActive,true);
 }
 assert.deepEqual([orders.length,provider.length,manual.length],[0,0,0]);
 failStatus=true;assert.equal((await create(req())).status,503);assert.deepEqual([orders.length,provider.length],[0,0]);failStatus=false;
 for(const status of ['active','pending']){legacyStatus=status;const response=await sub.POST(req());assert.equal(response.status,200);assert.equal((await response.json()).status,status);}
 legacyStatus='none';
 assert.equal((await create(req('dating_all_pass_30d'))).status,200);assert.equal(orders.at(-1).product_meta.includesOneOnOnePlus,true);
 const paid=provider.length;pass=null;
 assert.equal((await create(req())).status,200);assert.equal(provider.length,paid+1);assert.equal(provider.at(-1).amount,30000);
 assert.equal((await sub.POST(req())).status,200);assert.equal(manual.length,1);assert.equal((await (await sub.GET(req())).json()).lovePassActive,false);
 assert.ok(reads.every(id=>id==='member'));
});
for(const count of [null,undefined,'3',-1,31,Infinity,NaN,2.5])test('invalid nearby count '+String(count),()=>assert.equal(readNearbyPurchaseCount({newCount:count}),null));
for(const count of [0,1,10,30])test('confirmed nearby count '+count,()=>assert.equal(readNearbyPurchaseCount({newCount:count}),count));
test('nearby repeat purchase remains server-gated and non-automatic',()=>{
 const page=read('app/dating/nearby-view/page.tsx');
 assert.match(page,/status\.loggedIn && purchasePreview\?\.province === selectedProvince/);
 assert.match(page,/purchasePreview\.newCount > 0/);
 assert.match(page,/onClick=\{\(\) => void requestCheckout\(selectedProvince, true\)\}/);
 assert.doesNotMatch(page,/requestCheckout\(stat\.province, true\)/);
 assert.match(page,/productType: "city_view", province, targetSex, requireNewCandidates/);
});
test('home offers only mount for selected open-card tab and authenticated verified identity',()=>{
 const page=read('app/community/dating/cards/page.tsx');
 assert.match(page,/showOpenCardSection \? <OpenCardExtras userId=\{viewerSessionReady && viewerLoggedIn && viewerPhoneVerified && !viewerSessionError \? draftUserId : null\}/);
 const extra=read('components/dating/OpenCardExtras.tsx');
 assert.match(extra,/remaining === 0/); assert.match(extra,/balance\?\.userId === userId/);
 assert.match(extra,/!live \|\| version !== generation/); assert.match(extra,/controller\?\.abort/);
 assert.doesNotMatch(extra,/setInterval|payments\/toss\/create/);
});
test('show the free reset on shortage before offering a pack only on the actual application',()=>{
 const home=read('components/dating/OpenCardExtras.tsx'), apply=read('app/community/dating/cards/[id]/apply/page.tsx');
 assert.doesNotMatch(home,/CompactPaidOffer|open_card_credits_empty|5장 충전/);
 assert.ok(home.includes('매일 밤 12시(한국 시간)'));
 const gate=apply.indexOf('{errorCode === "DAILY_APPLY_LIMIT"'), free=apply.indexOf('매일 밤 12시',gate), pack=apply.indexOf('placement="open_card_apply_empty"');
 assert.ok(gate>=0 && gate<free && free<pack);
});
test('waiting status uses a real rank only and never invents a position or deadline',()=>{
 const m={};new Function('exports',ts.transpileModule(read('lib/open-card-wait-description.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m);
 for(const rank of [undefined,null,0,-1,1.5,NaN]) assert.equal(m.openCardWaitDescription(rank),'순서가 되면 무료로 공개돼요.');
 assert.equal(m.openCardWaitDescription(1123),'대기 1123번째예요. 순서가 되면 무료로 공개돼요.');
});
test('rank is scoped to the card and same-sex waiting queue; read failures never invent a rank',async()=>{
 const m={};new Function('exports',ts.transpileModule(read('lib/open-card-queue-position.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m);
 const priority='2026-11-04T10:00:00+00:00',time='2026-11-05T10:00:00+00:00',id='00000000-0000-4000-8000-000000000005';
 for(const [anchor,count,error,want] of [[{data:{queue_priority_at:priority,created_at:time}},1123,null,1123],[{error:{code:'42703'}},7,null,7],[{data:null},5,null,null],[{error:{code:'XX000'}},5,null,null],[{data:{queue_priority_at:priority,created_at:time}},null,'unavailable',null]]){
   const calls=[];const db={from(table){assert.equal(table,'dating_cards');const filters=[],q={select(columns,opts){calls.push({columns,opts,filters});return q},eq(k,v){filters.push([k,v]);return q},maybeSingle(){return Promise.resolve(anchor)},or(v){filters.push(['or',v]);return Promise.resolve({count,error})}};return q;}};
   assert.equal(await m.getPendingQueuePosition(db,'female',time,id),want);
   assert.deepEqual(calls[0].filters,[['id',id],['sex','female'],['status','pending']]);
   if(calls[1]){
     const expected='and(created_at.eq.'+time+',id.lte.'+id+')';
     const order=anchor.data?'queue_priority_at.lt.'+priority+',and(queue_priority_at.eq.'+priority+',or(created_at.lt.'+time+','+expected+'))':'created_at.lt.'+time+','+expected;
     assert.deepEqual(calls[1].opts,{head:true,count:'exact'});assert.deepEqual(calls[1].filters,[['sex','female'],['status','pending'],['or',order]]);
   }else assert.equal(want,null);
 }
});
test('view tracking requires real visibility; unavailable analytics cannot stop a purchase',()=>{
 const hook=read('lib/use-paid-offer-tracking.ts');
 assert.match(hook,/intersectionRatio >= 0\.5/); assert.match(hook,/750/);
 assert.match(hook,/document\.visibilityState !== "visible"/); assert.match(hook,/catch/);
 const offer=read('components/dating/CompactPaidOffer.tsx');
 assert.match(offer,/!action\.hasAttribute\("disabled"\)/); assert.match(offer,/aria-disabled/);
 assert.doesNotMatch(offer,/preventDefault|stopPropagation|payments\/toss/);
});
