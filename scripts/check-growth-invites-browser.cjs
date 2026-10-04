/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-growth-'));
 const adapter=path.join(__dirname,'fixtures/growth-adapters.tsx');
 await new Promise((resolve,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/growth-browser.tsx'),output:{path:output,filename:'fixture.js'},
   plugins:[new webpack.DefinePlugin({'process.env.NEXT_PUBLIC_SITE_URL':JSON.stringify('https://helchang.com')})],
   resolve:{extensions:['.tsx','.ts','.js'],alias:{'next/link':adapter,'next/navigation':adapter,'next/dynamic':path.join(__dirname,'fixtures/growth-dynamic.tsx'),'@/lib/supabase/client':adapter,'@':root}},
   module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});
  compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors())reject(error||Error(stats.toString({all:false,errors:true})));else resolve();});
 });
 const cssRoot=path.join(root,'.next/static/css');
 const css=fs.readdirSync(cssRoot).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(cssRoot,p),'utf8')).join('\n');
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.endsWith('.js')&&fs.existsSync(path.join(output,path.basename(url.pathname)))){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(output,path.basename(url.pathname))));return;}
  if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 let browser,passed=0;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const width of [320,390,1280]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(10000);
   let apiCalls=0,mode='ok';const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(()=>{
    window.fixtureUser={id:'a',created_at:new Date().toISOString(),email_confirmed_at:'confirmed'};window.events=[];
    window.gtag=(...args)=>window.events.push(args);
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value;}}});
    Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
   });
   await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());assert.equal(u.origin,origin,'no production request');
    if(!u.pathname.startsWith('/api/')){await route.continue();return;}
    assert.equal(u.pathname,'/api/referrals/me');assert.equal(req.method(),'GET');apiCalls++;
    if(mode==='error'){await route.fulfill({status:503,json:{error:'일시적인 조회 오류'}});return;}
    if(mode==='slow'){await new Promise(r=>setTimeout(r,100));}
    await route.fulfill({json:{code:'GYM23456789A',inviteUrl:origin+'/signup?ref=GYM23456789A',rewardCredits:5,invitedCount:0,rewardedCount:0,joinedWithReferral:false,ownReferralStatus:null}}).catch(()=>{});
   });
   await page.goto(origin+'/community/dating/cards?utm_campaign=ig_reel_a&utm_source=instagram&utm_medium=organic_social');
   await page.getByRole('heading',{name:'1대1 매칭',exact:true}).waitFor();
   assert.equal(await page.getByRole('complementary',{name:'프로필 등록 후 친구 초대'}).count(),0);assert.equal(apiCalls,0);
   await page.evaluate(()=>window.fixtureProfileSaved('one_on_one','a'));
   const prompt=page.getByRole('complementary',{name:'프로필 등록 후 친구 초대'});await prompt.waitFor();
   assert.equal(await prompt.getByRole('button',{expanded:false}).count(),1);assert.equal(apiCalls,0);
   assert.ok((await prompt.boundingBox()).height<=60,'compact collapsed height');
   await page.screenshot({path:path.join(output,'completion-'+width+'.png'),fullPage:true});
   await prompt.getByRole('button',{name:/친구 초대하고/}).click();
   await prompt.getByRole('button',{name:'링크 복사',exact:true}).waitFor();assert.equal(apiCalls,1);
   await prompt.getByRole('button',{name:'링크 복사',exact:true}).click();await prompt.getByRole('button',{name:'복사 완료'}).waitFor();
   const link=await page.evaluate(()=>window.copied);assert.equal(new URL(link).searchParams.get('ref'),'GYM23456789A');assert.equal(new URL(link).searchParams.get('utm_campaign'),'friend_invite');
   await prompt.getByRole('button',{name:'공유하기'}).click();assert.equal(apiCalls,1);
   const events=await page.evaluate(()=>window.events);assert.equal(events.filter(x=>x[1]==='profile_created').length,1);assert.equal(events.find(x=>x[1]==='profile_created')[2].growth_campaign,'ig_reel_a');
   assert.ok(!JSON.stringify(events).includes('GYM23456789A'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,'expanded-'+width+'.png'),fullPage:true});passed++;
   await prompt.getByRole('button',{name:'친구 초대 안내 닫기'}).click();assert.equal(await prompt.count(),0);await page.reload();await page.getByRole('heading').waitFor();assert.equal(await prompt.count(),0);passed++;
   await page.evaluate(()=>{window.fixtureSignIn({id:'b',created_at:new Date().toISOString(),email_confirmed_at:'yes'});window.fixtureProfileSaved('one_on_one','a');});assert.equal(await prompt.count(),0);
   await page.evaluate(()=>{window.fixtureSignIn({id:'a',created_at:new Date().toISOString(),email_confirmed_at:'yes'});window.fixtureProfileSaved('open_card','a');});await prompt.waitFor();
   await page.evaluate(()=>window.fixtureSignIn(null));await prompt.waitFor({state:'detached'});passed++;
   await page.goto(origin+'/preview/credits');const expand=page.getByRole('button',{name:/친구 초대하고/});await expand.waitFor();const initial=apiCalls;
   mode='error';await expand.click();await page.getByText('일시적인 조회 오류',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.fixtureSubmits),0);
   mode='ok';await page.getByRole('button',{name:'다시 시도'}).click();await page.getByRole('button',{name:'링크 복사'}).waitFor();assert.equal(apiCalls,initial+2);
   await page.getByRole('button',{name:'링크 복사'}).click();assert.equal(await page.evaluate(()=>window.fixtureSubmits),0);
   await page.evaluate(()=>Object.defineProperty(navigator,'share',{value:async()=>{throw new DOMException('cancel','AbortError');}}));
   const before=await page.evaluate(()=>window.events.length);await page.getByRole('button',{name:'공유하기'}).click();assert.equal(await page.evaluate(()=>window.events.length),before);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'credits-'+width+'.png'),fullPage:true});passed++;
   mode='slow';await page.reload();await expand.waitFor();await expand.click();await expand.click();mode='ok';await expand.click();await page.getByRole('button',{name:'링크 복사'}).waitFor();assert.equal(await page.evaluate(()=>window.fixtureSubmits),0);passed++;
   assert.deepEqual(errors,[]);await context.close();
  }
  // An optional root-level prompt must not blank otherwise usable pages if auth init fails.
  {
   const context=await browser.newContext(),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(()=>{window.fixtureAuthUnavailable=true;});
   await context.route('**/*',async route=>{assert.equal(new URL(route.request().url()).origin,origin);await route.continue();});
   await page.goto(origin+'/community/dating/cards');
   await page.getByRole('heading',{name:'1대1 매칭',exact:true}).waitFor();
   assert.equal(await page.getByRole('complementary').count(),0);assert.deepEqual(errors,[]);passed++;await context.close();
  }
  // Real signup component: no existing auth provider/callback changes, analytics failure nonblocking.
  for(const analytics of ['ok','throw','storage-denied']){
   const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(mode=>{
    window.events=[];window.gtag=(...args)=>{if(mode==='throw')throw Error('analytics unavailable');window.events.push(args);};
    window.fixtureUser=null;
    // New diagnostics use a guarded storage accessor; leave legacy signup email storage untouched.
    if(mode==='storage-denied'){const orig=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('gymtools:growth:'))throw Error('denied');orig.call(this,k,v);};}
   },analytics);
   await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());assert.equal(u.origin,origin);
    if(!u.pathname.startsWith('/api/'))return route.continue();
    assert.equal(u.pathname,'/api/signup/email-marketing');await route.fulfill({json:{token:null}});
   });
   await page.goto(origin+'/signup?utm_campaign=ig_creator_01&utm_source=instagram&utm_medium=creator');
   await page.locator('[aria-controls="email-signup-form"]').click();
   for(const [id,value]of [['email','fixture@example.test'],['nickname','테스트'],['password','fixture-secret-123'],['password-confirm','fixture-secret-123']])await page.locator('#signup-'+id).fill(value);
   await page.locator('form').getByRole('button',{name:/가입/}).click();
   await page.getByText(/가입 요청이 완료되었습니다/).waitFor();
   await page.evaluate(()=>window.fixtureSignIn({id:'new-email',created_at:new Date().toISOString(),email_confirmed_at:new Date().toISOString()}));
   if(analytics!=='throw'){
    await page.waitForFunction(()=>window.events.some(x=>x[1]==='sign_up'));
    const events=await page.evaluate(()=>window.events);assert.equal(events.filter(x=>x[1]==='sign_up').length,1);assert.ok(!JSON.stringify(events).includes('fixture@example.test'));assert.ok(!JSON.stringify(events).includes('fixture-secret'));
   }
   assert.deepEqual(errors,[]);passed++;await context.close();
  }
  console.log(JSON.stringify({passed,productionRequests:0,screenshots:output}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
