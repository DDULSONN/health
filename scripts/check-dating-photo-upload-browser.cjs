/* eslint-disable @typescript-eslint/no-require-imports */
// Real form/canvas/fetch, localhost-only mocked writes. No production data or payments.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {startPreview}=require('./preview-profile-writing.cjs');
const {chromium}=require('./test-browser-runtime.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const {server,origin,output}=await startPreview();let browser,passed=0;
  try{
    browser=await chromium.launch({headless:true});
    for(const width of [360,1280])for(const scenario of ['raw413','one503','liteInvalid']){
      const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);
      const errors=[],uploads=[],writes=[],diagnostics=[];let failed=false;
      page.on('pageerror',e=>errors.push(e.message));
      await context.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'production/external calls forbidden');
        if(req.method()==='GET')return route.continue();
        if(url.pathname==='/api/analytics/onboarding'){diagnostics.push(req.postDataJSON());return route.fulfill({status:204});}
        if(url.pathname==='/api/mypage/profile')return route.fulfill({json:{ok:true}});
        if(['/api/dating/cards/upload-card','/api/dating/1on1/upload'].includes(url.pathname)){
          const data=req.postDataBuffer();assert.ok(data.length<4_500_000,'multipart body must fit production transport');
          const form=await new Response(data,{headers:{'content-type':req.headers()['content-type']}}).formData();
          const file=form.get('file');assert.ok(file instanceof File);assert.ok(file.size<=3*1024*1024);assert.ok(['image/jpeg','image/webp'].includes(file.type));
          const kind=url.pathname.endsWith('/1on1/upload')?'one':form.get('kind');uploads.push(kind);
          if(!failed&&((scenario==='raw413'&&kind==='raw')||(scenario==='one503'&&kind==='one')||(scenario==='liteInvalid'&&kind==='lite'))){
            failed=true;
            return route.fulfill(scenario==='liteInvalid'?{status:200,contentType:'text/html',body:'invalid response'}:{status:scenario==='raw413'?413:503,body:'provider failure'});
          }
          return route.fulfill({status:201,json:{path:'cards/fixture-member/'+kind+'/photo-'+uploads.length+(file.type==='image/webp'?'.webp':'.jpg')}});
        }
        if(['/api/dating/cards/my','/api/dating/1on1/cards'].includes(url.pathname)){
          writes.push({path:url.pathname,body:req.postDataJSON()});return route.fulfill({status:201,json:{ok:true}});
        }
        assert.fail('unexpected write '+url.pathname);
      });
      await context.addInitScript(()=>localStorage.setItem('gymtools:dating-onboarding-draft:v1:fixture-member',JSON.stringify({version:1,userId:'fixture-member',savedAt:Date.now(),step:3,targets:{open:true,oneOnOne:true},fields:{nickname:'테스트',sex:'female',name:'테스트이름',birthYear:'1996',heightCm:'165',job:'회사원',region:'서울',introText:'보존할 자기소개 한글 문장입니다.',strengthsText:'약속을 잘 지켜요.',preferredPartnerText:'대화가 잘 통하는 분',smoking:'non_smoker',workoutFrequency:'3_4',trainingYears:'1',instagramId:'fixture.test',total3Lift:'',photoVisibility:'blur'}})));
      await page.goto(origin+'/onboarding/dating');await page.getByRole('button',{name:'이어서 작성',exact:true}).click();
      const bytes=fs.readFileSync(path.join(root,'public/mascot/jimnyang-guide-v2.png')),large=Buffer.alloc(5*1024*1024);bytes.copy(large);
      await page.getByLabel('사진 1',{exact:true}).setInputFiles({name:'large.png',mimeType:'image/png',buffer:large});
      await page.getByLabel('사진 2',{exact:true}).setInputFiles({name:'second.png',mimeType:'image/png',buffer:large});
      await page.locator('[data-onboarding-next]').click();await page.getByRole('heading',{name:'마지막 확인',exact:true}).waitFor();
      for(const box of await page.getByRole('checkbox').all())await box.check();
      const submit=page.locator('[data-onboarding-submit]');await submit.click();
      await page.getByRole('alert').waitFor();await page.waitForFunction(()=>document.querySelector('[data-onboarding-submit]')?.disabled===false);
      assert.equal(writes.length,0,'failed upload must never create incomplete cards');
      const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem('gymtools:dating-onboarding-draft:v1:fixture-member')));assert.equal(draft.fields.introText,'보존할 자기소개 한글 문장입니다.');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(output,scenario+'-'+width+'-error.png'),fullPage:true});
      await submit.click();await page.waitForFunction(()=>window.fixtureRedirect?.includes('tab=one_on_one'));
      assert.deepEqual(writes.map(w=>w.path),['/api/dating/cards/my','/api/dating/1on1/cards']);
      assert.equal(writes[1].body.intro_text,'보존할 자기소개 한글 문장입니다.');assert.equal(writes[0].body.photo_visibility,'blur');
      for(const w of writes)assert.equal(w.body.photo_paths.length,2);
      if(scenario==='one503')assert.equal(uploads.filter(k=>k==='raw').length,2,'completed open-photo bundle is reused on retry');
      const expected=scenario==='raw413'?{stage:'open_raw',reason:'too_large'}:scenario==='one503'?{stage:'one_on_one',reason:'server'}:{stage:'open_lite',reason:'invalid_response'};
      assert.ok(diagnostics.some(d=>d.event==='upload_failed'&&JSON.stringify(d.upload)===JSON.stringify(expected)));
      assert.deepEqual(errors,[]);passed++;await context.close();
    }
    console.log(JSON.stringify({passed,productionRequests:0,screenshots:output}));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
