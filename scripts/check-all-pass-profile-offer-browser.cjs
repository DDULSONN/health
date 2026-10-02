/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('./test-browser-runtime.cjs'),{startPreview}=require('./preview-all-pass-profile-offer.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const offer=(state='active',ms=86400000)=>{const end=Date.now()+ms;return {state,offerId:state==='available'?null:'00000000-0000-4000-8000-000000000001',startsAt:state==='available'?null:new Date(end-86400000).toISOString(),expiresAt:state==='available'?null:new Date(end).toISOString(),serverNow:new Date().toISOString(),amount:32000,originalAmount:39900};};
(async()=>{
 const preview=await startPreview();let browser;const errors=[];
 try {
  browser=await chromium.launch({headless:true});
  const fulfill=(route,body,status=200)=>route.fulfill({status,contentType:'application/json; charset=utf-8',body:JSON.stringify(body)});
  const banner=p=>p.getByRole('complementary',{name:'프로필 완성 올패스 할인'});
  async function pageFor(handler,width=390,suffix='') {
   const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/api/dating/all-pass-offer',handler);await page.goto(preview.origin+'/community/dating/cards'+suffix);await page.waitForFunction(()=>!!window.allPassFixture);return page;
  }
  let reads=0,page=await pageFor(r=>{reads++;return fulfill(r,{userId:'return-member',offer:offer()});},390,'?preview=anonymous');
  await pause(150);assert.equal(reads,0);assert.equal(await banner(page).count(),0);await page.context().close();
  for(const value of [null,offer('expired'),offer('used'),{...offer(),amount:1}]){
   page=await pageFor(r=>fulfill(r,{userId:'return-member',offer:value}));await pause(150);assert.equal(await banner(page).count(),0);await page.context().close();
  }
  for(const width of [320,390,768,1280]) {
   page=await pageFor(r=>fulfill(r,{userId:'return-member',offer:offer()}),width);await banner(page).waitFor();
   assert(await banner(page).getByText('32,000원',{exact:true}).isVisible());assert(await banner(page).getByText('39,900원',{exact:true}).isVisible());
   const regular=await banner(page).getByText('39,900원',{exact:true}).boundingBox(),discount=await banner(page).getByText('32,000원',{exact:true}).boundingBox();
   assert(discount.x>=regular.x+regular.width+6,'price spacing '+width);
   const bounds=await banner(page).boundingBox();
   assert(bounds.height<=122,'compact '+width+': '+bounds.height);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);
   assert(await banner(page).getByText('약 20% 할인',{exact:true}).isVisible());
   assert.match(await banner(page).innerText(),/1:1 후보 새로고침 2회\/24시간/);
   assert.match(await banner(page).innerText(),/빠른매칭 하루 30회 · 프로필 우선 추천/);
   assert.match(await banner(page).innerText(),/번호교환 별도/);
   assert.doesNotMatch(await banner(page).innerText(),/프로필 완성 혜택|자동 정기결제|첫 안내부터/);
   for(const name of ['이용하기','올패스 할인 안내 닫기']) {const box=await page.getByRole('button',{name,exact:true}).boundingBox();assert(box.width>=44&&box.height>=44,'touch target '+name);}
   console.log('Banner '+width+'px: '+bounds.height+'px high');
   if(width===390)await page.screenshot({path:path.join(preview.output,'all-pass-offer-mobile.png'),fullPage:true});
   await page.getByRole('button',{name:'올패스 할인 안내 닫기'}).click();assert.equal(await banner(page).count(),0);
   await page.reload();await pause(150);assert.equal(await banner(page).count(),0);await page.context().close();
  }
  let started=0;
  page=await pageFor(r=>{const post=r.request().method()==='POST';if(post)started++;return fulfill(r,{userId:'return-member',offer:offer(post?'active':'available')});});
  await banner(page).waitFor();assert.equal(started,1,'one start after visible authenticated eligibility');await page.context().close();
  page=await pageFor(r=>fulfill(r,{userId:'return-member',offer:offer('active',1800)}));await banner(page).waitFor();await banner(page).waitFor({state:'detached',timeout:5000});await page.context().close();
  let checkouts=0,resolveCheckout;const gate=new Promise(resolve=>{resolveCheckout=resolve;});
  page=await pageFor(r=>fulfill(r,{userId:'return-member',offer:offer()}));
  await page.route('**/api/payments/toss/create',async r=>{checkouts++;const body=r.request().postDataJSON();assert.equal(body.productType,'dating_all_pass_30d');assert(body.allPassOfferId);assert.equal(body.amount,undefined);await gate;await fulfill(r,{ok:false,message:'가상 결제 확인 오류'},503).catch(()=>{});});
  await banner(page).waitFor();await page.getByRole('button',{name:'이용하기'}).evaluate(b=>{b.click();b.click();});await pause(100);assert.equal(checkouts,1);
  resolveCheckout();await page.getByRole('alert').waitFor();assert(await page.getByRole('button',{name:'이용하기'}).isEnabled());await page.context().close();
  let resolveFirst;const pending=new Promise(resolve=>{resolveFirst=resolve;});
  page=await pageFor(async r=>{await pending;await fulfill(r,{userId:'return-member',offer:offer()}).catch(()=>{});});
  await page.evaluate(()=>window.allPassFixture.auth('other-member'));resolveFirst();await pause(200);assert.equal(await banner(page).count(),0);await page.context().close();
  page=await pageFor(r=>fulfill(r,{userId:'return-member',offer:offer()}),390,'?plans=1');await banner(page).waitFor();
  await page.getByRole('button',{name:/올패스 30일.*32,000원/}).waitFor();
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('disabled');};});await page.getByRole('button',{name:'올패스 할인 안내 닫기'}).click();assert.equal(await banner(page).count(),0);await page.context().close();
  assert.deepEqual(errors,[]);console.log('PASS: eligibility/privacy, 24h expiry, first visible start, compact 320/390/768/1280, saved dismissal, checkout lock/retry, account switch, existing plan discount, optional storage');
  console.log('Screenshot: '+path.join(preview.output,'all-pass-offer-mobile.png'));
 }finally{if(browser)await browser.close();await new Promise(resolve=>preview.server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
