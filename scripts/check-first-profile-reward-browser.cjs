/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),path=require('node:path'),ts=require('typescript');
const {chromium}=require('./test-browser-runtime.cjs');
const {startPreview}=require('./preview-return-profile-reward.cjs');
const {createRewardDb,read,id}=require('./fixtures/first-profile-reward-db.cjs');
function load(file,overrides={}){const m={exports:{}};const code=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(n=>overrides[n]||(n.startsWith('@/')?load(n.slice(2)+'.ts',overrides):require(n)),m,m.exports);return m.exports;}
(async()=>{
 const f=await createRewardDb();let preview,browser;const errors=[];let posts=0,failClaim=false;
 try{
  await f.member(1);await f.db.exec(read('supabase/sql/first_profile_reward_activate.sql'));
  const admin={rpc:(name,args)=>({abortSignal:async()=>{
   if(name.includes('return_profile'))return {data:null,error:null};
   assert.ok(['first_profile_reward_status','claim_first_profile_reward'].includes(name));
   if(failClaim&&name.startsWith('claim'))return {data:null,error:{code:'XX000'}};
   return {data:(await f.db.query(`select ${name}($1) as v`,[args.p_user_id])).rows[0].v,error:null};
  }})};
  const api=load('app/api/return-profile-reward/route.ts',{'next/server':{NextResponse:{json:(v,o)=>Response.json(v,o)}},'@/lib/supabase/request':{getRequestAuthContext:async()=>({user:{id:id(1)}})},'@/lib/supabase/server':{createAdminClient:()=>admin}});
  preview=await startPreview(0,{handleApi:async(req,res)=>{
   if(req.method==='POST')posts++;
   const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:{host:req.headers.host,origin:'http://'+req.headers.host}});
   const response=await api[req.method](request);const data=await response.json();
   // Fixture auth is not a real login; map only the display ID to its fixed test identity.
   if(data.userId===id(1))data.userId='return-member';
   res.writeHead(response.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));
  }});
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,768,1280]){
   const page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',e=>errors.push(e.message));
   await page.goto(preview.origin+'/community/dating/cards?campaign=first');
   const banner=page.getByRole('complementary',{name:'1:1 프로필 작성 혜택'});await banner.waitFor();
   assert.equal(await page.getByRole('complementary',{name:'복귀 회원 지원권 혜택'}).count(),0);
   assert.ok((await banner.boundingBox()).height<175,'compact first offer at '+width);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.equal(await page.getByRole('link',{name:'프로필 작성하기 →'}).getAttribute('href'),'/onboarding/dating?target=one_on_one');
   if(width===390)await page.screenshot({path:path.join(preview.output,'first-profile-reward-mobile.png'),fullPage:true});
   await page.getByText('지급 안내',{exact:true}).click();assert.ok(await page.getByText('복귀 지원권 5장 혜택과 중복 지급되지 않아요.',{exact:false}).isVisible());
   await page.getByRole('button',{name:'작성 혜택 안내 닫기'}).click();await page.reload();
   await page.waitForFunction(()=>!!window.rewardFixture);assert.equal(await banner.count(),0);
   assert.equal(await f.credits(1),0,'reading/dismissing an offer cannot grant credits');await page.close();
  }
  const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
  // Real completion is independently validated by the unchanged registration suite.
  // This boundary test starts from a newly completed valid local database profile.
  await f.card(1);failClaim=true;await page.goto(preview.origin+'/mypage');
  await page.getByText('프로필은 등록됐어요. 지원권 지급만 다시 확인해 주세요.').waitFor();assert.equal(await f.credits(1),0);assert.equal(posts,1);
  failClaim=false;await page.getByRole('button',{name:'지급 다시 확인'}).click();await page.getByText('오픈카드 지원권 1장을 받았어요',{exact:true}).waitFor();
  assert.equal(await f.credits(1),1);assert.equal(posts,2);await page.reload();await page.getByText('오픈카드 지원권 1장을 받았어요',{exact:true}).waitFor();assert.equal(await f.credits(1),1);assert.equal(posts,2);
  await page.evaluate(()=>window.rewardFixture.auth(null));await page.getByRole('complementary',{name:'1:1 프로필 작성 혜택'}).waitFor({state:'hidden'});await page.close();
  assert.deepEqual(errors,[]);console.log('PASS: first reward mobile/desktop, scoped offer, no overflow, dismissal, real API/local SQL claim/retry, no duplicate credit, logout, zero runtime errors');
  console.log('Screenshot: '+path.join(preview.output,'first-profile-reward-mobile.png'));
 }finally{if(browser)await browser.close();if(preview)await new Promise(r=>preview.server.close(r));await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
