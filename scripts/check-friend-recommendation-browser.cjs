/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),path=require('node:path');
const {start}=require('./preview-friend-recommendation.cjs'),{chromium}=require('./test-browser-runtime.cjs');
(async()=>{const s=await start();let browser;const errors=[];let cases=0;try{
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,1280]){
    const ctx=await browser.newContext({viewport:{width,height:844}});await ctx.route('**/*',route=>new URL(route.request().url()).origin===s.origin?route.continue():route.abort());
    await ctx.addCookies([{name:'fixture_role',value:'sender',url:s.origin}]);const page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(s.origin);await page.getByRole('button',{name:'친구에게 추천',exact:true}).click();await page.getByRole('button',{name:'추천 링크 만들기'}).click();await page.getByRole('button',{name:'친구에게 보내기'}).waitFor();
    const link=await page.getByRole('textbox',{name:'친구 추천 링크'}).inputValue();assert.ok(link.startsWith(s.origin+'/s/'));
    await page.screenshot({path:path.join(s.output,`sender-${width}.png`),fullPage:true});await page.getByRole('button',{name:'친구 추천 닫기'}).click();
    await ctx.addCookies([{name:'fixture_role',value:'guest',url:s.origin}]);await page.goto(link);await page.getByRole('link',{name:'가입하고 프로필 확인'}).waitFor();assert.equal(await page.getByText('산책을 좋아해요').count(),0);assert.equal(await page.getByText('추천회원',{exact:true}).count(),0);
    await page.waitForFunction(()=>[...document.querySelectorAll('article img')].every(img=>img.complete&&img.naturalWidth>0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(s.output,`guest-${width}.png`),fullPage:true});const signup=await page.getByRole('link',{name:'가입하고 프로필 확인'}).getAttribute('href');assert.equal(new URL(signup,s.origin).searchParams.get('share_return'),new URL(link).pathname);
    await ctx.addCookies([{name:'fixture_role',value:'recipient',url:s.origin}]);await page.reload();await page.getByText('산책을 좋아해요').waitFor();await page.getByRole('button',{name:'지원서 작성하기'}).waitFor();await page.screenshot({path:path.join(s.output,`member-${width}.png`),fullPage:true});assert.equal(s.fixture.state.matchCalls,0);
    await ctx.addCookies([{name:'fixture_role',value:'admin',url:s.origin}]);await page.goto(s.origin+'/admin');await page.getByText('보낸회원',{exact:true}).first().waitFor();await page.screenshot({path:path.join(s.output,`admin-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await ctx.addCookies([{name:'fixture_role',value:'target',url:s.origin}]);await page.goto(s.origin+'/settings');await page.getByRole('switch').waitFor();await page.getByRole('switch').click();await page.getByText('반영했어요.').waitFor();assert.equal(await page.getByRole('switch').getAttribute('aria-checked'),'false');await page.getByRole('switch').click();await page.getByText('반영했어요.').waitFor();
    await ctx.addCookies([{name:'fixture_role',value:'recipient',url:s.origin}]);await page.goto(link);await page.getByText('현재 볼 수 있는 프로필이 없어요.').waitFor();assert.equal(await page.locator('article').count(),0);
    await ctx.close();cases++;console.log('PASS production UI/API privacy/admin/OFF '+width);
  }
  await require('./check-friend-share-sender-browser.cjs').runSenderChecks(s,browser);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({cases,screenshots:s.output,externalSends:0,productionWrites:0}));
}finally{if(browser)await browser.close();await s.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
