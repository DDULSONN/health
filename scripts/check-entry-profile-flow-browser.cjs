/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),path=require('node:path');
const {startPreview}=require('./preview-profile-writing.cjs');
const {chromium}=require('./test-browser-runtime.cjs');
const draft={version:1,userId:'fixture-member',savedAt:Date.now(),step:1,targets:{open:true,oneOnOne:true},fields:{nickname:'테스트',sex:'female',name:'미리보기',birthYear:'1996',heightCm:'165',job:'회사원',region:'서울',introText:'작성 중인 소개',strengthsText:'',preferredPartnerText:'',smoking:'non_smoker',workoutFrequency:'',trainingYears:'',instagramId:'',total3Lift:'',photoVisibility:'blur'}};
(async()=>{
 const {server,origin,output}=await startPreview();let browser,passed=0;
 try{
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,1280])for(const scenario of ['guest','new','unverified','draft','existing','missing','error']){
   const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();page.setDefaultTimeout(10000);
   const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
   if(scenario==='guest')await context.addInitScript(()=>{window.fixtureAuthMode='guest';});
   if(scenario==='draft')await context.addInitScript(d=>localStorage.setItem('gymtools:dating-onboarding-draft:v1:fixture-member',JSON.stringify(d)),draft);
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'external request');
    if(req.method()!=='GET'){
     writes.push(url.pathname);assert.ok(['/api/analytics/onboarding','/api/analytics/payment-funnel'].includes(url.pathname),'no account/payment/refresh mutations');
     return route.fulfill({status:204});
    }
    if(url.pathname==='/api/dating/cards/list')return route.fulfill({json:{items:[],hasMore:false,audience:{status:scenario==='guest'?'guest':scenario==='missing'?'missing':'resolved',viewerSex:scenario==='missing'?null:'female',targetSex:scenario==='missing'?null:'male',source:'metadata',canSwitchSex:false,requiresSexSelection:scenario==='missing'}}});
    if(url.pathname==='/api/mypage/summary')return route.fulfill({json:{profile:{nickname:'테스트',phone_verified:scenario!=='unverified'},isAdmin:false}});
    if(url.pathname==='/api/dating/cards/my')return scenario==='error'?route.fulfill({status:503,json:{error:'조회 실패'}}):route.fulfill({json:{items:scenario==='existing'?[{id:'fixture-open',status:'pending'}]:[]}});
    if(url.pathname==='/api/dating/1on1/write-status')return route.fulfill({json:{phoneVerified:scenario!=='unverified',canWrite:scenario!=='existing',writeStatus:'approved',activeRequestStatus:scenario==='existing'?'approved':null}});
    return route.continue();
   });
   await page.goto(origin+'/community/dating/cards?tab=open_cards');await page.waitForLoadState('networkidle');
   const start=page.getByRole('region',{name:'내 소개 시작하기',exact:true});
   if(['guest','new','unverified'].includes(scenario)){
    await start.waitFor();assert.equal(await start.count(),1);
    assert.equal(await start.getByRole('link').first().getAttribute('href'),scenario==='guest'?'/signup':'/onboarding/dating');
    assert.equal(await start.getByRole('link').first().innerText(),scenario==='guest'?'가입하고 내 소개 쓰기':scenario==='unverified'?'휴대폰 인증하기':'프로필 작성하기');
    assert.equal(await start.getByRole('link',{name:'이미 가입했어요'}).count(),scenario==='guest'?1:0);
   }else assert.equal(await start.count(),0);
   assert.equal(await page.getByRole('region',{name:'처음 카드 보기'}).count(),scenario==='missing'?1:0);
   assert.equal(await page.getByRole('region',{name:'작성 중인 프로필',exact:true}).count(),scenario==='draft'?1:0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,`home-${scenario}-${width}.png`),fullPage:true});
   if(scenario==='guest'){
    await start.getByRole('link',{name:'가입하고 내 소개 쓰기'}).click();await page.getByRole('heading',{name:'회원가입',exact:true}).waitFor();
    assert.equal(await page.getByRole('checkbox').isChecked(),false);
    await page.goto(origin+'/community/dating/cards?tab=one_on_one');await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('link',{name:'가입하고 내 소개 쓰기'}).count(),1);
    const login=page.getByRole('link',{name:'이미 가입했어요'});assert.ok((await login.getAttribute('href')).includes(encodeURIComponent('/community/dating/cards?tab=one_on_one')));
    await page.goto(origin+'/community/dating/cards?tab=one_on_one&focus=incoming');await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('link',{name:'가입하고 내 소개 쓰기'}).count(),0);
    assert.ok((await page.getByRole('link',{name:'로그인하기',exact:true}).getAttribute('href')).includes(encodeURIComponent('focus=incoming')));
   }
   if(['new','unverified','draft'].includes(scenario)){
    if(scenario==='draft'){
     await page.getByRole('button',{name:/^1대1매칭/}).click();await page.waitForLoadState('networkidle');
     assert.equal(await page.getByText('내 소개를 올리면 추천이 시작돼요',{exact:true}).count(),0);
     await page.getByRole('region',{name:'작성 중인 프로필',exact:true}).getByRole('link').click();
     await page.getByRole('button',{name:'이어서 작성',exact:true}).click();
     assert.equal(await page.locator('#onboarding-field-introText').inputValue(),draft.fields.introText);
    }else{
     await start.getByRole('link').first().click();
     if(scenario==='unverified'){
      await page.waitForFunction(()=>window.fixtureRedirect?.startsWith('/phone-verification?'));
      assert.equal(new URL(await page.evaluate(()=>window.fixtureRedirect),origin).searchParams.get('next'),'/onboarding/dating');
     }else await page.getByRole('heading',{name:'소개 프로필 작성'}).waitFor();
    }
   }
   await page.waitForLoadState('networkidle');assert.deepEqual(errors,[]);passed++;await context.close();
  }
  console.log(JSON.stringify({passed,productionRequests:0,screenshots:output}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
