/* eslint-disable @typescript-eslint/no-require-imports */
// Real React UI, isolated HTTP fixtures; never connects to production or a payment provider.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const webpack=require('webpack'),{chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..');
async function main(){
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-contextual-offers-browser-'));
 const adapter=path.join(__dirname,'fixtures/profile-ux-adapters.tsx');
 await new Promise((resolve,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/contextual-offers-browser.tsx'),output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'next/link':adapter,'next/navigation':adapter,'@':root}},plugins:[new webpack.DefinePlugin({'process.env.NEXT_PUBLIC_OPENKAKAO_URL':'undefined'})],module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
  compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
 });
 const cssDir=process.env.PROFILE_UX_CSS_DIR||path.join(root,'.next/static/css');
 const css=fs.readdirSync(cssDir).filter(x=>x.endsWith('.css')).map(x=>fs.readFileSync(path.join(cssDir,x),'utf8')).join('\n')+'\n:root{--font-geist-sans:Arial;--font-geist-mono:monospace}';
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'");
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'fixture.js')));}
  if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
  if(req.url.startsWith('/api/')){res.writeHead(405);return res.end('fixture API only');}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 let browser,passed=0;
 const defaultStatus={loggedIn:true,activeCities:['서울','경기'],activeCityDetails:[{province:'서울',targetSex:'female'},{province:'경기',targetSex:'female'}],provinceStats:[{province:'서울',total:35,male:0,female:35},{province:'경기',total:35,male:0,female:35}],targetSex:'female'};
 async function setup(width=390,config={}){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();page.setDefaultTimeout(10000);
  const state={requests:[],events:[],errors:[],dialogs:[],checkoutCount:0,...config};
  page.on('pageerror',e=>{state.errors.push(e.message);console.error('BROWSER ERROR',e.message);});page.on('dialog',async d=>{state.dialogs.push(d.message());await d.dismiss();});
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'production/external network prohibited');
   state.requests.push({method:req.method(),path:url.pathname});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/analytics/payment-funnel'){state.events.push(req.postDataJSON());return state.analyticsFail?route.abort('failed'):route.fulfill({status:204});}
   if(url.pathname==='/api/dating/apply-credits/status'){
    if(state.creditHandler)return state.creditHandler(route);
    return route.fulfill({status:state.creditStatus||200,json:state.creditBody??{loggedIn:true,baseRemaining:2,creditsRemaining:0}});
   }
   if(url.pathname==='/api/dating/cards/city-view/status')return route.fulfill({json:state.status||defaultStatus});
   if(url.pathname==='/api/mypage/dating-adult-confirmation')return route.fulfill({json:{authenticated:true,confirmed:true}});
   if(url.pathname==='/api/dating/cards/city-view/list'){
    if(state.listHandler)return state.listHandler(route,url);
    return route.fulfill({json:{limit:state.limit||30,targetSex:'female',items:[{id:'fixture-card',sex:'female',display_nickname:'가상 후보',age:30,region:url.searchParams.get('province'),image_urls:[]}],purchasePreview:state.preview===undefined?{newCount:7}:state.preview}});
   }
   if(url.pathname==='/api/payments/toss/create'){
    state.checkoutCount++;state.checkoutBody=req.postDataJSON();assert.equal(req.method(),'POST');
    await new Promise(r=>setTimeout(r,150));
    return route.fulfill({status:state.checkoutFail?409:200,json:state.checkoutFail?{message:'새 후보가 없어 결제하지 않았어요.'}:{checkoutUrl:origin+'/fixture-checkout'}});
   }
   throw Error('Unexpected fixture API '+url.pathname);
  });
  return {context,page,state,done:async()=>{assert.deepEqual(state.errors,[]);await context.close();passed++;}};
 }
 try{
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,1280]){
   const t=await setup(width,{creditBody:{loggedIn:true,baseRemaining:0,creditsRemaining:0}});
   await t.page.goto(origin+'/?pending');const offer=t.page.getByRole('region',{name:'오늘 지원을 모두 썼어요'});await offer.waitFor();
   assert.equal(await t.page.getByRole('link',{name:'대기 없이 등록 · 10,000원 ›'}).getAttribute('href'),'/dating/paid?apply=1&source=open_card');
   assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   assert.ok((await offer.boundingBox()).height<=135,'compact on mobile');
   await t.page.screenshot({path:path.join(output,'extras-'+width+'.png'),fullPage:true});
   await t.page.waitForTimeout(900);assert.ok(t.state.events.some(e=>e.placement==='open_card_credits_empty'&&e.eventName==='view_item'));
   const before=t.state.requests.filter(r=>r.path.endsWith('/apply-credits/status')).length;
   await t.page.evaluate(()=>{dispatchEvent(new Event('focus'));dispatchEvent(new Event('pageshow'));});await t.page.waitForTimeout(150);
   assert.equal(t.state.requests.filter(r=>r.path.endsWith('/apply-credits/status')).length,before,'no duplicate focus reads');
   t.state.creditBody={loggedIn:true,baseRemaining:0,creditsRemaining:5};
   await t.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
   await t.page.getByText('오늘 5회 지원 가능').waitFor();assert.equal(await offer.count(),0,'purchase return clears stale shortage');
   assert.equal(t.state.checkoutCount,0,'viewing must not start checkout');await t.done();
  }
  for(const config of [{creditBody:{loggedIn:true,baseRemaining:2,creditsRemaining:0}},{creditBody:{loggedIn:true,baseRemaining:0,creditsRemaining:3}},{creditBody:{loggedIn:true,baseRemaining:'0',creditsRemaining:0}},{creditStatus:503},{creditBody:{loggedIn:false,baseRemaining:0,creditsRemaining:0}}]){
   const t=await setup(390,config);await t.page.goto(origin+'/?pending&paid');await t.page.waitForLoadState('networkidle');
   assert.equal(await t.page.getByRole('region').count(),0,'unknown, sufficient quota or active paid card: no upsell');await t.done();
  }
  {const t=await setup();await t.page.goto(origin+'/?guest');await t.page.waitForLoadState('networkidle');assert.equal(t.state.requests.filter(r=>r.path.endsWith('/apply-credits/status')).length,0);await t.done();}
  {let release;const wait=new Promise(r=>release=r);let calls=0;
   const t=await setup(390,{creditHandler:async route=>{if(++calls===1){await wait;await route.fulfill({json:{loggedIn:true,baseRemaining:0,creditsRemaining:0}}).catch(()=>{});}else await route.fulfill({json:{loggedIn:true,baseRemaining:2,creditsRemaining:0}});}});
   await t.page.goto(origin);await t.page.waitForFunction(()=>typeof window.setFixtureUser==='function');while(!calls)await t.page.waitForTimeout(25);
   await t.page.evaluate(()=>window.setFixtureUser('fixture-b'));await t.page.getByText('오늘 2회 지원 가능').waitFor();release();await t.page.waitForTimeout(100);
   assert.equal(await t.page.getByRole('region',{name:'오늘 지원을 모두 썼어요'}).count(),0);await t.done();
  }
  {const t=await setup();await t.page.goto(origin+'/?tracking');await t.page.waitForTimeout(1000);assert.equal(t.state.events.filter(e=>e.placement==='fixture_offscreen').length,0);
   const offer=t.page.getByRole('region',{name:'추가 노출 검사'});await offer.scrollIntoViewIfNeeded();await t.page.waitForTimeout(900);
   assert.equal(t.state.events.filter(e=>e.placement==='fixture_offscreen'&&e.eventName==='view_item').length,1);
   await offer.getByRole('button').dispatchEvent('click');assert.equal(t.state.events.filter(e=>e.placement==='fixture_offscreen'&&e.eventName==='select_item').length,0);await t.done();
  }
  for(const preview of [{newCount:0},null,{newCount:'7'},{newCount:31}]){
   const t=await setup(390,{preview});await t.page.goto(origin+'/dating/nearby-view');await t.page.getByText('가상 후보 30세').waitFor();
   assert.equal(await t.page.getByRole('button',{name:'가까운 후보 더 보기 · 5,000원'}).count(),0);assert.equal(await t.page.getByRole('button',{name:'최대 30명 열기 · 5,000원'}).count(),0);await t.done();
  }
  for(const limit of [10,30]){
   const t=await setup(390,{limit,checkoutFail:true,analyticsFail:true});await t.page.goto(origin+'/dating/nearby-view');
   const offer=t.page.getByRole('region',{name:'아직 안 본 후보 7명 더 보기'});await offer.waitFor();await offer.scrollIntoViewIfNeeded();
   await t.page.screenshot({path:path.join(output,'nearby-'+limit+'.png'),fullPage:true});
   const button=offer.getByRole('button');await button.evaluate(el=>{el.click();el.click();});
   assert.equal(await button.evaluate(el=>getComputedStyle(el).fontSize),'12px','compact action inherits intended size despite global form style');
   await t.page.waitForFunction(()=>!document.querySelector('button[disabled]'));
   assert.equal(t.state.checkoutCount,1);assert.deepEqual(t.state.checkoutBody,{productType:'city_view',province:'서울',targetSex:'female',requireNewCandidates:true});
   assert.equal(await t.page.getByText('가상 후보 30세').count(),1);assert.ok(t.state.dialogs[0].includes('새 후보가 없어'));
   t.state.checkoutFail=false;await button.click();await t.page.waitForURL('**/fixture-checkout');assert.equal(t.state.checkoutCount,2);await t.done();
  }
  {let release;const wait=new Promise(r=>release=r);
   const t=await setup(390,{listHandler:async(route,url)=>{const province=url.searchParams.get('province');if(province==='서울')await wait;return route.fulfill({json:{limit:30,targetSex:'female',items:[{id:province,sex:'female',display_nickname:province+' 후보',image_urls:[]}],purchasePreview:{newCount:province==='서울'?25:3}}});}});
   await t.page.goto(origin+'/dating/nearby-view');await t.page.getByRole('button',{name:'아래 카드 확인 ↓'}).nth(1).click();
   await t.page.getByRole('region',{name:'아직 안 본 후보 3명 더 보기'}).waitFor();release();await t.page.waitForTimeout(200);
   assert.equal(await t.page.getByText('경기 후보',{exact:true}).count(),1);assert.equal(await t.page.getByRole('region',{name:'아직 안 본 후보 25명 더 보기'}).count(),0);await t.done();
  }
  console.log(JSON.stringify({passed,productionRequests:0,screenshots:output}));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
