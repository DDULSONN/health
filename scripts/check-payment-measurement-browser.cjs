/* eslint-disable @typescript-eslint/no-require-imports */
// Actual UI -> actual API handlers -> local PostgreSQL. No production calls/payments.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs'),{database}=require('./fixtures/payment-measurement-runtime.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const f=await database(),out=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-payment-measurement-'));
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/payment-measurement-browser.tsx'),output:{path:out,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});compiler.run((err,stats)=>{compiler.close(()=>{});if(err||stats.hasErrors())reject(err||Error(stats.toString({all:false,errors:true})));else resolve();});});
  const cssDir=process.env.CONTACT_CONVERSION_CSS_DIR||path.join(root,'.next/static/css');
  const css=fs.readdirSync(cssDir).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(cssDir,p),'utf8')).join('\n');
  let mode='normal',apiCalls=0;const unexpected=[],serverErrors=[];
  const server=http.createServer(async(req,res)=>{try{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(out,'fixture.js')));return;}
    if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
    if(req.url.startsWith('/api/dating/1on1/contact-intro-offer')){res.setHeader('Content-Type','application/json');res.end('{"offer":null}');return;}
    if(['/api/analytics/contact-exchange','/api/payments/toss/failure'].includes(req.url)){
      apiCalls++;let body='';for await(const c of req)body+=c;
      if(mode==='offline'){res.statusCode=503;res.end('{}');return;}
      if(mode==='slow')await new Promise(r=>setTimeout(r,1200));
      const handler=req.url.includes('contact-exchange')?f.contact:f.failure;
      const result=await handler.POST(new Request('http://127.0.0.1'+req.url,{method:req.method,body}));
      res.statusCode=result.status;res.setHeader('Content-Type','application/json');res.end(await result.text());return;
    }
    if(req.url.startsWith('/api/')){unexpected.push(req.url);res.statusCode=500;res.end();return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
  }catch(e){serverErrors.push(e.message);res.statusCode=500;res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  let browser;
  const total=async(event,placement)=>Number((await f.db.query('select count(*)::int n from payment_funnel_events where event_name=$1 and placement=$2',[event,placement])).rows[0].n);
  const waitFor=async(fn)=>{for(let i=0;i<40;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Local recorded event not found');};
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,origin,'No outside requests');return route.continue();});
    const button=page.getByRole('button',{name:'연락처 교환 · 20,000원',exact:true});
    await page.goto(origin+'/mypage');await button.waitFor();await page.waitForTimeout(950);assert.equal(await total('view_item','mypage_matching'),0,'below fold is not a view');
    await button.scrollIntoViewIfNeeded();await waitFor(async()=>await total('view_item','mypage_matching')===1);
    await button.click();await page.getByLabel('기존 교환 핸들러 호출').filter({hasText:'1'}).waitFor();await waitFor(async()=>await total('select_item','mypage_matching')===1);
    await button.click();await page.reload();await button.scrollIntoViewIfNeeded();await page.waitForTimeout(950);
    assert.equal(await total('view_item','mypage_matching'),1,'reload deduped in DB');assert.equal(await total('select_item','mypage_matching'),1);
    await page.screenshot({path:path.join(out,'contact-mobile.png'),fullPage:false});
    await page.goto(origin+'/community/dating/cards?tab=one_on_one');await button.scrollIntoViewIfNeeded();await waitFor(async()=>await total('view_item','one_on_one_home')===1);await button.click();await waitFor(async()=>await total('select_item','one_on_one_home')===1);
    const before=apiCalls;await page.getByLabel('무료 혜택').check();await page.getByRole('button',{name:'무료로 번호교환',exact:true}).click();await page.waitForTimeout(900);assert.equal(apiCalls,before,'free exchange is not a paid funnel event');
    await page.getByLabel('무료 혜택').uncheck();await page.getByLabel('처리 중').check();await page.waitForTimeout(900);assert.equal(apiCalls,before,'disabled button not recorded');
    mode='offline';await page.goto(origin+'/mypage');await button.scrollIntoViewIfNeeded();await button.click();assert.equal(await page.getByLabel('기존 교환 핸들러 호출').innerText(),'1','503 cannot block existing checkout callback');
    await page.getByRole('button',{name:'실패 기록 테스트'}).click();await page.waitForTimeout(100);assert.equal((await f.db.query('select count(*)::int n from payment_checkout_failures')).rows[0].n,0);
    mode='normal';await page.getByRole('button',{name:'실패 기록 테스트'}).click();await waitFor(async()=>(await f.db.query('select count(*)::int n from payment_checkout_failures')).rows[0].n===1);
    mode='slow';await page.goto(origin+'/mypage');await button.scrollIntoViewIfNeeded();const start=Date.now();await button.click();assert.equal(await page.getByLabel('기존 교환 핸들러 호출').innerText(),'1');assert(Date.now()-start<1000,'checkout does not wait for slow telemetry');
    await page.waitForTimeout(1400);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(serverErrors,[]);
    mode='normal';
    for(const observerMode of ['missing','throws']){
      const isolated=await browser.newContext({viewport:{width:390,height:844}});
      await isolated.addInitScript(mode=>{
        window.IntersectionObserver=mode==='missing'?undefined:class { constructor(){throw Error('blocked observer');} };
        Object.defineProperty(window,'sessionStorage',{get(){throw Error('blocked storage');}});
      },observerMode);
      const p=await isolated.newPage();p.on('pageerror',e=>errors.push(e.message));
      await p.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,origin);return route.continue();});
      await p.goto(origin+'/mypage');const b=p.getByRole('button',{name:'연락처 교환 · 20,000원',exact:true});
      await b.scrollIntoViewIfNeeded();await p.waitForTimeout(900);const beforeClick=apiCalls;
      await b.click();assert.equal(await p.getByLabel('기존 교환 핸들러 호출').innerText(),'1');
      await waitFor(async()=>apiCalls>beforeClick);await p.waitForTimeout(150);await isolated.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(serverErrors,[]);
    assert.equal((await f.db.query('select status from toss_test_payment_orders')).rows[0].status,'paid');
    assert.equal((await f.db.query('select contact_exchange_status from dating_1on1_match_proposals')).rows[0].contact_exchange_status,'awaiting_applicant_payment');
    console.log(JSON.stringify({ok:true,flow:'actual component -> actual API -> PostgreSQL',scenarios:['below-fold','viewport','click','reload-dedupe','home-and-mypage','free','disabled','503','failed-save-retry','slow-api','unsupported-observer','throwing-observer','blocked-storage'],automaticPayments:0,screenshots:out}));
  }finally{await browser?.close();await new Promise(r=>server.close(r));await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
