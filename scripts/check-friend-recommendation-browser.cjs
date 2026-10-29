/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),path=require('node:path');
const {start}=require('./preview-friend-recommendation.cjs'),{chromium}=require('./test-browser-runtime.cjs'),{id}=require('./fixtures/friend-recommendation-store.cjs');
(async()=>{const s=await start();let browser;const errors=[];let cases=0;try{
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,1280]){
    const ctx=await browser.newContext({viewport:{width,height:844}});await ctx.route('**/*',route=>new URL(route.request().url()).origin===s.origin?route.continue():route.abort());
    await ctx.addCookies([{name:'fixture_role',value:'sender',url:s.origin}]);const page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await ctx.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedLink=value;}}}));
    await page.goto(s.origin);await page.getByRole('button',{name:'친구에게 추천',exact:true}).click();await page.getByRole('button',{name:'친구에게 보내기'}).waitFor();
    await page.getByRole('button',{name:'링크 복사',exact:true}).click();const link=await page.evaluate(()=>window.copiedLink);assert.ok(link.startsWith(s.origin+'/s/'));
    await page.screenshot({path:path.join(s.output,`sender-${width}.png`),fullPage:true});await page.getByRole('button',{name:'친구 추천 닫기'}).click();
    await ctx.addCookies([{name:'fixture_role',value:'guest',url:s.origin}]);await page.goto(link);await page.getByRole('link',{name:'가입하고 프로필 보기'}).waitFor();assert.equal(await page.getByText('산책을 좋아해요').count(),0);assert.equal(await page.getByText('추천회원',{exact:true}).count(),0);
    await page.waitForFunction(()=>[...document.querySelectorAll('article img')].every(img=>img.complete&&img.naturalWidth>0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(s.output,`guest-${width}.png`),fullPage:true});const signup=await page.getByRole('link',{name:'가입하고 프로필 보기'}).getAttribute('href');assert.ok(new URL(signup,s.origin).searchParams.get('share_return').startsWith(new URL(link).pathname+'#candidate-'));
    await ctx.addCookies([{name:'fixture_role',value:'recipient',url:s.origin}]);await page.reload();await page.getByText('산책을 좋아해요').waitFor();await page.getByRole('button',{name:'지원서 작성하기'}).waitFor();await page.screenshot({path:path.join(s.output,`member-${width}.png`),fullPage:true});assert.equal(s.fixture.state.matchCalls,0);
    await ctx.addCookies([{name:'fixture_role',value:'admin',url:s.origin}]);await page.goto(s.origin+'/admin');await page.getByText('보낸회원',{exact:true}).first().waitFor();await page.screenshot({path:path.join(s.output,`admin-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await ctx.addCookies([{name:'fixture_role',value:'target',url:s.origin}]);await page.goto(s.origin+'/settings');await page.getByRole('switch').waitFor();await page.getByRole('switch').click();await page.getByText('반영했어요.').waitFor();assert.equal(await page.getByRole('switch').getAttribute('aria-checked'),'false');await page.getByRole('switch').click();await page.getByText('반영했어요.').waitFor();
    await ctx.addCookies([{name:'fixture_role',value:'recipient',url:s.origin}]);await page.goto(link);await page.getByText('현재 볼 수 있는 프로필이 없어요.').waitFor();assert.equal(await page.locator('article').count(),0);
    await ctx.close();cases++;console.log('PASS production UI/API privacy/admin/OFF '+width);
  }
  // Recipient: guest -> verification -> own profile -> same candidate, no
  // automatic request at any intermediate stage. Actual route/service modules.
  const f=s.fixture,service=f.load('@/lib/friend-recommendation-server');
  f.tables.dating_1on1_cards.push({id:id(22),user_id:id(2),name:'추천이름',sex:'male',birth_year:1996,status:'approved',phone:'+821012340002',region:'서울',intro_text:'대화가 편한 만남을 원해요.',photo_paths:[]});
  const share=await service.createFriendLink(f.admin,id(1),id(91),'fit',[{kind:'one_on_one',cardId:id(22),ticket:`ticket:${id(1)}:${id(22)}`}]);
  const back='/s/'+share.token+'#candidate-'+share.items[0].id;
  const ctx=await browser.newContext({viewport:{width:390,height:844}}),p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===s.origin?route.continue():route.abort());
  await p.goto(s.origin+back);await p.getByRole('link',{name:'가입하고 프로필 보기'}).waitFor();
  assert.equal(new URL(await p.getByRole('link',{name:'가입하고 프로필 보기'}).getAttribute('href'),s.origin).searchParams.get('share_return'),back);
  assert.equal(new URL(await p.getByRole('link',{name:'이미 회원이라면 로그인'}).getAttribute('href'),s.origin).searchParams.get('next'),back);assert.equal(f.state.matchCalls,0);cases++;
  f.tables.profiles[2].phone_verified=false;await ctx.addCookies([{name:'fixture_role',value:'recipient',url:s.origin}]);await p.reload();
  await p.getByRole('link',{name:'휴대폰 인증하고 보기'}).waitFor();assert.equal(new URL(await p.getByRole('link',{name:'휴대폰 인증하고 보기'}).getAttribute('href'),s.origin).searchParams.get('next'),back);assert.equal(await p.getByText('추천이름',{exact:true}).count(),0);cases++;
  f.tables.profiles[2].phone_verified=true;await p.reload();await p.getByRole('link',{name:'내 프로필 작성하고 돌아오기',exact:true}).waitFor();
  assert.equal(new URL(await p.getByRole('link',{name:'내 프로필 작성하고 돌아오기',exact:true}).getAttribute('href'),s.origin).searchParams.get('share_return'),back);
  assert.equal(await p.getByRole('button',{name:'이 분에게 매칭 요청'}).count(),0);assert.equal(f.state.matchCalls,0);await p.screenshot({path:path.join(s.output,'recipient-needs-profile-390.png'),fullPage:true});cases++;
  f.tables.dating_1on1_cards.push({id:id(33),user_id:id(3),status:'approved',created_at:new Date().toISOString()});await p.reload();await p.getByRole('button',{name:'이 분에게 매칭 요청'}).waitFor();
  await p.waitForFunction(anchor=>document.activeElement?.id===anchor,'candidate-'+share.items[0].id);assert.equal(f.state.matchCalls,0);cases++;
  p.once('dialog',dialog=>dialog.dismiss());await p.getByRole('button',{name:'이 분에게 매칭 요청'}).click();assert.equal(f.state.matchCalls,0);
  p.once('dialog',dialog=>dialog.accept());await p.getByRole('button',{name:'이 분에게 매칭 요청'}).click();await p.getByRole('link',{name:'보낸 요청 확인'}).waitFor();assert.equal(f.state.matchCalls,1);cases++;
  await ctx.close();
  await require('./check-friend-share-sender-browser.cjs').runSenderChecks(s,browser);
  await require('./check-friend-basket-browser.cjs').runBasketChecks(s,browser);
  await require('./check-friend-settings-browser.cjs').runSettingsChecks(s,browser);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({cases,screenshots:s.output,externalSends:0,productionWrites:0}));
}finally{if(browser)await browser.close();await s.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
