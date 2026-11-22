/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const mod={exports:{}};new Function('exports',ts.transpileModule(read('lib/contextual-paid-offers.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod.exports);
const {readApplyCreditBalance,readNearbyPurchaseCount}=mod.exports;
for(const [name,value,want] of [
 ['zero verified balance',{loggedIn:true,baseRemaining:0,creditsRemaining:0},0],
 ['free allowance remains',{loggedIn:true,baseRemaining:2,creditsRemaining:0},2],
 ['paid credits remain',{loggedIn:true,baseRemaining:0,creditsRemaining:3},3],
 ['both remain',{loggedIn:true,baseRemaining:2,creditsRemaining:3},5],
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
