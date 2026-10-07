/* eslint-disable @typescript-eslint/no-require-imports */
// Actual Home component; synthetic identities and localhost-only responses.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-viewer-recovery-'));
  const adapter=path.join(__dirname,'fixtures/viewer-session-adapters.tsx');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/viewer-session-browser.tsx'),
      output:{path:output,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],fallback:{crypto:false},alias:{
        'next/link':adapter,'next/image':adapter,'next/navigation':adapter,
        '@/lib/supabase/client':adapter,'@/components/DatingAdultNotice':adapter,'@':root}},
      plugins:[new webpack.DefinePlugin({'process.env.NEXT_PUBLIC_OPENKAKAO_URL':'undefined'})],
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/mypage-navigation-loader.cjs')}]}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const cssRoot=path.join(root,'.next/static/css');
  const css=fs.readdirSync(cssRoot).filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(path.join(cssRoot,n),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(output,'fixture.js')));}
    else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);}
    else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser,passed=0;
  try{
    browser=await chromium.launch({headless:true});
    for(const width of [360,1280])for(const mode of ['healthy','guest','automatic','manual','event','signout','switch','open-card-error']){
      const scenario=['manual','event','open-card-error'].includes(mode)?'persistent':['signout','switch'].includes(mode)?'healthy':mode;
      const context=await browser.newContext({viewport:{width,height:844}});
      const page=await context.newPage();page.setDefaultTimeout(10000);
      const errors=[];let writes=0,external=0,identity='a',matchReads=0;
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!==origin){external++;return route.abort();}
        if(!url.pathname.startsWith('/api/'))return route.continue();
        if(route.request().method()!=='GET'){writes++;return route.abort();}
        if(url.pathname.startsWith('/api/dating/1on1/'))matchReads++;
        let body={items:[]};
        if(url.pathname==='/api/mypage/summary')body={profile:{phone_verified:true}};
        if(url.pathname==='/api/admin/me')body={isAdmin:false};
        if(url.pathname==='/api/dating/1on1/write-status')body={canWrite:false,phoneVerified:true,activeRequestStatus:'submitted'};
        if(url.pathname==='/api/dating/1on1/my')body={items:[{id:'card-'+identity,user_id:identity,name:'검증회원'+identity,age:30,region:'서울',sex:'male',status:'submitted',photo_signed_urls:[],created_at:new Date().toISOString()}]};
        if(url.pathname==='/api/dating/cards/queue-stats')body={male:{public_count:0,pending_count:0,slot_limit:45},female:{public_count:0,pending_count:0,slot_limit:45}};
        if(url.pathname==='/api/dating/cards/list')body={items:[],hasMore:false,audience:{status:'resolved',viewerSex:'male',targetSex:'female',canSwitchSex:false}};
        if(url.pathname==='/api/site/ad-inquiry')body={enabled:false};
        await route.fulfill({json:body});
      });
      try{
        const tab=mode==='open-card-error'?'open_cards':'one_on_one';
        await page.goto(origin+`/community/dating/cards?tab=${tab}&scenario=${scenario}`);
        const guest=page.getByText('로그인하면 내 1대1 진행 상태를 볼 수 있어요.',{exact:true});
        const retry=page.getByRole('button',{name:'로그인 상태 다시 확인',exact:true});
        if(scenario==='persistent'){
          await retry.waitFor();assert.equal(await guest.count(),0);assert.equal(matchReads,0);
          assert.equal(await page.evaluate(()=>window.authProbe.reads),2);
          if(width===360)await page.screenshot({path:path.join(output,mode+'.png'),fullPage:true});
          if(mode==='event')await page.evaluate(()=>{window.authProbe.recovered=true;window.authProbe.emit('TOKEN_REFRESHED','a');});
          else {await page.evaluate(()=>{window.authProbe.recovered=true;});await retry.click();}
          if(mode==='open-card-error')await page.getByRole('button',{name:/1대1매칭/}).click();
        }
        if(mode==='guest')await guest.waitFor();
        else {
          await page.getByText('내 프로필 · 매칭 관리',{exact:true}).waitFor();
          assert.equal(await guest.count(),0);
          if(mode==='signout'){
            await page.evaluate(()=>window.authProbe.emit('SIGNED_OUT',null));await guest.waitFor();
            assert.equal(await page.getByText('내 프로필 · 매칭 관리',{exact:true}).count(),0);
          }else if(mode==='switch'){
            identity='b';await page.evaluate(()=>window.authProbe.emit('SIGNED_IN','b'));
            await page.getByText('검증회원b',{exact:true}).waitFor({state:'attached'});
            assert.equal(await page.getByText('검증회원a',{exact:true}).count(),0);
          }
        }
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
        assert.equal(writes,0);assert.equal(external,0);assert.deepEqual(errors,[]);
        console.log(`PASS viewer recovery ${width}px ${mode}`);passed++;
      }finally{await context.close();}
    }
    console.log(JSON.stringify({passed,screenshotDirectory:output,productionWrites:0}));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
