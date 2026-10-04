/* eslint-disable @typescript-eslint/no-require-imports */
// Actual MyPage and action component; local mocked APIs, no production traffic.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),webpack=require('webpack');
const {chromium}=require('./test-browser-runtime.cjs'),root=path.resolve(__dirname,'..');
(async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-incoming-swipe-'));
 const adapter=path.join(__dirname,'fixtures/recommendation-refresh-adapters.tsx');
 await new Promise((resolve,reject)=>{
  const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'fixtures/recommendation-refresh-browser.tsx'),
   output:{path:output,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],fallback:{crypto:false},alias:{
    'next/link':adapter,'next/image':adapter,'next/navigation':adapter,'@/lib/supabase/client':adapter,'@/components/DatingAdultNotice':adapter,'@':root}},
   plugins:[new webpack.DefinePlugin({'process.env.NEXT_PUBLIC_OPENKAKAO_URL':'undefined'})],
   module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'fixtures/mypage-navigation-loader.cjs')}]}});
  compiler.run((err,stats)=>{compiler.close(()=>{});if(err||stats.hasErrors())reject(err||Error(stats.toString({all:false,errors:true})));else resolve();});
 });
 const cssRoot=path.join(root,'.next/static/css'),css=fs.readdirSync(cssRoot).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssRoot,f),'utf8')).join('\n');
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'self';img-src 'self' data:;style-src 'self' 'unsafe-inline';script-src 'self'");
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(output,'fixture.js')));}
  else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);}
  else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,1280])for(const scenario of ['hidden','visible','failure','schema-missing']){
   const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];
   let deleted=false,writes=0,accept=false,fail=scenario==='failure',hidden=scenario!=='visible',canDelete=scenario!=='schema-missing';
   const stamp=new Date().toISOString(),swipe='00000000-0000-4000-8000-000000000004';
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>accept?d.accept():d.dismiss());
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'external traffic forbidden');
    if(!url.pathname.startsWith('/api/')){await route.continue();return;}
    if(req.method()!=='GET'){
     assert.equal(req.method(),'DELETE');assert.equal(url.pathname,'/api/dating/cards/my/incoming-swipes/'+swipe);
     assert.deepEqual(req.postDataJSON(),{created_at:stamp});writes++;
     await new Promise(resolve=>setTimeout(resolve,100));
     if(fail){await route.fulfill({status:500,json:{error:'삭제하지 못했습니다. 다시 시도해 주세요.'}});return;}
     deleted=true;await route.fulfill({json:{ok:true,removed:true}});return;
    }
    let body={ok:true,items:[],cards:[],applications:[],loggedIn:true};
    if(url.pathname==='/api/mypage/summary')body={profile:{nickname:'검증회원',phone_verified:true,nickname_changed_count:0,nickname_change_credits:0,swipe_profile_visible:true},account:{is_banned:false},isAdmin:false,weekly_win_count:0,bodycheck_posts:[]};
    if(url.pathname==='/api/dating/cards/my/swipe-status')body={can_dismiss_incoming:canDelete,summary:{incoming_pending:deleted?0:1,outgoing_pending:0,mutual_matches:0},outgoing_likes:[],incoming_likes:deleted?[]:[{
     swipe_id:swipe,created_at:stamp,other_user_id:'peer',can_like:!hidden,unavailable_reason:hidden?'상대가 빠른매칭을 숨긴 상태라 맞라이크를 진행할 수 없어요.':null,
     card:{id:'card',sex:'male',display_nickname:'검증 상대',age:31,height_cm:183,region:'서울 강서구',job:'회사원',training_years:2,image_url:null}}]};
    if(url.pathname==='/api/dating/cards/viewer-sex')body={status:'resolved',viewerSex:'female',targetSex:'male',canSwitchSex:false,requiresSexSelection:false};
    if(url.pathname==='/api/dating/1on1/write-status')body={canWrite:true,phoneVerified:true,writeStatus:'approved'};
    if(url.pathname==='/api/dating/cards/write-enabled')body={enabled:true};
    await route.fulfill({json:body});
   });
   await page.goto(origin+'/mypage?section=matching&match=quick');
   await page.getByRole('button',{name:'빠른매칭 보기',exact:true}).click();
   const panel=page.locator('#swipe-status-panel'),del=panel.getByRole('button',{name:'삭제',exact:true});
   await panel.getByText('검증 상대',{exact:true}).waitFor();
   assert.equal(await panel.getByRole('button',{name:'바로 라이크',exact:true}).count(),hidden?0:1);
   if(!canDelete){assert.equal(await del.count(),0);await context.close();continue;}
   const box=await del.boundingBox();assert(box.width>=44&&box.height>=44);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(width===390&&scenario==='hidden')await panel.screenshot({path:path.join(output,'incoming-swipe-actions-mobile.png')});
   await del.click();assert.equal(writes,0,'cancel must not send request');
   accept=true;await del.evaluate(b=>{b.click();b.click();});
   if(fail){
    await panel.getByRole('alert').waitFor();assert.equal(writes,1);assert(await del.isEnabled());assert(await panel.getByText('검증 상대',{exact:true}).isVisible());
    fail=false;await del.click();
   }
   await panel.getByText('지금 확인 가능한 받은 라이크가 없습니다.').waitFor();
   assert.equal(writes,scenario==='failure'?2:1,'double click cannot duplicate delete');
   await page.reload();await page.getByRole('button',{name:'빠른매칭 보기',exact:true}).click();await panel.getByText('지금 확인 가능한 받은 라이크가 없습니다.').waitFor();
   if(width===390&&scenario==='hidden')await page.screenshot({path:path.join(output,'incoming-swipe-deleted-mobile.png'),fullPage:true});
   assert.deepEqual(errors,[]);await context.close();console.log('PASS actual MyPage '+width+' '+scenario);
  }
  console.log('Browser passed. Screenshot directory: '+output);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
