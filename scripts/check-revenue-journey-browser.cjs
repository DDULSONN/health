/* eslint-disable @typescript-eslint/no-require-imports */
// Real React components -> actual send handler -> PostgreSQL trigger. All users/data are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs');
const {database,load,read,user,other,match}=require('./fixtures/payment-measurement-runtime.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const f=await database(),out=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-revenue-journey-'));
  const fields='source_card_id uuid,candidate_card_id uuid,contact_exchange_requested_at timestamptz,contact_exchange_paid_at timestamptz,contact_exchange_paid_by_user_id uuid,contact_exchange_approved_at timestamptz,contact_exchange_approved_by_user_id uuid,contact_exchange_note text,source_phone_share_consented_at timestamptz,candidate_phone_share_consented_at timestamptz,admin_sent_by_user_id uuid,source_selected_at timestamptz,candidate_responded_at timestamptz,source_final_responded_at timestamptz,created_at timestamptz,updated_at timestamptz';
  await f.db.exec(fields.split(',').map(field=>'alter table dating_1on1_match_proposals add column '+field+';').join('\n'));
  await f.db.exec(`update dating_1on1_match_proposals set source_card_id='${user}',candidate_card_id='${other}',source_final_responded_at=now(),created_at=now(),updated_at=now();`);
  await f.db.exec(read('supabase/sql/dating_1on1_contact_nudges.sql'));await f.db.exec(read('supabase/sql/dating_1on1_contact_nudge_immediate.sql'));
  let notifications=0,emails=0,sends=0;
  const admin={rpc(name){assert.equal(name,'dating_1on1_contact_nudge_delay_hours');return {async abortSignal(){return {data:(await f.db.query('select dating_1on1_contact_nudge_delay_hours() n')).rows[0].n,error:null};}};},from(table){
    if(table==='dating_1on1_cards'){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{name:'검증발신자'},error:null};}};return q;}
    if(table!=='dating_1on1_contact_nudges')return f.admin.from(table);
    return {insert(row){return {select(){return {async single(){try {const keys=Object.keys(row);const result=await f.db.query(`insert into dating_1on1_contact_nudges(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning preset_key,message_text,created_at`,Object.values(row));return {data:result.rows[0],error:null};}catch(e){return {data:null,error:{code:e.code,message:e.message}};}}};}};}};
  }};
  const nudge=load('app/api/dating/1on1/matches/[id]/nudge/route.ts',{
    '@/lib/supabase/server':{createAdminClient:()=>admin},'@/lib/supabase/request':{getRequestAuthContext:async()=>({user:{id:user}})},
    '@/lib/request-origin':{ensureAllowedMutationOrigin:()=>null},'@/lib/user-ban-guard':{getUserBanResponse:async()=>null},
    '@/lib/dating-blocks':{hasDatingBlockBetween:async()=>false},'@/lib/dating-contact-blocks':{hasDatingContactPhoneBlockBetween:async()=>false},
    '@/lib/dating-notifications':{notifyDatingUser:async()=>{notifications++;}},'@/lib/dating-swipe':{sendDatingEmailNotification:async()=>{emails++;return true;}},
  });
  const adapter=path.join(__dirname,'fixtures/recommendation-refresh-adapters.tsx');
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/revenue-journey-browser.tsx'),output:{path:out,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],fallback:{crypto:false},alias:{'next/link':adapter,'@/lib/supabase/client':adapter,'@':root}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/profile-ux-loader.cjs')}]}});compiler.run((e,s)=>{compiler.close(()=>{});if(e||s.hasErrors())reject(e||Error(s.toString({all:false,errors:true})));else resolve();});});
  const cssDir=process.env.CONTACT_CONVERSION_CSS_DIR||path.join(root,'.next/static/css'),css=fs.readdirSync(cssDir).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(cssDir,p),'utf8')).join('\n');
  const unexpected=[],serverErrors=[];
  const server=http.createServer(async(req,res)=>{try{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(out,'fixture.js')));return;}
    if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
    if(req.url==='/test-photo.webp'){res.statusCode=404;res.end();return;}
    if(req.url.startsWith('/api/dating/1on1/contact-intro-offer')){res.setHeader('Content-Type','application/json');res.end('{"offer":null}');return;}
    if(req.url==='/api/dating/all-pass-offer'){res.setHeader('Content-Type','application/json');res.end('{"userId":"fixture-member","offer":null}');return;}
    if(req.url==='/api/analytics/payment-funnel'){res.statusCode=204;res.end();return;}
    if(req.url==='/api/analytics/contact-exchange'||req.url===`/api/dating/1on1/matches/${match}/nudge`){
      let body='';for await(const c of req)body+=c;
      const request=new Request('http://127.0.0.1'+req.url,{method:'POST',body});
      const result=req.url.includes('/nudge')?(sends++,await nudge.POST(request,{params:Promise.resolve({id:match})})):await f.contact.POST(request);
      res.statusCode=result.status;res.setHeader('Content-Type','application/json');res.end(await result.text());return;
    }
    if(req.url.startsWith('/api/')){unexpected.push(req.url);res.statusCode=500;res.end();return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
  }catch(e){serverErrors.push(e.message);res.statusCode=500;res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,origin);return route.continue();});
    for(const width of [320,390,768]){
      await page.setViewportSize({width,height:1000});await page.goto(origin+'/community/dating/cards?tab=one_on_one');
      const exchange=page.getByRole('button',{name:'연락처 교환 · 20,000원',exact:true});await exchange.waitFor();
      assert.equal(await page.getByLabel('기존 결제 동작 호출').innerText(),'0');assert.equal(sends,0);
      await exchange.click();assert.equal(await page.getByLabel('기존 결제 동작 호출').innerText(),'1');
      const upsell=page.getByRole('button',{name:/플러스는 최근 24시간 2회/});await upsell.click();
      await page.getByRole('button',{name:/7일 먼저 써보기/}).waitFor();
      await page.getByLabel('플러스 적용 중',{exact:true}).check();assert.equal(await upsell.count(),0);
      await page.getByLabel('플러스 적용 중',{exact:true}).uncheck();await page.getByLabel('남은 횟수 있음',{exact:true}).check();assert.equal(await upsell.count(),0);
      await page.getByLabel('남은 횟수 있음',{exact:true}).uncheck();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(out,`journey-${width}.png`),fullPage:true});
    }
    await page.getByRole('button',{name:'한마디 보내기',exact:true}).click();
    page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'저는 연락처를 교환하고 싶어요 🙂',exact:true}).click();assert.equal(sends,0);
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'저는 연락처를 교환하고 싶어요 🙂',exact:true}).click();
    await page.getByText('상대에게 한마디를 보냈어요.',{exact:true}).waitFor();
    assert.equal(sends,1);assert.equal(notifications,1);assert.equal(emails,1);
    assert.equal(await page.getByRole('button',{name:'한마디 보내기',exact:true}).count(),0);
    const duplicate=await page.evaluate(async(id)=>{const r=await fetch(`/api/dating/1on1/matches/${id}/nudge`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({presetKey:'want_to_exchange'})});return r.status;},match);
    assert.equal(duplicate,409);assert.equal(notifications,1);assert.equal(emails,1);
    assert.equal((await f.db.query('select count(*)::int n from dating_1on1_contact_nudges')).rows[0].n,1);
    assert.equal((await f.db.query('select contact_exchange_status from dating_1on1_match_proposals')).rows[0].contact_exchange_status,'awaiting_applicant_payment');
    assert.deepEqual(errors,[]);assert.deepEqual(serverErrors,[]);assert.deepEqual(unexpected,[]);
    console.log(JSON.stringify({ok:true,widths:[320,390,768],automaticPayments:0,realEmails:0,realSms:0,syntheticNudges:1,duplicateStatus:409,screenshots:out}));
  }finally{await browser?.close();await new Promise(r=>server.close(r));await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
