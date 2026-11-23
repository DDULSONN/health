/* eslint-disable @typescript-eslint/no-require-imports */
// Real reward banner, balance widget and credit page; fake HTTP only, no production credentials.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const webpack=require('webpack'),{chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-return-credit-balance-'));
 const adapter=path.join(__dirname,'fixtures/return-reward-adapters.tsx');
 await new Promise((resolve,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/return-credit-balance-browser.tsx'),output:{path:output,filename:'fixture.js'},
   resolve:{extensions:['.tsx','.ts','.js'],alias:{'next/link':adapter,'next/navigation':adapter,'@/lib/supabase/client':adapter,'@':root}},
   plugins:[new webpack.DefinePlugin({'process.env.NEXT_PUBLIC_OPENKAKAO_URL':'undefined'})],
   module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
  compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
 });
 const cssDir=process.env.PROFILE_UX_CSS_DIR||path.join(root,'.next/static/css');
 const css=fs.readdirSync(cssDir).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssDir,f),'utf8')).join('\n');
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'");
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'fixture.js')));}
  if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
  if(req.url.startsWith('/api/')){res.writeHead(405);return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 let browser,passed=0;
 const eventName='gymtools:apply-credit-balance-changed';
 const empty=p=>p.getByText('기본 지원 횟수는 매일 밤 12시(한국 시간)에 다시 채워져요.',{exact:true});
 const granted=p=>p.getByText('복귀 지원권 5장 지급 완료',{exact:true});
 async function setup(options={}){
  const context=await browser.newContext({viewport:{width:options.width||390,height:844}}),page=await context.newPage();page.setDefaultTimeout(10000);
  const s={balance:0,base:0,stage:'ready',posts:0,reads:0,failClaim:false,failBalance:false,requests:[],errors:[],...options};
  page.on('pageerror',e=>s.errors.push(e.message));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'External/production network prohibited');
   if(!url.pathname.startsWith('/api/'))return route.continue();s.requests.push({method:req.method(),path:url.pathname});
   if(url.pathname==='/api/analytics/payment-funnel')return route.fulfill({status:204});
   if(url.pathname==='/api/mypage/dating-adult-confirmation')return route.fulfill({json:{authenticated:true,confirmed:true}});
   if(url.pathname==='/api/dating/apply-credits/status'){
    s.reads++;if(s.onBalance)return s.onBalance(route,s);
    return route.fulfill({status:s.failBalance?503:200,json:{ok:!s.failBalance,loggedIn:true,baseRemaining:s.base,creditsRemaining:s.balance,passCreditsRemaining:s.passCredits}});
   }
   if(url.pathname==='/api/return-profile-reward'){
    if(s.onReward)return s.onReward(route,s);
    if(req.method()==='POST'){
     s.posts++;await pause(200);if(s.claimGate)await s.claimGate;
     if(s.failClaim)return route.fulfill({status:503,json:{error:'unavailable'}});
     s.stage='rewarded';s.balance+=s.first?1:5;
    }
    return route.fulfill({json:{userId:'return-member',reward:{campaignKey:s.first?'first-profile-2026-10':'return-profile-2026-10',credits:s.first?1:5,state:s.stage}}});
   }
   throw Error('Unexpected API '+url.pathname);
  });
  await page.goto(origin+(options.creditPage?'/dating/apply-credits':'/community/dating/cards'));
  await page.waitForFunction(()=>!!window.creditFixture);
  return {page,s,done:async()=>{assert.deepEqual(s.errors,[]);assert.equal(s.requests.filter(r=>r.path.startsWith('/api/payments/')).length,0);await context.close();passed++;}};
 }
 try{
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,1280]){
   const t=await setup({width});await granted(t.page).waitFor();await t.page.getByText('오늘 5회 지원 가능',{exact:true}).waitFor();
   assert.equal(await empty(t.page).count(),0);assert.equal(t.s.posts,1);assert.equal(t.s.reads,2);
   assert.equal(await t.page.getByRole('link',{name:'남은 지원권 확인 →'}).getAttribute('href'),'/dating/apply-credits');
   assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(width===390)await t.page.screenshot({path:path.join(output,'reward-balance-mobile.png'),fullPage:true});await t.done();
  }
  {const t=await setup({stage:'rewarded'});await granted(t.page).waitFor();await empty(t.page).waitFor();
   await t.page.getByText('지급 이력이에요. 사용 후 남은 수량은 지원권 내역에서 확인해 주세요.',{exact:true}).waitFor();
   assert.equal(t.s.posts,0);assert.equal(t.s.reads,1);await t.done();}
  {const t=await setup({stage:'rewarded',passCredits:4,width:320});await t.page.getByText('패스 지원권 4장',{exact:true}).waitFor();
   assert.equal(await empty(t.page).count(),0);assert.equal(await t.page.getByText(/오늘 .*회 지원 가능/).count(),0);
   assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await t.done();}
  {const t=await setup({stage:'rewarded',base:1,balance:2,passCredits:4});await t.page.getByText('총 7회 지원 가능 · 패스 4장',{exact:true}).waitFor();
   assert.equal(await empty(t.page).count(),0);await t.done();}
  {const t=await setup({stage:'rewarded',passCredits:0});await empty(t.page).waitFor();await t.done();}
  {const t=await setup({first:true,base:2});await t.page.getByText('오픈카드 지원권 1장 지급 완료',{exact:true}).waitFor();
   await t.page.getByText('오늘 3회 지원 가능',{exact:true}).waitFor();assert.equal(t.s.balance,1);assert.equal(t.s.posts,1);await t.done();}
  {const t=await setup({failClaim:true});await t.page.getByText('프로필은 등록됐어요. 지원권 지급만 다시 확인해 주세요.').waitFor();
   assert.equal(t.s.balance,0);assert.equal(t.s.reads,1);assert.equal(await granted(t.page).count(),0);
   t.s.failClaim=false;await t.page.getByRole('button',{name:'지급 다시 확인'}).click();await t.page.getByText('오늘 5회 지원 가능',{exact:true}).waitFor();assert.equal(t.s.posts,2);await t.done();}
  {const t=await setup({onBalance:async(route,s)=>route.fulfill({status:s.reads>1?503:200,json:{ok:s.reads===1,loggedIn:true,baseRemaining:0,creditsRemaining:0}})});
   await granted(t.page).waitFor();await t.page.waitForLoadState('networkidle');assert.equal(t.s.balance,5);assert.equal(t.s.reads,2);assert.equal(await empty(t.page).count(),0);
   assert.equal(await t.page.getByText('오늘 0회 지원 가능',{exact:true}).count(),0);await t.done();}
  {const t=await setup({stage:'rewarded',balance:5});await t.page.getByText('오늘 5회 지원 가능',{exact:true}).waitFor();
   await t.page.evaluate(name=>{window.creditFixture.invalidate('someone-else');dispatchEvent(new Event(name));dispatchEvent(new CustomEvent(name,{detail:{credits:1000}}));},eventName);
   await pause(100);assert.equal(t.s.reads,1);assert.equal(t.s.balance,5);await t.done();}
  {let release;const gate=new Promise(r=>release=r);const t=await setup({claimGate:gate});await empty(t.page).waitFor();
   await t.page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}));release();await granted(t.page).waitFor();
   assert.equal(await empty(t.page).count(),0);assert.equal(t.s.reads,1);
   await t.page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
   await t.page.getByText('오늘 5회 지원 가능',{exact:true}).waitFor();assert.equal(t.s.reads,2);await t.done();}
  {let release;const gate=new Promise(r=>release=r);const t=await setup({stage:'rewarded',onBalance:async(route,s)=>{
    const count=s.balance;if(s.reads===1)await gate;return route.fulfill({json:{ok:true,loggedIn:true,baseRemaining:0,creditsRemaining:count}}).catch(()=>{});
   }});await granted(t.page).waitFor();t.s.balance=5;await t.page.evaluate(()=>window.creditFixture.invalidate('return-member'));
   await t.page.getByText('오늘 5회 지원 가능',{exact:true}).waitFor();release();await pause(100);assert.equal(await empty(t.page).count(),0);await t.done();}
  for(const id of [null,'other-member']){
   let release;const gate=new Promise(r=>release=r);const t=await setup({onReward:async route=>{
    if(route.request().method()==='POST')throw Error('stale session must not claim');
    await gate;return route.fulfill({json:{userId:'return-member',reward:{campaignKey:'return-profile-2026-10',credits:5,state:'ready'}}}).catch(()=>{});
   }});await t.page.evaluate(id=>window.creditFixture.auth(id),id);release();await pause(150);
   assert.equal(await granted(t.page).count(),0);assert.equal(t.s.posts,0);await t.done();
  }
  {const t=await setup({creditPage:true});await granted(t.page).waitFor();await t.page.locator('dl').getByText('5장',{exact:true}).waitFor();assert.equal(t.s.reads,2);assert.equal(t.s.posts,1);await t.done();}
  {const t=await setup({creditPage:true,stage:'rewarded',base:2,balance:5,passCredits:8,width:320});
   await t.page.locator('dl').getByText('연애 패스 지원권',{exact:true}).waitFor();
   for(const amount of ['2회','5장','8장']) await t.page.locator('dl').getByText(amount,{exact:true}).waitFor();
   assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await t.done();}
  {const t=await setup({creditPage:true,onBalance:async(route,s)=>route.fulfill({status:s.reads>1?503:200,json:{ok:s.reads===1,loggedIn:true,baseRemaining:0,creditsRemaining:0}})});
   await granted(t.page).waitFor();await t.page.getByText('남은 지원권을 불러오지 못했어요. 다시 확인해 주세요.',{exact:true}).waitFor();
   assert.equal(await t.page.locator('dl').getByText('0장',{exact:true}).count(),0);assert.equal(t.s.balance,5);
   t.s.onBalance=null;await t.page.getByRole('button',{name:'다시 확인',exact:true}).click();await t.page.locator('dl').getByText('5장',{exact:true}).waitFor();assert.equal(t.s.posts,1);await t.done();}
  {let release;const gate=new Promise(r=>release=r);const t=await setup({creditPage:true,stage:'rewarded',onBalance:async(route,s)=>{
    const count=s.balance;if(s.reads===1)await gate;return route.fulfill({json:{ok:true,loggedIn:true,baseRemaining:0,creditsRemaining:count}}).catch(()=>{});
   }});await granted(t.page).waitFor();t.s.balance=5;await t.page.evaluate(()=>window.creditFixture.invalidate('return-member'));
   await t.page.locator('dl').getByText('5장',{exact:true}).waitFor();release();await pause(100);
   assert.equal(await t.page.locator('dl').getByText('0장',{exact:true}).count(),0);await t.done();}
  console.log(JSON.stringify({passed,productionRequests:0,automaticPaymentRequests:0,screenshots:output}));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
