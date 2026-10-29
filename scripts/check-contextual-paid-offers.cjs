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
test('view tracking requires real visibility; unavailable analytics cannot stop a purchase',()=>{
 const hook=read('lib/use-paid-offer-tracking.ts');
 assert.match(hook,/intersectionRatio >= 0\.5/); assert.match(hook,/750/);
 assert.match(hook,/document\.visibilityState !== "visible"/); assert.match(hook,/catch/);
 const offer=read('components/dating/CompactPaidOffer.tsx');
 assert.match(offer,/!action\.hasAttribute\("disabled"\)/); assert.match(offer,/aria-disabled/);
 assert.doesNotMatch(offer,/preventDefault|stopPropagation|payments\/toss/);
});
