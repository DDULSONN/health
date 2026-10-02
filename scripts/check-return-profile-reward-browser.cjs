/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('./test-browser-runtime.cjs');
const { startPreview } = require('./preview-return-profile-reward.cjs');
const reward = state => ({ campaignKey:'return-profile-2026-10',credits:5,state });
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const preview=await startPreview(); let browser;
  try {
    browser=await chromium.launch({headless:true});
    const errors=[];
    async function pageFor(handler, width=390, suffix='') {
      const context=await browser.newContext({viewport:{width,height:844}});
      const page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/api/return-profile-reward',handler);
      await page.goto(preview.origin+'/community/dating/cards'+suffix);
      await page.waitForFunction(()=>!!window.rewardFixture);
      return page;
    }
    const fulfill = (route, body, status=200) => route.fulfill({status,contentType:'application/json; charset=utf-8',body:JSON.stringify(body)});
    const banner=page=>page.getByRole('complementary',{name:'복귀 회원 지원권 혜택'});
    let calls=0;
    let page=await pageFor(route=>{calls++;return fulfill(route,{userId:'return-member',reward:reward('eligible')});},390,'?preview=anonymous');
    await pause(200);assert.equal(calls,0);assert.equal(await banner(page).count(),0);await page.context().close();
    page=await pageFor(route=>{calls++;return fulfill(route,{userId:'return-member',reward:null});});
    await pause(200);assert.equal(calls,1);assert.equal(await banner(page).count(),0);
    await page.evaluate(()=>window.rewardFixture.path('/mypage'));await pause(100);assert.equal(calls,1,'non-member status memoized');await page.context().close();
    // Live mobile widths: compact banner, no overflow, target link preserved, keyboard-accessible details/close.
    for(const width of [320,390,768,1280]) {
      page=await pageFor(route=>fulfill(route,{userId:'return-member',reward:reward('eligible')}),width);
      await banner(page).waitFor();
      assert.equal(await page.getByRole('link',{name:'프로필 작성하기 →'}).getAttribute('href'),'/onboarding/dating?target=one_on_one');
      assert.ok((await banner(page).boundingBox()).height<225,'compact at '+width);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow at '+width);
      await page.getByText('지급 안내',{exact:true}).click();assert.ok(await page.getByText('통합 작성에서는 1:1 매칭을 함께 선택해 주세요.',{exact:false}).isVisible());
      if(width===390) await page.screenshot({path:path.join(preview.output,'return-reward-mobile.png'),fullPage:true});
      await page.getByRole('button',{name:'복귀 혜택 안내 닫기'}).click();assert.equal(await banner(page).count(),0);
      await page.reload();await pause(150);assert.equal(await banner(page).count(),0,'dismissal persists in session');
      await page.context().close();
    }
    // Ready => one POST, failed POST never demands profile recreation. Double clicks do not double-request.
    let posts=0, allow=false;
    page=await pageFor(async route=>{
      if(route.request().method()==='POST'){posts++;await pause(100);return fulfill(route,allow?{userId:'return-member',reward:reward('rewarded')}:{error:'unavailable'},allow?200:503);}
      return fulfill(route,{userId:'return-member',reward:reward('ready')});
    });
    await page.getByText('프로필은 등록됐어요. 지원권 지급만 다시 확인해 주세요.').waitFor();assert.equal(posts,1);
    allow=true;
    await page.getByRole('button',{name:'지급 다시 확인'}).click();
    await page.getByText('지원권 5장을 받았어요',{exact:true}).waitFor();assert.equal(posts,2);
    assert.equal(await page.getByRole('link',{name:'프로필 작성하기 →'}).count(),0);await page.context().close();
    // A dismissed offer must not hide a subsequent reward confirmation.
    let state='eligible';
    page=await pageFor(route=>fulfill(route,{userId:'return-member',reward:reward(state)}));
    await banner(page).waitFor();await page.getByRole('button',{name:'복귀 혜택 안내 닫기'}).click();state='rewarded';
    await page.evaluate(()=>window.rewardFixture.path('/mypage'));await page.getByText('지원권 5장을 받았어요',{exact:true}).waitFor();
    await page.evaluate(()=>window.rewardFixture.auth(null));assert.equal(await banner(page).count(),0);await page.context().close();
    // Stale request resolves after sign-out/account switch: no old-user banner/claim.
    let resolveFirst, started=false;
    const gate=new Promise(resolve=>{resolveFirst=resolve;});
    page=await pageFor(async route=>{if(!started){started=true;await gate;return fulfill(route,{userId:'return-member',reward:reward('ready')}).catch(()=>{});}return fulfill(route,{userId:'other-member',reward:null});});
    await page.waitForFunction(()=>!!window.rewardFixture);await pause(100);
    await page.evaluate(()=>window.rewardFixture.auth('other-member'));resolveFirst();await pause(200);
    assert.equal(await banner(page).count(),0);await page.context().close();
    // Session storage denied and an unrelated path both remain safe.
    page=await pageFor(route=>fulfill(route,{userId:'return-member',reward:reward('eligible')}));await banner(page).waitFor();
    await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('disabled');};Storage.prototype.getItem=()=>{throw Error('disabled');};});
    await page.getByRole('button',{name:'복귀 혜택 안내 닫기'}).click();assert.equal(await banner(page).count(),0);
    await page.evaluate(()=>window.rewardFixture.path('/payments/success'));assert.equal(await banner(page).count(),0);await page.context().close();
    assert.deepEqual(errors,[]);
    console.log('PASS: anonymous/non-member hidden; mobile/desktop; dismissal; retry; reward visibility; stale account; storage unavailable; zero runtime errors');
    console.log('Screenshot: '+path.join(preview.output,'return-reward-mobile.png'));
  } finally { if(browser)await browser.close();await new Promise(resolve=>preview.server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
