/* eslint-disable @typescript-eslint/no-require-imports */
// Real UI components; local fixture responses only, no live members or messages.
const assert=require('node:assert/strict'),path=require('node:path');
const {startPreview}=require('./preview-profile-writing.cjs');
const {chromium}=require('./test-browser-runtime.cjs');
(async()=>{
 const {server,origin,output}=await startPreview();let browser,passed=0;
 try{
  browser=await chromium.launch({headless:true});
  for(const [width,colorScheme] of [[320,'light'],[390,'light'],[390,'dark'],[768,'light'],[1280,'light']]){
   const context=await browser.newContext({viewport:{width,height:844},colorScheme}),page=await context.newPage();
   page.setDefaultTimeout(10000);const errors=[],writes=[];let saved=null,fail=true;
   page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'external requests forbidden');
    if(url.pathname==='/api/dating/cards/list'){
     const audience=saved?{status:'resolved',viewerSex:saved,targetSex:saved==='male'?'female':'male',source:'metadata',canSwitchSex:false,requiresSexSelection:false}:{status:'missing',viewerSex:null,targetSex:null,canSwitchSex:false,requiresSexSelection:true};
     return route.fulfill({json:{items:[],hasMore:false,audience}});
    }
    if(url.pathname==='/api/dating/cards/viewer-sex'){
     if(req.method()==='POST'){
      writes.push(req.postDataJSON());await new Promise(resolve=>setTimeout(resolve,180));
      if(fail)return route.fulfill({status:503,json:{error:'선택한 정보를 저장하지 못했어요. 다시 선택해 주세요.'}});
      saved=req.postDataJSON().sex;assert.ok(['male','female'].includes(saved));
      return route.fulfill({json:{targetSex:saved==='male'?'female':'male'}});
     }
     return route.fulfill({json:saved?{status:'resolved',viewerSex:saved,targetSex:saved==='male'?'female':'male',source:'metadata',canSwitchSex:false,requiresSexSelection:false}:{status:'missing',viewerSex:null,targetSex:null,canSwitchSex:false,requiresSexSelection:true}});
    }
    if(req.method()!=='GET'){
      assert.ok(['/api/analytics/onboarding','/api/analytics/payment-funnel'].includes(url.pathname),'Unexpected write: '+url.pathname);
      return route.fulfill({status:204});
    }
    return route.continue();
   });
   await page.goto(origin+'/community/dating/cards?tab=open_cards');
   const gender=page.getByRole('region',{name:'처음 카드 보기'});
   await gender.waitFor();
   assert.equal(await page.getByRole('region',{name:'내 소개 시작하기'}).count(),0,'one choice at a time before gender is saved');
   assert.equal(await gender.getByRole('button').count(),2);
   assert.equal(await gender.getByRole('button').first().evaluate(e=>getComputedStyle(e).backgroundColor),await gender.getByRole('button').last().evaluate(e=>getComputedStyle(e).backgroundColor));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await gender.screenshot({path:path.join(output,`gender-${width}-${colorScheme}.png`)});
   await gender.getByRole('button',{name:'나는 남성',exact:true}).click();
   await gender.getByRole('status').waitFor();assert.ok(await gender.getByRole('button',{name:'나는 여성',exact:true}).isDisabled());
   await gender.getByRole('alert').waitFor();assert.deepEqual(writes,[{sex:'male'}]);
   fail=false;await gender.getByRole('button',{name:'나는 여성',exact:true}).click();
   await gender.waitFor({state:'detached'});assert.deepEqual(writes,[{sex:'male'},{sex:'female'}]);
   // Finish unrelated home reads before tearing down the fixture document.
   // WebKit reports canceled in-flight intercepted loads as access-control errors.
   await page.waitForLoadState('networkidle');
   assert.equal(await page.getByRole('region',{name:'내 소개 시작하기'}).count(),1,'profile invitation follows gender selection');
   await page.reload();await page.getByRole('button',{name:/^오픈카드/}).first().waitFor();
   await page.waitForLoadState('networkidle');assert.equal(await gender.count(),0);passed++;
   await page.goto(origin+'/signup');await page.getByRole('heading',{name:'회원가입',exact:true}).waitFor();
   assert.equal(await page.getByRole('checkbox').isChecked(),false);
   await page.getByRole('button',{name:'이메일로 가입하기',exact:true}).click();
   await page.getByLabel('닉네임',{exact:true}).fill('봄산책');
   assert.equal(await page.getByLabel('닉네임',{exact:true}).inputValue(),'봄산책');
   assert.ok(await page.locator('input:not([type=checkbox])').evaluateAll(nodes=>nodes.every(n=>parseFloat(getComputedStyle(n).fontSize)>=16)));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,`signup-expanded-${width}-${colorScheme}.png`),fullPage:true});passed++;
   await page.goto(origin+'/onboarding/dating');await page.getByRole('heading',{name:'소개 프로필 작성',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'남자',exact:true}).getAttribute('aria-pressed'),'false');
   assert.equal(await page.getByRole('button',{name:'여자',exact:true}).getAttribute('aria-pressed'),'false');
   // Keyboard press does not auto-wait for the initial draft-restore fieldset lock.
   await page.getByRole('button',{name:'남자',exact:true}).and(page.locator('button:enabled')).waitFor();
   await page.getByRole('button',{name:'남자',exact:true}).press('Enter');
   await page.getByRole('button',{name:'남자',exact:true,pressed:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'남자',exact:true}).getAttribute('aria-pressed'),'true');
   await page.getByRole('button',{name:'여자',exact:true}).click();
   await page.getByRole('button',{name:'여자',exact:true,pressed:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'남자',exact:true}).getAttribute('aria-pressed'),'false');
   assert.equal(await page.getByRole('button',{name:'여자',exact:true}).getAttribute('aria-pressed'),'true');
   assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'1');
   const fields={name:'봄산책',birthYear:'1996',heightCm:'165',job:'서비스 기획자',region:'서울 마포구'};
   for(const [key,value]of Object.entries(fields))await page.locator('#onboarding-field-'+key).fill(value);
   const rects=await page.locator('#onboarding-field-birthYear,#onboarding-field-heightCm').evaluateAll(nodes=>nodes.map(n=>({top:n.getBoundingClientRect().top,size:parseFloat(getComputedStyle(n).fontSize),radius:parseFloat(getComputedStyle(n).borderRadius)})));
   assert.equal(rects[0].top,rects[1].top);assert.ok(rects.every(r=>r.size>=16&&r.radius>=10));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,`profile-${width}-${colorScheme}.png`),fullPage:true});
   await page.locator('[data-onboarding-next]').click();await page.getByRole('heading',{name:'내 소개',exact:true}).waitFor();
   assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'2');
   await page.getByRole('button',{name:'기본 정보',exact:true}).click();
   for(const [key,value]of Object.entries(fields))assert.equal(await page.locator('#onboarding-field-'+key).inputValue(),value);
   assert.deepEqual(errors,[]);passed++;await context.close();
  }
  console.log(JSON.stringify({passed,productionRequests:0,screenshots:output}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
